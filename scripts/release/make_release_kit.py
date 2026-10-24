"""Builds the release kit used to make the Preview and Production databases match.

  python scripts/release/make_release_kit.py            (from the project folder)

Writes, for every migration from START onward:
  docs/release/sql-parts/<version>/p1.sql, p2.sql ...   paste-ready parts (each under 8,500 characters, cut only between statements; begin/commit removed
                                                         from multi-part files because each part is a separate paste; a single-part file keeps them)
  docs/release/db_fingerprint_A.sql, _B.sql             READ-ONLY checks: run on both projects, compare the 'status' columns
  docs/release/sql-parts/index.json                     what the PowerShell copier reads (version, name, parts, re-run advice)
Run it again after changing any migration; lib/core/release-kit.test.ts fails when the parts are stale."""
import json, pathlib, re, shutil, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIG = ROOT / "supabase" / "migrations"
OUT = ROOT / "docs" / "release"
PARTS = OUT / "sql-parts"
START = "20261020"
LIMIT = 8500

def strip_comments(sql: str) -> str:
    return re.sub(r"--[^\n]*", "", sql)

def statements(sql: str):
    """Splits at a semicolon that is outside quotes, comments and dollar-quoted text, so a cut can never land inside a statement
    (an earlier version cut before a 'select' line and separated an insert from its select)."""
    out, i, n, start = [], 0, len(sql), 0
    while i < n:
        c = sql[i]
        if c == "-" and sql.startswith("--", i):
            j = sql.find(chr(10), i); i = n if j < 0 else j; continue
        if c == "/" and sql.startswith("/*", i):
            j = sql.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        if c == "'":
            i += 1
            while i < n:
                if sql[i] == "'":
                    if i + 1 < n and sql[i + 1] == "'": i += 2; continue
                    break
                i += 1
            i += 1; continue
        if c == "$":
            m = re.match(r"\$([A-Za-z_][A-Za-z_0-9]*)?\$", sql[i:i + 80])
            if m:
                tag = m.group(0); j = sql.find(tag, i + len(tag)); i = n if j < 0 else j + len(tag); continue
        if c == ";":
            out.append(sql[start:i + 1]); start = i + 1
        i += 1
    if sql[start:].strip(): out.append(sql[start:])
    return out

def split(sql: str):
    if len(sql) <= LIMIT:
        return [sql]
    # Each part is pasted on its own, so begin; and commit; are removed (a part that began a transaction the next part never ends would be rolled back). Comments stay.
    stmts = [re.sub(r"(?im)^[ \t]*(begin|commit);[ \t]*$", "", x) if strip_comments(x).strip().lower() in ("begin;", "commit;") else x for x in statements(sql)]
    parts, buf = [], ""
    for st in stmts:
        if buf and len(buf) + len(st) > LIMIT:
            parts.append(buf.strip(chr(10)) + chr(10)); buf = ""
        buf += st
    parts.append(buf.strip(chr(10)) + chr(10))
    return parts

files = sorted(p for p in MIG.glob("*.sql") if p.name[:14] >= START + "000000")
texts = {p.name[:14]: p.read_text(encoding="utf-8") for p in files}
bare = {v: strip_comments(t) for v, t in texts.items()}

# Hand-written advice. The rule for everything else: apply a migration only when the fingerprint says MISSING; never re-run one that says ok or PARTIAL.
NOTES = {
    "20261037100000": "Seeds the 4 policy drafts; each is inserted only for a document that has no version yet, so running it again is safe and never overwrites an edit.",
    "20261040100000": "Guide seed; each row says 'on conflict do nothing', so a second run keeps edits (a deleted guide would come back).",
    "20261042100000": "Guide seed, 'on conflict do nothing'.",
    "20261044100000": "Guide seed, 'on conflict do nothing'.",
    "20261045100000": "Do NOT run after 20261046100000: it would put the export list back to 22 datasets.",
    "20261047100000": "New in this release. Not applied anywhere yet.",
}

# 1. Parts
if PARTS.exists():
    shutil.rmtree(PARTS)
index = []
for p in files:
    v, name = p.name[:14], p.name[15:-4]
    parts = split(texts[v])
    d = PARTS / v; d.mkdir(parents=True, exist_ok=True)
    for i, part in enumerate(parts, 1):
        (d / f"p{i}.sql").write_text(part, encoding="utf-8", newline="\n")
    index.append({"version": v, "name": name, "chars": len(texts[v]), "parts": len(parts), "note": NOTES.get(v, "")})
(PARTS / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")

# 2. Fingerprint checks
dropped = set()
for v, t in bare.items():
    dropped |= {m.lower() for m in re.findall(r"drop (?:function|table)(?: if exists)? ((?:public|quizbox_\w+)\.\w+)", t, re.I)}

def checks(v):
    t = bare[v]
    tables = [m.lower() for m in re.findall(r"create table (?:if not exists )?((?:public|quizbox_\w+)\.\w+)", t, re.I)]
    funcs = list(dict.fromkeys(m.lower() for m in re.findall(r"create (?:or replace )?function ((?:public|quizbox_\w+)\.\w+)\s*\(", t, re.I)))
    cols = []
    for stmt in re.findall(r"alter table (?:if exists )?(?:only )?((?:public)\.\w+)\s+([^;]*);", t, re.I):
        cols += [f"{stmt[0].lower()}.{c.lower()}" for c in re.findall(r"add column (?:if not exists )?(\w+)", stmt[1], re.I)]
    tables = [x for x in tables if x not in dropped and first_seen.get(x) == v]
    funcs = [x for x in funcs if x not in dropped and first_seen.get(x) == v]
    cols = [x for x in cols if first_seen.get(x) == v]
    pick = tables[:2]
    if funcs:
        pick += [funcs[0]] + ([funcs[len(funcs) // 2]] if len(funcs) > 2 else []) + ([funcs[-1]] if len(funcs) > 1 else [])
    pick += cols[:2]
    out = []
    for o in dict.fromkeys(pick):
        out.append(("t" if o in tables else "f" if o in funcs else "c", o))
    return out

def slugs_in(v):
    return re.findall(r"insert into public\.help_articles\([^)]*\) values \('([a-z0-9-]+)'", texts[v])

EXTRA = {
    "20261032100000": [("p", "qb_payment_intent_create|QB_BELOW_MINIMUM_CHARGE")],
    "20261033100000": [("x", "public.qb_practice_menu()"), ("x", "public.qb_start_quick_practice(uuid[],integer)")],
    "20261037100000": [("r", "public.policy_versions|true|4")],
    "20261040100000": [("r", "public.help_articles|slug in (" + ",".join("''" + x + "''" for x in slugs_in("20261040100000")) + ")|" + str(len(slugs_in("20261040100000"))))],
    "20261042100000": [("r", "public.help_articles|slug in (''add-more-players'')|1")],
    "20261044100000": [("r", "public.help_articles|slug in (''sell-question-sets'',''buy-a-question-set'')|2")],
    "20261047100000": [("p", "qb_operation_failure|ATTEMPT_SAVE")],
}
# An object that an earlier migration already created proves nothing about this one (qb_free_sessions_used made 20261041 look PARTIAL on a database that lacked it).
first_seen = {}
for f in sorted(MIG.glob("*.sql")):
    t = strip_comments(f.read_text(encoding="utf-8"))
    names = [m.lower() for m in re.findall(r"create table (?:if not exists )?((?:public|quizbox_\w+)\.\w+)", t, re.I)]
    names += [m.lower() for m in re.findall(r"create (?:or replace )?function ((?:public|quizbox_\w+)\.\w+)\s*\(", t, re.I)]
    for stmt in re.findall(r"alter table (?:if exists )?(?:only )?((?:public)\.\w+)\s+([^;]*);", t, re.I):
        names += [f"{stmt[0].lower()}.{c.lower()}" for c in re.findall(r"add column (?:if not exists )?(\w+)", stmt[1], re.I)]
    for n in names:
        first_seen.setdefault(n, f.name[:14])

rows, data_only = [], []
for v in texts:
    c = checks(v) + EXTRA.get(v, [])
    (rows.extend((v, k, o) for k, o in c) if c else data_only.append(v))

HEAD = """-- QuizBox database fingerprint, part {part}. READ-ONLY: it only looks, it changes nothing.
-- Run the same part on BOTH projects (Preview fngdtxayfoiffbcbmcum and Production fmgccmqxfjppqydkhaiu) and compare the 'status' column row by row.
-- ok = every sampled object of that migration exists; PARTIAL = some do; MISSING = none do (the migration was not applied); data-only = it only inserts rows, so look at the notes.
with c(v, k, o) as (values
"""
TAIL = """), r as (
  select v, k, o, case k
    when 't' then to_regclass(o) is not null
    when 'x' then to_regprocedure(o) is null
    when 'p' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = split_part(o, '|', 1) and p.prosrc like '%' || split_part(o, '|', 2) || '%')
    when 'r' then case when to_regclass(split_part(o, '|', 1)) is null then false else coalesce((xpath('/row/c/text()', query_to_xml('select count(*) as c from ' || split_part(o, '|', 1) || ' where ' || split_part(o, '|', 2), false, true, '')))[1]::text::int, 0) >= split_part(o, '|', 3)::int end
    when 'f' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = o)
    else exists (select 1 from information_schema.columns where table_schema || '.' || table_name || '.' || column_name = o) end as ok
  from c)
select v as version, count(*) as checks, count(*) filter (where ok) as found,
  case when bool_and(ok) then 'ok' when not bool_or(ok) then 'MISSING' else 'PARTIAL' end as status,
  coalesce(string_agg(o, ', ') filter (where not ok), '') as missing
from r group by v
{data}order by 1;
"""

def build(part, vs):
    vals = ",\n".join(f"  ('{v}','{k}','{o}')" for v, k, o in rows if v in vs)
    do = [v for v in data_only if v in vs]
    data = "".join(f"union all select '{v}', 0::bigint, 0::bigint, 'data-only', ''\n" for v in do)
    if data:
        sql = HEAD.format(part=part) + vals + TAIL.replace("order by 1;", "").replace("{data}", "")
        sql = sql.rstrip().rstrip(";") + "\n" + data + "order by 1;\n"
        # a union needs the group by select wrapped so the final order by applies to everything
        sql = sql.replace("select v as version, count(*)", "select * from (select v as version, count(*)", 1).replace("from r group by v\nunion all", "from r group by v) x\nunion all", 1)
        return sql
    return HEAD.format(part=part) + vals + TAIL.replace("{data}", "")

versions = list(texts)
half = len(versions) // 2
(OUT / "db_fingerprint_A.sql").write_text(build("A", set(versions[:half])), encoding="utf-8", newline="\n")
(OUT / "db_fingerprint_B.sql").write_text(build("B", set(versions[half:])), encoding="utf-8", newline="\n")

print(f"{len(files)} migrations from {START}; parts written to {PARTS.relative_to(ROOT)}")
print("single paste:", sum(1 for i in index if i['parts'] == 1), " multi-part:", [(i['version'], i['parts']) for i in index if i['parts'] > 1])
print("data-only (no objects to check):", data_only)
print("fingerprint A chars:", len((OUT / 'db_fingerprint_A.sql').read_text()), " B chars:", len((OUT / 'db_fingerprint_B.sql').read_text()))

# 3. The named files for the code release (never "git add ."): everything changed or new, minus the unrelated work in the folder and the 16 MB of audit screenshots.
SKIP = re.compile(r"^(Questions Bank/|Images/|scripts/question-bank/|reports/|scratch/|_work/|docs/ux-audit/evidence/|\.playwright-mcp/|quizbox-expansion-plan)|\.(docx|xlsx|pyc)$")
out = subprocess.run(["git", "status", "--porcelain", "-uall"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
names = sorted({l[3:].strip().strip('"') for l in out if l[3:] and not SKIP.search(l[3:].strip().strip('"')) and not l.startswith(" D") and not l.startswith("D ")})
names = sorted(set(names) | {"scripts/release/release-files.txt"})
(ROOT / "scripts" / "release" / "release-files.txt").write_text(chr(10).join(names) + chr(10), encoding="utf-8", newline=chr(10))
print(len(names), "files named in scripts/release/release-files.txt")
