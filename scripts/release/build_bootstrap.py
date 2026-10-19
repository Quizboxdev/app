#!/usr/bin/env python3
"""Tracker C7: turn the exported production-only objects into bootstrap migrations placed at the right points of the chain.

Input : docs/release/engine/production_only_objects.sql.txt  (the owner's export of query 24: a table whose cells hold the SQL, with <br> for new lines
        and \\| for each pipe)
Output: docs/release/engine/bootstrap_generated/<time>_bootstrap_<n>.sql files (NOT in supabase/migrations: see the status note below), each placed just before the first
        migration that needs the objects in it.
STATUS (19 October 2026): with these in place the replay gets past the first helpers and then stops on COLUMNS that were added by hand to tables the chain
        does create (for example questions.answer_type). Closing that gap needs a full schema dump of production (pg_dump --schema-only), which also gives the
        owner the backup the plan needs. This generator is kept as the fallback if a dump is not possible.
Every object is created only if it is missing, so on production (where all of them already exist) the files change nothing; on an empty database they
supply what the hand-made production objects provided. Tables lose the columns that LATER migrations add (those migrations add them again).

  python scripts/release/build_bootstrap.py
"""
import re, sys
from datetime import datetime, timedelta
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MIG = REPO / "supabase" / "migrations"
EXPORT = REPO / "docs" / "release" / "engine" / "production_only_objects.sql.txt"
OUT = REPO / "docs" / "release" / "engine" / "bootstrap_generated"
Q = "$qb_bootstrap$"

def load_objects():
    rows = []
    for line in EXPORT.read_text(encoding="utf-8").split("\n"):
        if not line.startswith("|"): continue
        cell = re.sub(r"\s+\|\s*$", "", re.sub(r"^\|\s", "", line))
        rows.append(cell.replace("<br>", "\n").replace("\\|", "|"))
    objs = []
    for r in rows[2:]:
        m = re.match(r"-- (FUNCTION|TABLE) ([a-z_0-9]+)\.([A-Za-z_0-9]+)\n(.*)$", r, re.S)
        if m: objs.append({"kind": m.group(1).lower(), "schema": m.group(2), "name": m.group(3), "ddl": m.group(4).strip()})
    return objs

def migration_texts():
    out = []
    for f in sorted(MIG.glob("*.sql")):
        if "bootstrap" in f.name: continue
        out.append((f.name, re.sub(r"--[^\n]*", "", f.read_text(encoding="utf-8", errors="replace"))))
    return out

def defined_by_chain(texts):
    d = set()
    for _, t in texts:
        for m in re.finditer(r"create\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?(\w+)\s*\(", t, re.I): d.add(((m.group(1) or "public"), m.group(2)))
        for m in re.finditer(r"create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?(\w+)", t, re.I): d.add(((m.group(1) or "public"), m.group(2)))
    return d

def later_added_columns(texts, tables):
    cols = defaultdict(set)
    for _, t in texts:
        for m in re.finditer(r"alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?(\w+)\s+(.*?);", t, re.I | re.S):
            if m.group(1) in tables:
                for c in re.finditer(r"add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)", m.group(2), re.I): cols[m.group(1)].add(c.group(1))
    return cols

def strip_columns(ddl, drop):
    out = []
    for line in ddl.split("\n"):
        m = re.match(r'\s{2}"?(\w+)"?\s', line)
        if m and m.group(1) in drop: continue
        out.append(line)
    text = "\n".join(out)
    return re.sub(r",\n\)\s*;$", "\n);", text)

def first_use(obj, texts):
    pat = (re.compile(rf"\b{obj['schema']}\.{obj['name']}\b") if obj["schema"] != "public" else re.compile(rf"(?<![\w.]){obj['name']}\b|public\.{obj['name']}\b"))
    for i, (_, t) in enumerate(texts):
        if pat.search(t): return i
    return None

def main():
    objs = load_objects()
    texts = migration_texts()
    known = defined_by_chain(texts)
    # One helper is missing from the export (an earlier stub of ours hid it from the query): an approximation until the owner exports its real text.
    # select pg_get_functiondef('public.qb_is_platform_admin()'::regprocedure);  replaces this entry.
    if not any(o["name"] == "qb_is_platform_admin" for o in objs):
        nl = chr(10)
        objs.append({"kind": "function", "schema": "public", "name": "qb_is_platform_admin", "ddl": nl.join([
            "CREATE OR REPLACE FUNCTION public.qb_is_platform_admin()", " RETURNS boolean", " LANGUAGE sql", " STABLE SECURITY DEFINER", " SET search_path TO ''", "AS $function$",
            "select auth.uid() is not null and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) in ('admin', 'owner') and lower(p.status::text) = 'active')",
            "$function$;"])})
    objs = [o for o in objs if (o["schema"], o["name"]) not in known]          # objects the chain now creates itself (for example this week's functions)
    tables = {o["name"] for o in objs if o["kind"] == "table"}
    drop = later_added_columns(texts, tables)
    for o in objs:
        if o["kind"] == "table": o["ddl"] = strip_columns(o["ddl"], drop.get(o["name"], set()))
    groups = defaultdict(list); never = []
    for o in objs:
        i = first_use(o, texts)
        (groups[i] if i is not None else never).append(o)
    OUT.mkdir(parents=True, exist_ok=True)
    for f in OUT.glob("*_bootstrap_*.sql"): f.unlink()
    written = []
    # schemas must exist before functions in them are created: place such groups at least at the migration after the schema's creation
    schema_created = {}
    for i, (name, t) in enumerate(texts):
        for m in re.finditer(r"create\s+schema\s+(?:if\s+not\s+exists\s+)?(\w+)", t, re.I): schema_created.setdefault(m.group(1), i)
    merged = defaultdict(list)
    for i, objs_in in groups.items():
        for o in objs_in:
            at = i
            if o["schema"] != "public": at = max(i, schema_created.get(o["schema"], i) + 1) if o["schema"] in schema_created else i
            merged[at].append(o)
    for n, i in enumerate(sorted(merged)):
        prefix = texts[i][0][:14]
        try: stamp = (datetime.strptime(prefix, "%Y%m%d%H%M%S") - timedelta(seconds=1)).strftime("%Y%m%d%H%M%S")   # one second before the migration that first needs these objects
        except ValueError: stamp = str(int(prefix) - 1)                       # a few early migrations use hours 24 to 28 as ordering numbers; plain subtraction still sorts first
        body = [f"-- Bootstrap {n + 1} (tracker C7). Objects created by hand on the hosted production database and needed from {texts[i][0]} on.",
                "-- Each is created ONLY IF MISSING: on production nothing changes; on an empty database this supplies them. Generated by scripts/release/build_bootstrap.py.",
                "begin;", "set local check_function_bodies = off;", ""]
        for o in sorted(merged[i], key=lambda o: (o["kind"] != "table", o["schema"], o["name"])):
            if o["kind"] == "table":
                body.append(o["ddl"])
            else:
                sig = re.search(r"FUNCTION\s+([\w.]+)\((.*?)\)\s*\n", o["ddl"], re.S)
                args = re.sub(r"\s+DEFAULT\s+[^,)]*(?:\([^)]*\))?[^,)]*", "", sig.group(2)) if sig else ""
                argtypes = ", ".join(a.strip().split(" ", 1)[1] if " " in a.strip() else a.strip() for a in args.split(",") if a.strip()) if args.strip() else ""
                body.append(f"do $boot$ begin if to_regprocedure('{o['schema']}.{o['name']}({argtypes})') is null then execute {Q}\n{o['ddl'].rstrip(';').rstrip()}\n{Q}; end if; end $boot$;")
        body += ["", "commit;", ""]
        path = OUT / f"{stamp}_bootstrap_{n + 1}.sql"
        path.write_text("\n".join(body), encoding="utf-8"); written.append((path.name, len(merged[i])))
    print(f"{len(objs)} production-only objects -> {len(written)} bootstrap migrations; {len(never)} objects not referenced by any migration (skipped)")
    for n, c in written: print(" ", n, c, "objects")
    if never: print("  unreferenced:", ", ".join(f"{o['schema']}.{o['name']}" for o in never))

if __name__ == "__main__":
    main()
