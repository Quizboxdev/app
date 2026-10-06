#!/usr/bin/env python3
"""Assemble the production cleanup scripts from committed source, deterministically.

  scripts/release/production-cleanup-v2.template.sql   the execute-only sections (pre-flight, frozen plans, deletion, post assertions, report)
  docs/uat/production-cleanup-dry-run-v2.sql           the reviewed engine; three slices (sets, definitions, run) are copied byte-for-byte, never re-typed

outputs: docs/uat/production-cleanup-v2.sql              the cleanup (commits only after every assertion)
         docs/uat/production-cleanup-v2-diagnostic.sql   the SAME cleanup transaction from the same template, but it can never commit

usage: build-cleanup-v2.py           write both files
       build-cleanup-v2.py --check   write nothing; exit 1 if either checked-in file differs from what this generator produces

The diagnostic variant differs from the real script in exactly three places: the diagnostic mode flag, a banner, and the last statement (it raises
DIAGNOSTIC_ROLLBACK with a report instead of COMMIT).

Refuses to generate if the engine slices differ from the reviewed ones (REVIEWED_ENGINE_SHA256), if a slice marker or template placeholder is missing or
repeated, or if the per-table pins in the template are not the reviewed ones. Output is always UTF-8 with CRLF line endings, whatever the platform.
"""
import hashlib, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DRY = ROOT / "docs/uat/production-cleanup-dry-run-v2.sql"
TEMPLATE = ROOT / "scripts/release/production-cleanup-v2.template.sql"
OUT = ROOT / "docs/uat/production-cleanup-v2.sql"
OUT_DIAG = ROOT / "docs/uat/production-cleanup-v2-diagnostic.sql"

# sha256 of (sets + definitions + run), as reviewed. Changing the engine means a new review: update this value only together with that review.
REVIEWED_ENGINE_SHA256 = "abfc43927d4a517f838e84fd61274ef5c4fb4aaed3b8ac9817a0fa231a2be6b5"
# reviewed per-table cleanup-plan pins (sum = rows_proposed_for_deletion = 1154)
REVIEWED_PIN_COUNT, REVIEWED_PIN_TOTAL, REVIEWED_AGGREGATE = 37, 1154, 1154
NL = "\n"
PLACEHOLDERS = ("/*ENGINE_HASH*/", "/*SETS*/", "/*ENGINE_DEFS*/", "/*ENGINE_RUN*/", "/*VARIANT_NOTE*/" + NL, "/*FORCE_ROLLBACK*/", "/*END_OF_TRANSACTION*/" + NL)

COMMIT = "commit;   -- reached only if every assertion above passed" + NL
DIAG_NOTE = ("-- *** DIAGNOSTIC VARIANT: performs the same cleanup transaction as production-cleanup-v2.sql and then ALWAYS ROLLS BACK (this file contains no COMMIT). ***" + NL +
             "-- *** It is not the cleanup. It ends by raising DIAGNOSTIC_ROLLBACK, whose message is the diagnostic report (market discovery, fingerprints, triggers, foreign keys). ***" + NL)
DIAG_END = """do $diag_end$
begin
  raise exception 'DIAGNOSTIC_ROLLBACK: every post assertion passed or was diagnosed; the transaction is rolled back and NOTHING was committed. REPORT: %',
    jsonb_pretty(pg_temp.diag_report() || jsonb_build_object('assertions', (select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'result', a.result) order by a.seq), '[]') from _assertions a),
                                                              'log', (select coalesce(jsonb_agg(jsonb_build_object('phase', l.phase, 'step', l.step, 'rows', l.rows) order by l.seq), '[]') from _log l)));
end $diag_end$;
"""


def read(path):
    return path.read_text(encoding="utf-8").replace("\r\n", NL)


def once(text, marker, where):
    if text.count(marker) != 1:
        sys.exit(f"REFUSED: marker {marker!r} must appear exactly once in {where} (found {text.count(marker)})")
    return text.index(marker)


def slices(dry):
    a = once(dry, "-- >>> SETS BEGIN", DRY.name); b = once(dry, "-- <<< SETS END", DRY.name) + len("-- <<< SETS END")
    c = once(dry, "-- looser seed for assessments", DRY.name); d = once(dry, "set transaction read only;", DRY.name)
    e = once(dry, "-- ------------------------------------------------------------ run the engine", DRY.name)
    f = once(dry, "-- ------------------------------------------------------------ 2. proposals by table", DRY.name)
    if not (a < b <= c < d <= e < f):
        sys.exit("REFUSED: engine slice markers are out of order in the dry-run")
    return dry[a:b], dry[c:d].rstrip() + NL, dry[e:f].rstrip() + NL


def check_pins(tpl):
    m = re.search(r"insert into _expect_table values\n(.*?);\n", tpl, re.S)
    if not m:
        sys.exit("REFUSED: template has no _expect_table pins")
    pins = re.findall(r"\('([a-z_]+\.[a-z_]+)', (\d+)\)", m.group(1))
    if len(pins) != REVIEWED_PIN_COUNT or len({p[0] for p in pins}) != len(pins) or sum(int(p[1]) for p in pins) != REVIEWED_PIN_TOTAL:
        sys.exit(f"REFUSED: per-table pins are not the reviewed ones ({len(pins)} tables, sum {sum(int(p[1]) for p in pins)}; expected {REVIEWED_PIN_COUNT} / {REVIEWED_PIN_TOTAL})")
    if f"('rows_proposed_for_deletion', {REVIEWED_AGGREGATE})" not in tpl:
        sys.exit("REFUSED: template aggregate pin rows_proposed_for_deletion is not the reviewed value")


def build():
    sets, defs, run = slices(read(DRY))
    digest = hashlib.sha256((sets + defs + run).encode("utf-8")).hexdigest()
    if digest != REVIEWED_ENGINE_SHA256:
        sys.exit(f"REFUSED: the dry-run engine slices differ from the reviewed engine.\n  reviewed {REVIEWED_ENGINE_SHA256}\n  found    {digest}\n"
                 "Review the engine change, then update REVIEWED_ENGINE_SHA256 deliberately.")
    tpl = read(TEMPLATE)
    for ph in PLACEHOLDERS:
        once(tpl, ph, TEMPLATE.name)
    check_pins(tpl)
    header = f"Engine slices copied verbatim from docs/uat/production-cleanup-dry-run-v2.sql (sets, definitions, run); sha256 of the concatenation = {digest}"
    out = tpl.replace("/*ENGINE_HASH*/", header).replace("/*SETS*/", sets).replace("/*ENGINE_DEFS*/", defs).replace("/*ENGINE_RUN*/", run)
    real = out.replace("/*VARIANT_NOTE*/" + NL, "").replace("/*FORCE_ROLLBACK*/", "false").replace("/*END_OF_TRANSACTION*/" + NL, COMMIT)
    diag = out.replace("/*VARIANT_NOTE*/" + NL, DIAG_NOTE).replace("/*FORCE_ROLLBACK*/", "true").replace("/*END_OF_TRANSACTION*/" + NL, DIAG_END)
    crlf = lambda text: text.replace(NL, "\r\n").encode("utf-8")
    return {OUT: crlf(real), OUT_DIAG: crlf(diag)}, digest


def main(argv):
    files, digest = build()
    if "--check" in argv:
        for path, data in files.items():
            if not path.exists() or path.read_bytes() != data:
                sys.exit(f"MISMATCH: {path.relative_to(ROOT)} is not what the generator produces from the committed template and dry-run")
            print(f"OK: {path.relative_to(ROOT)} equals the generated output; engine sha256 {digest}")
        return
    for path, data in files.items():
        path.write_bytes(data)
        print(f"wrote {path.relative_to(ROOT)}; engine sha256 {digest}")


if __name__ == "__main__":
    main(sys.argv[1:])
