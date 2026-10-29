"""Writes docs/release/COPY_LIST.ps1: one line per paste, in the right order, each line "Get-Content ... | Set-Clipboard".
Open it in VS Code, put the cursor on a line and press Shift+Enter (Run Selection in terminal), then paste into the Supabase SQL editor and Run.
Run after make_release_kit.py:   python scripts/release/make_copy_list.py"""
import json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
idx = json.loads((ROOT / "docs" / "release" / "sql-parts" / "index.json").read_text(encoding="utf-8"))
NL = chr(10)
L = []
def add(*s): L.extend(s)
def clip(path): return f"Get-Content -Raw -Encoding UTF8 {path} | Set-Clipboard"

PROD, PREV = "PRODUCTION  (project fmgccmqxfjppqydkhaiu, the one behind main / www.quizbox.io)", "PREVIEW  (project fngdtxayfoiffbcbmcum)"
add("# QuizBox copy list. One line = one paste. Made by scripts/release/make_copy_list.py; do not edit by hand.",
    "# How: in VS Code put the cursor on a line, press Shift+Enter (runs it in the terminal). The text is now on your clipboard.",
    "#      Then Supabase > the project named in the step > SQL Editor > New query > Ctrl+V > Run. Expected: Success (no red error).",
    "# Work top to bottom. Production is the reference (main); Preview is brought up to match it. If any Run shows a red error: STOP and send me the error text.",
    "# The paths below are relative: first run this once in the terminal (adjust if your folder differs):",
    'Set-Location "C:\\Users\\USER\\OneDrive\\Documents\\QuizBox\\Codes\\QuizBox_Batch1_Student_Teacher_Assessment"',
    "")

add("# =====================================================================================================",
    "# STEP 1. LOOK (read-only, changes nothing). Run both lines on PRODUCTION, then both on PREVIEW. Keep the result tables.",
    "# =====================================================================================================",
    f"# 1a. {PROD}",
    clip(r"docs\release\db_fingerprint_A.sql") + "      # paste in PRODUCTION, Run, copy the table",
    clip(r"docs\release\db_fingerprint_B.sql") + "      # paste in PRODUCTION, Run, copy the table",
    f"# 1b. {PREV}",
    clip(r"docs\release\db_fingerprint_A.sql") + "      # paste in PREVIEW, Run, copy the table",
    clip(r"docs\release\db_fingerprint_B.sql") + "      # paste in PREVIEW, Run, copy the table",
    "# Send me the four tables. I will tell you in one line which of steps 2 and 3 to skip. (Rows that say ok are already applied: skip them.)",
    "")

new = [i for i in idx if i["version"] == "20261047100000"][0]
add("# =====================================================================================================",
    "# STEP 2. PRODUCTION: the only new migration in this release",
    "# =====================================================================================================",
    f"# {PROD}")
for p in range(1, new["parts"] + 1):
    add(clip(rf"docs\release\sql-parts\{new['version']}\p{p}.sql") + f"      # {new['version']} {new['name']}  part {p} of {new['parts']}")
add("# Check (read-only), same project:",
    "Set-Clipboard -Value \"select p.prosrc like '%ATTEMPT_SAVE%' as accepts_attempt_save from pg_proc p where p.proname = 'qb_operation_failure' and p.pronamespace = 'public'::regnamespace;\"      # expect one row: true",
    "")

add("# =====================================================================================================",
    "# STEP 3. PREVIEW: bring it up to match Production, oldest first. SKIP every migration whose fingerprint row said ok on Preview.",
    "# Never apply a later one before an earlier MISSING one. Never run a migration twice.",
    "# =====================================================================================================",
    f"# {PREV}")
for m in idx:
    head = f"# ---- {m['version']}  {m['name']}  ({m['parts']} part{'s' if m['parts'] > 1 else ''})"
    add(head)
    if m["note"] and m["version"] != "20261047100000":
        add(f"#      NOTE: {m['note']}")
    for p in range(1, m["parts"] + 1):
        add(clip(rf"docs\release\sql-parts\{m['version']}\p{p}.sql") + f"      # part {p} of {m['parts']}")
add("")

add("# =====================================================================================================",
    "# STEP 4. PROVE THEY MATCH (read-only): run the four fingerprint lines from step 1 again. Every row must say ok on both projects.",
    "# =====================================================================================================",
    "")
add("# =====================================================================================================",
    "# STEP 5. CODE. Only after step 4 is clean on Preview. These are PowerShell commands, so run each block in the terminal, not in Supabase.",
    "# =====================================================================================================",
    "# 5a. Preview first: branch, named files only, commit, push (Vercel builds a Preview). Wait until it says Ready and test it.",
    "git checkout -b release/ux-and-resilience-2026-10-24",
    "git --literal-pathspecs add --pathspec-from-file=scripts/release/release-files.txt",
    "git status --short",
    'git commit -m "UX audit fixes: accessibility, offline and save queue, caching, share cards, button system; release kit"',
    "git push -u origin release/ux-and-resilience-2026-10-24",
    "# 5b. Production (main), only when the Preview is good:",
    "git fetch origin",
    "git merge-base --is-ancestor origin/main HEAD; if ($?) { 'OK: main can be fast-forwarded' } else { 'STOP: main has moved on, do not push' }",
    "git push origin release/ux-and-resilience-2026-10-24:main",
    "# Undo for the database change, if ever needed (paste in Supabase):",
    clip(r"supabase\rollback\attempt_save_failure_log.sql") + "      # puts qb_operation_failure back as it was",
    "")
out = ROOT / "docs" / "release" / "COPY_LIST.ps1"
out.write_text(NL.join(L), encoding="utf-8", newline=NL)
print(f"{sum(1 for l in L if l.startswith('Get-Content'))} copy lines written to {out.relative_to(ROOT)}")


# ---- Optional second file, written when you pass what the fingerprint found missing:
#   python scripts/release/make_copy_list.py --production 20261044100000 --preview 20261035100000,20261036100000,...
import sys
def opt(name):
    return sys.argv[sys.argv.index(name) + 1].split(",") if name in sys.argv else None
if opt("--production") is not None or opt("--preview") is not None:
    prod_v, prev_v = opt("--production") or [], opt("--preview") or []
    by = {i["version"]: i for i in idx}
    N = []
    N += ["# QuizBox NEXT copy list, built from your fingerprint results. One line = one paste (VS Code: cursor on the line, Shift+Enter).",
          "# Supabase > the project named in the step > SQL Editor > New query > Ctrl+V > Run. Expected: Success. Any red error: STOP and send me the error text.",
          'Set-Location "' + str(ROOT) + '"', ""]
    if (ROOT / "docs" / "release" / "DIAGNOSE_PREVIEW_37_45.sql").exists():
        N += ["# =====================================================================================================",
              "# 0. OPTIONAL, READ-ONLY: which pieces of migrations 37 and 45 are missing on PREVIEW? Paste in PREVIEW, Run: each MISSING row names the part.",
              "# Both migrations are safe to run again in full (37 inserts a policy only if it has no version yet; 45 is create-or-replace only), so section B below is correct either way.",
              "# =====================================================================================================",
              clip(r"docs\release\DIAGNOSE_PREVIEW_37_45.sql") + "      # paste in PREVIEW, Run", ""]
    def block(title, versions):
        N.extend(["# =====================================================================================================", f"# {title}", "# ====================================================================================================="])
        for v in versions:
            m = by[v]
            N.append(f"# ---- {m['version']}  {m['name']}  ({m['parts']} part{'s' if m['parts'] > 1 else ''})")
            if v == "20261045100000" and "20261046100000" in versions:
                N.append("#      NOTE: 46 is already on this project. Running 45 puts the 22-dataset export list back, so 46 is run again straight after (both are create-or-replace only, so this is safe). Do all of 45, then all of 46.")
            elif v == "20261046100000" and "20261045100000" in versions:
                N.append("#      NOTE: run this straight after 45, in full. It restores the 31-dataset export list.")
            elif m["note"] and v != "20261047100000": N.append(f"#      NOTE: {m['note']}")
            for p in range(1, m["parts"] + 1):
                N.append(clip(rf"docs\release\sql-parts\{v}\p{p}.sql") + f"      # part {p} of {m['parts']}")
        N.append("")
    if prod_v:
        block("A. PRODUCTION (project fmgccmqxfjppqydkhaiu, main). Only what its fingerprint said MISSING.", prod_v)
    if prev_v:
        block("B. PREVIEW (project fngdtxayfoiffbcbmcum). Oldest first. Do not skip one or change the order.", prev_v)
    N += ["# =====================================================================================================", "# C. PROVE THEY MATCH (read-only). Run on PRODUCTION, then on PREVIEW. Every row must say ok on both.", "# =====================================================================================================",
          clip(r"docs\release\db_fingerprint_A.sql") + "      # paste in the project, Run, copy the table",
          clip(r"docs\release\db_fingerprint_B.sql") + "      # paste in the project, Run, copy the table", ""]
    (ROOT / "docs" / "release" / "COPY_LIST_NEXT.ps1").write_text(NL.join(N), encoding="utf-8", newline=NL)
    print(f"{sum(1 for l in N if l.startswith('Get-Content'))} copy lines written to docs/release/COPY_LIST_NEXT.ps1")
