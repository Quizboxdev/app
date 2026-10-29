#!/usr/bin/env python3
"""Build generation packs from the verified curriculum files, and plan which of them to write next.

A pack is a short text sheet of up to 10 learning indicators (one topic each, 50 questions per topic = up to 500 questions) with the printed
code, wording, exemplars and page. It is attached to a fresh AI chat together with the constant prompt in docs/question-bank/PACK_PROMPT.md,
so the chat never has to guess the topics. Also writes WORK_QUEUE.csv (packs shared across the generator accounts), a per-unit summary and FOCUS_PLAN.csv.

FOCUS (default): bring every subject to a good level first, then expand later.
  A "subject" is a level plus a subject name (for example JHS Science, across all its grades). Each subject is planned up to --target questions
  (default 5,000). Subjects already at or above the target are DEFERRED, not dropped; the packs a below-target subject still needs are chosen so
  that its grades are filled evenly (first pack of every grade, then the second, and so on) and are marked TODO. The generator accounts only take
  TODO rows, in file order, so the neediest subject comes first. To expand later, run again with a bigger --target: DEFERRED packs become TODO.
  What already exists is counted from the final files in Questions Bank/<Level>/ (the bank is the source of truth, not the status column).
  Statuses a person or agent set (DONE, IN_PROGRESS, DOING, NEEDS_REVIEW, notes, returned_file) are kept; only TODO and DEFERRED are decided here.
  A subject whose whole curriculum at 50 questions per topic is below the target is planned in full and reported as "curriculum exhausted".

Usage:  python scripts/question-bank/make_packs.py [--target 5000] [--all] [--dry-run] [--verified DIR] [--out DIR] [--accounts 8] [--pack-size 10]
        --all      old behaviour: every pack not yet done is TODO (no focus, no deferral)
        --dry-run  print the plan and write nothing
After it runs: python scripts/question-bank/make_kits.py   (rebuilds the account kits from the new queue)
"""
import os
import argparse, csv, re, sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CONTENT = Path(os.environ.get("QUIZBOX_CONTENT") or REPO)   # folder that contains "Questions Bank" (default: the repo root)
BANK = CONTENT / "Questions Bank"
SOURCES = [("Primary", "Primary_indicators_reconciled.csv"), ("Primary", "Primary_English_Ghanaian_reconciled.csv"),
           ("Primary", "Primary_Creative_Arts_reconciled.csv"), ("JHS", "JHS_indicators_verified.csv"), ("SHS", "SHS_indicators_verified.csv")]
PER_TOPIC = 50
LEVEL_ORDER = {"Primary": 0, "JHS": 1, "SHS": 2}
KEEP = {"DONE", "IN_PROGRESS", "DOING", "NEEDS_REVIEW"}      # set by people or agents: never overwritten
ACTIVE = ("IN_PROGRESS", "DOING", "NEEDS_REVIEW")            # work already under way: counted towards the target as if finished
COLS = ["pack_id", "level", "grade", "subject", "pack", "topics", "questions", "sheet", "account", "status", "returned_file", "notes",
        "subject_built", "subject_target", "plan_order"]

def safe(s):  # file-name form of a subject or grade
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")

def grade_key(g):
    m = re.search(r"(\d+)", g or ""); return (0 if (g or "").upper().startswith("B") else 1, int(m.group(1)) if m else 99)

def built_by_subject():
    """Questions already accepted into the final files, per (level, subject): one row of a final CSV is one question."""
    out = defaultdict(int)
    for level in LEVEL_ORDER:
        for f in sorted((BANK / level).glob("*.csv")) if (BANK / level).exists() else []:
            with open(f, encoding="utf-8-sig", newline="") as fh:
                for r in csv.DictReader(fh): out[(level, r["subject"])] += 1
    return out

def plan_focus(queue, built, target):
    """Marks each queued pack TODO or DEFERRED. Returns the per-subject plan rows."""
    by_subject = defaultdict(list)
    for q in queue: by_subject[(q["level"], q["subject"])].append(q)
    plan = []
    for key, packs in by_subject.items():
        have = built.get(key, 0)
        under_way = sum(int(q["questions"]) for q in packs if q["status"] in ACTIVE)
        need = max(0, target - have - under_way)
        candidates = [q for q in packs if q["status"] not in KEEP]            # TODO or DEFERRED: still ours to decide
        candidates.sort(key=lambda q: (int(q["pack"].split("/")[0]), grade_key(q["grade"]), q["pack_id"]))   # first pack of every grade, then the second ...
        chosen, got = [], 0
        for q in candidates:
            if got >= need: break
            chosen.append(q); got += int(q["questions"])
        for q in candidates: q["status"] = "TODO" if q in chosen else "DEFERRED"
        for i, q in enumerate(chosen, 1): q["_rank"] = i
        for q in packs: q["subject_built"] = have; q["subject_target"] = target
        left = [q for q in candidates if q not in chosen]
        projected = have + under_way + got
        plan.append({"level": key[0], "subject": key[1], "grades_in_curriculum": ", ".join(sorted({q["grade"] for q in packs}, key=grade_key)),
                     "built_now": have, "under_way": under_way, "target": target, "gap": max(0, target - have), "packs_to_write": len(chosen), "questions_to_write": got,
                     "projected_total": projected, "reaches_target": "YES" if projected >= target else "NO: curriculum exhausted at 50 per topic",
                     "packs_deferred": len(left), "questions_deferred": sum(int(q["questions"]) for q in left)})
    return plan

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verified", default=str(REPO.parent.parent / "curriculum_verified"))
    ap.add_argument("--out", default=str(BANK / "_work"))
    ap.add_argument("--accounts", type=int, default=8)
    ap.add_argument("--pack-size", type=int, default=10)
    ap.add_argument("--target", type=int, default=5000, help="questions each subject should reach before any subject is expanded further")
    ap.add_argument("--all", action="store_true", help="no focus: every pack not yet done is TODO")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    out = Path(a.out); packs_dir = out / "packs"
    units = defaultdict(list)
    for level, fname in SOURCES:
        p = Path(a.verified) / fname
        if not p.exists(): print("MISSING", p, file=sys.stderr); continue
        for r in csv.DictReader(open(p, encoding="utf-8-sig")):
            units[(level, r["grade"], r["subject"])].append(r)
    old = {}
    if (out / "WORK_QUEUE.csv").exists():
        for r in csv.DictReader(open(out / "WORK_QUEUE.csv", encoding="utf-8-sig")): old[r["pack_id"]] = r
    queue = []
    for (level, grade, subject), rows in sorted(units.items(), key=lambda kv: (LEVEL_ORDER[kv[0][0]], grade_key(kv[0][1]), kv[0][2])):
        total = (len(rows) + a.pack_size - 1) // a.pack_size
        for n in range(total):
            chunk = rows[n * a.pack_size:(n + 1) * a.pack_size]
            pid = f"{safe(grade)}_{safe(subject)}_P{n + 1:02d}"
            d = packs_dir / level / f"{safe(grade)}_{safe(subject)}"
            if not a.dry_run:
                d.mkdir(parents=True, exist_ok=True)
                lines = [f"QUIZBOX GENERATION PACK {pid}", f"LEVEL: {level.upper()}", f"GRADE: {grade}", f"SUBJECT: {subject}",
                         f"PACK: {n + 1} of {total}", f"TOPICS IN THIS PACK: {len(chunk)}  (each topic = 1 learning indicator, {PER_TOPIC} questions each)",
                         f"QUESTIONS TO WRITE: {len(chunk) * PER_TOPIC}", "",
                         "This sheet is the ONLY source. Quote verbatim from the INDICATOR and EXEMPLARS lines below.", ""]
                for i, r in enumerate(chunk, 1):
                    topic = re.sub(r"\s+", " ", r["indicator"]).strip()
                    ex = re.sub(r"\s+", " ", r.get("exemplars", "") or "").strip()
                    lines += [f"=== TOPIC {i} ===", f"TOPIC NAME: {topic}", f"STRAND: {r.get('strand', '')}", f"SUB-STRAND: {r.get('sub_strand', '')}",
                              f"CONTENT STANDARD: {r.get('content_standard_code', '')} {r.get('content_standard', '')}".strip(),
                              f"INDICATOR CODE: {r['indicator_code']}", f"INDICATOR: {topic}",
                              f"EXEMPLARS: {ex or '(none printed: use the indicator wording only)'}",
                              f"PAGE: {r.get('page', '')}", ""]
                (d / f"{pid}.txt").write_text("\n".join(lines), encoding="utf-8")
            prev = old.get(pid, {})
            status = prev.get("status") if prev.get("status") in KEEP else "TODO"
            queue.append({"pack_id": pid, "level": level, "grade": grade, "subject": subject, "pack": f"{n + 1}/{total}",
                          "topics": len(chunk), "questions": len(chunk) * PER_TOPIC, "sheet": str((d / f"{pid}.txt").relative_to(out).as_posix()),
                          "account": prev.get("account", ""), "status": status, "returned_file": prev.get("returned_file", ""), "notes": prev.get("notes", ""),
                          "subject_built": 0, "subject_target": a.target, "plan_order": 0})
    built = built_by_subject()
    if a.all:
        plan = []
        for q in queue: q["subject_built"] = built.get((q["level"], q["subject"]), 0)
    else:
        plan = plan_focus(queue, built, a.target)
    # Balance the accounts over the packs still to be written (TODO and under way). A subject's packs stay together where possible (same subject reads
    # best in one chat series), neediest subjects first. Finished and deferred packs keep whatever account they had.
    work = [q for q in queue if q["status"] == "TODO" or q["status"] in ACTIVE]
    by_unit = defaultdict(list)
    for q in work: by_unit[(q["level"], q["subject"])].append(q)
    load = [0] * a.accounts
    for key, qs in sorted(by_unit.items(), key=lambda kv: (built.get(kv[0], 0), -sum(int(q["questions"]) for q in kv[1]))):
        k = load.index(min(load))
        for q in qs:
            if q["status"] == "TODO" or not q["account"]: q["account"] = f"A{k + 1}"
        load[k] += sum(int(q["questions"]) for q in qs if q["status"] == "TODO")
    rank = {"IN_PROGRESS": 0, "DOING": 0, "NEEDS_REVIEW": 0, "TODO": 1, "DEFERRED": 2, "DONE": 3}
    queue.sort(key=lambda q: (rank.get(q["status"], 1), q["subject_built"], LEVEL_ORDER[q["level"]], q["subject"], q.get("_rank", 999), grade_key(q["grade"]), q["pack_id"]))
    for i, q in enumerate(queue, 1): q["plan_order"] = i
    todo = [q for q in queue if q["status"] == "TODO"]
    print(f"{len(units)} units, {len(queue)} packs: {len(todo)} TODO ({sum(int(q['questions']) for q in todo):,} questions), "
          f"{sum(1 for q in queue if q['status'] == 'DEFERRED')} DEFERRED, {sum(1 for q in queue if q['status'] == 'DONE')} DONE, {sum(1 for q in queue if q['status'] in ACTIVE)} under way")
    for i, v in enumerate(load, 1): print(f"  account A{i}: {v:,} questions to write")
    if plan:
        print(f"\nFocus plan (target {a.target:,} per subject):")
        for p in sorted(plan, key=lambda p: (p["built_now"], LEVEL_ORDER[p["level"]], p["subject"])):
            if p["packs_to_write"] or p["gap"]:
                print(f"  {p['level']:<8}{p['subject'][:34]:<36}built {p['built_now']:>6,}  + {p['questions_to_write']:>6,} in {p['packs_to_write']:>3} packs  -> {p['projected_total']:>6,}  {p['reaches_target'] if p['reaches_target'] != 'YES' else ''}")
    if a.dry_run: print("\n(dry run: nothing written)"); return
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "WORK_QUEUE.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=COLS, extrasaction="ignore"); w.writeheader(); w.writerows(queue)
    with open(out / "UNIT_SUMMARY.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(["level", "grade", "subject", "indicators", "packs", "questions_at_50", "account"])
        by_grade = defaultdict(list)
        for q in queue: by_grade[(q["level"], q["grade"], q["subject"])].append(q)
        for (l, g, s), qs in sorted(by_grade.items(), key=lambda kv: (LEVEL_ORDER[kv[0][0]], grade_key(kv[0][1]), kv[0][2])):
            w.writerow([l, g, s, sum(q["topics"] for q in qs), len(qs), sum(q["questions"] for q in qs), qs[0]["account"]])
    if plan:
        with open(out / "FOCUS_PLAN.csv", "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=list(plan[0].keys())); w.writeheader()
            w.writerows(sorted(plan, key=lambda p: (p["built_now"], LEVEL_ORDER[p["level"]], p["subject"])))

if __name__ == "__main__":
    main()
