#!/usr/bin/env python3
"""Build generation packs from the verified curriculum files.

A pack is a short text sheet of up to 10 learning indicators (one topic each, 50 questions per topic = up to 500 questions) with the printed
code, wording, exemplars and page. It is attached to a fresh AI chat together with the constant prompt in docs/question-bank/PACK_PROMPT.md,
so the chat never has to guess the topics. Also writes WORK_QUEUE.csv (packs shared across the generator accounts) and a per-unit summary.

Usage:  python scripts/question-bank/make_packs.py [--verified DIR] [--out DIR] [--accounts 8] [--pack-size 10]
"""
import argparse, csv, re, sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SOURCES = [("Primary", "Primary_indicators_reconciled.csv"), ("Primary", "Primary_English_Ghanaian_reconciled.csv"),
           ("Primary", "Primary_Creative_Arts_reconciled.csv"), ("JHS", "JHS_indicators_verified.csv"), ("SHS", "SHS_indicators_verified.csv")]
PER_TOPIC = 50

def safe(s):  # file-name form of a subject or grade
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")

def grade_key(g):
    m = re.search(r"(\d+)", g or ""); return (0 if (g or "").upper().startswith("B") else 1, int(m.group(1)) if m else 99)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verified", default=str(REPO.parent.parent / "curriculum_verified"))
    ap.add_argument("--out", default=str(REPO / "Questions Bank" / "_work"))
    ap.add_argument("--accounts", type=int, default=8)
    ap.add_argument("--pack-size", type=int, default=10)
    a = ap.parse_args()
    out = Path(a.out); packs_dir = out / "packs"
    units = defaultdict(list)
    for level, fname in SOURCES:
        p = Path(a.verified) / fname
        if not p.exists(): print("MISSING", p, file=sys.stderr); continue
        for r in csv.DictReader(open(p, encoding="utf-8-sig")):
            units[(level, r["grade"], r["subject"])].append(r)
    queue = []
    for (level, grade, subject), rows in sorted(units.items(), key=lambda kv: ({"Primary": 0, "JHS": 1, "SHS": 2}[kv[0][0]], grade_key(kv[0][1]), kv[0][2])):
        total = (len(rows) + a.pack_size - 1) // a.pack_size
        for n in range(total):
            chunk = rows[n * a.pack_size:(n + 1) * a.pack_size]
            pid = f"{safe(grade)}_{safe(subject)}_P{n + 1:02d}"
            d = packs_dir / level / f"{safe(grade)}_{safe(subject)}"; d.mkdir(parents=True, exist_ok=True)
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
                          f"EXEMPLARS: {re.sub(r'\\s+', ' ', r.get('exemplars', '') or '').strip() or '(none printed: use the indicator wording only)'}",
                          f"PAGE: {r.get('page', '')}", ""]
            (d / f"{pid}.txt").write_text("\n".join(lines), encoding="utf-8")
            queue.append({"pack_id": pid, "level": level, "grade": grade, "subject": subject, "pack": f"{n + 1}/{total}",
                          "topics": len(chunk), "questions": len(chunk) * PER_TOPIC, "sheet": str((d / f"{pid}.txt").relative_to(out).as_posix()),
                          "account": "", "status": "TODO", "returned_file": "", "notes": ""})
    # Balance the accounts: keep a unit's packs together where possible (same subject reads best in one chat series), biggest units first.
    by_unit = defaultdict(list)
    for q in queue: by_unit[(q["level"], q["grade"], q["subject"])].append(q)
    load = [0] * a.accounts
    for unit, qs in sorted(by_unit.items(), key=lambda kv: -sum(q["questions"] for q in kv[1])):
        k = load.index(min(load))
        for q in qs: q["account"] = f"A{k + 1}"
        load[k] += sum(q["questions"] for q in qs)
    queue.sort(key=lambda q: ({"Primary": 0, "JHS": 1, "SHS": 2}[q["level"]], grade_key(q["grade"]), q["subject"], q["pack_id"]))
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "WORK_QUEUE.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(queue[0].keys())); w.writeheader(); w.writerows(queue)
    with open(out / "UNIT_SUMMARY.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f); w.writerow(["level", "grade", "subject", "indicators", "packs", "questions_at_50", "account"])
        for (l, g, s), qs in sorted(by_unit.items(), key=lambda kv: ({"Primary": 0, "JHS": 1, "SHS": 2}[kv[0][0]], grade_key(kv[0][1]), kv[0][2])):
            w.writerow([l, g, s, sum(q["topics"] for q in qs), len(qs), sum(q["questions"] for q in qs), qs[0]["account"]])
    print(f"{len(units)} units, {len(queue)} packs, {sum(q['questions'] for q in queue):,} questions")
    for i, v in enumerate(load, 1): print(f"  account A{i}: {v:,} questions")

if __name__ == "__main__":
    main()
