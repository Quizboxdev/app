#!/usr/bin/env python3
"""Build one upload-ready zip per generator account (A1..A8) in Questions Bank/_kits/.

Each kit keeps the repo layout (scripts/question-bank/bank.py, docs/question-bank/PACK_PROMPT.md, Questions Bank/_work/...) so bank.py runs unchanged
once the zip is unpacked in a cloud workspace. A kit holds only that account's packs; a unit is never split across accounts, so the finished
files from different accounts can be copied into the main Questions Bank without clashing.

Usage: python scripts/question-bank/make_kits.py      (run make_packs.py first)
"""
import csv, zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
WORK = REPO / "Questions Bank" / "_work"
KITS = REPO / "Questions Bank" / "_kits"

START = """START HERE  (QuizBox question generation kit, ACCOUNT = {acct})

You are a question writer for QuizBox, a Ghanaian school learning platform. This kit is your whole workspace; unpack it and work inside it.
Do not look for files anywhere else.

STEP 0. Read, in this order, and follow them exactly:
  1. docs/question-bank/PACK_PROMPT.md   (the writing rules are the prompt inside its FIRST code block; the loop is under "Mode B")
  2. Questions Bank/README.txt
  3. Questions Bank/_work/WORK_QUEUE.csv   (only this account's packs are listed)

STEP 1. Take the rows with status = TODO in file order. Work one pack at a time. Skip rows with status DEFERRED (planned for later, once every subject has reached its first target) and DONE.

STEP 2. For each pack:
  a. Read its sheet (the "sheet" column, under Questions Bank/_work/). The sheet is your ONLY source.
  b. Write all questions for the pack (10 topics x 50) by the rules in PACK_PROMPT.md. Write each question individually.
  c. Save them as ONE CSV with the header row at: Questions Bank/_work/returns/<pack_id>.csv
  d. Run: python scripts/question-bank/bank.py assemble
  e. Read Questions Bank/_work/reports/<Grade>_<Subject>_report.txt and its _gaps.csv. If any topic is short or rows were rejected,
     write ONLY the missing questions (the top-up rule), save as returns/<pack_id>_topup.csv, run assemble again. Repeat up to 3 times.
  f. Set the pack's status in WORK_QUEUE.csv to DONE (or NEEDS_REVIEW plus a one-line note if still short).
  g. Start the next pack.

DELIVERY. After every pack, copy the finished files to the Google Drive folder "QuizBox_Output/{acct}/" so nothing is lost if this session ends:
  Questions Bank/Primary, JHS and SHS (the final <Grade>_<Subject>_<count>.csv files), Questions Bank/_work/WORK_QUEUE.csv,
  and Questions Bank/_work/reports and _work/rejects. If you cannot write to Drive, tell me and keep the files in the workspace.

RULES YOU MUST NOT BREAK
  - Real, examinable questions only. Never ask about the curriculum, a strand, an indicator, a code or "what the document says".
  - Difficulty must match cognitive level: easy = Remember or Understand; medium = Understand, Apply or Analyse; hard = Apply, Analyse or Evaluate.
  - No duplicates and no reworded copies, in the pack or across the subject.
  - Never invent indicator codes; copy them from the pack sheet.
  - Never edit files in Questions Bank/Primary, JHS or SHS by hand. Only bank.py writes there.
  - No outside question banks or past papers.

STOP and report to me if the checker rejects more than 20 percent of a pack twice in a row, a sheet is missing or unreadable, or you cannot
keep the quality up. Otherwise keep going without asking me anything. After every 5 packs print one line: packs done, questions accepted,
rejects, packs needing review.
"""

def main():
    rows = list(csv.DictReader(open(WORK / "WORK_QUEUE.csv", encoding="utf-8-sig")))
    if not rows: raise SystemExit("WORK_QUEUE.csv is empty: run make_packs.py first")
    # A kit carries only the packs still to be written (TODO, or under way). DONE and DEFERRED packs stay out, so a kit is exactly one account's next work, neediest subject first.
    rows = [r for r in rows if r["status"] in ("TODO", "IN_PROGRESS", "DOING", "NEEDS_REVIEW")]
    if not rows: raise SystemExit("Nothing to write: every pack is DONE or DEFERRED. Raise the target with make_packs.py --target to plan more.")
    KITS.mkdir(parents=True, exist_ok=True)
    common = [(REPO / "docs/question-bank/PACK_PROMPT.md", "docs/question-bank/PACK_PROMPT.md"),
              (REPO / "scripts/question-bank/bank.py", "scripts/question-bank/bank.py"),
              (REPO / "Questions Bank/README.txt", "Questions Bank/README.txt")]
    for acct in sorted({r["account"] for r in rows}):
        mine = [r for r in rows if r["account"] == acct]
        z = KITS / f"QuizBox_GenKit_{acct}.zip"
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("START_HERE.txt", START.format(acct=acct))
            for src, name in common: zf.write(src, name)
            for lvl in ("Primary", "JHS", "SHS"): zf.writestr(f"Questions Bank/{lvl}/.keep", "")
            zf.writestr("Questions Bank/_work/returns/.keep", "")
            import io
            buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=list(mine[0].keys())); w.writeheader(); w.writerows(mine)
            zf.writestr("Questions Bank/_work/WORK_QUEUE.csv", "﻿" + buf.getvalue())
            for r in mine: zf.write(WORK / r["sheet"], f"Questions Bank/_work/{r['sheet']}")
        print(f"{z.name}: {len(mine)} packs, {sum(int(r['questions']) for r in mine):,} questions, {z.stat().st_size // 1024} KB")

if __name__ == "__main__":
    main()
