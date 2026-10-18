#!/usr/bin/env python3
"""QuizBox question bank gate: validate returned AI files, remove duplicates, enforce the difficulty rules, and write the final bank files.

  python scripts/question-bank/bank.py assemble            # process every file in Questions Bank/_work/returns/
  python scripts/question-bank/bank.py check FILE [FILE]   # report only, writes nothing
  python scripts/question-bank/bank.py reshuffle FILE      # re-randomise option order in a finished file (fixes patterned correct letters)
  python scripts/question-bank/bank.py mark-loaded FILE    # record a file's questions as already loaded into QuizBox (once, for files loaded before this command existed)
  python scripts/question-bank/bank.py export-new          # write Questions Bank/_load/<Grade>_<Subject>_new_<n>.csv with ONLY questions not loaded before, per unit

Final files:  Questions Bank/<Level>/<Grade>_<Subject>_<count>.csv   (count = accepted questions; rebuilt on every run)
Also writes:  _work/reports/<Grade>_<Subject>_report.txt, _work/rejects/<unit>_rejects.csv, _work/reports/<unit>_gaps.csv (what a top-up pack must add).
This is the pre-load gate. The source-quote check against the PDF is still done by scripts/check-question-file.ts before loading.
Standard library only.
"""
import csv, hashlib, io, random, re, shutil, sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BANK = REPO / "Questions Bank"; WORK = BANK / "_work"
COLS = "level,grade,subject,strand,sub_strand,indicator_code,topic,concept,difficulty,cognitive_level,answer_type,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,source_reference,source_quote".split(",")
LEVELS = {"PRIMARY": "Primary", "JHS": "JHS", "SHS": "SHS"}
PER_TOPIC, MIX = 50, {"easy": 15, "medium": 20, "hard": 15}
# Which cognitive levels may carry which difficulty: recall is never "hard", evaluation is never "easy".
ALLOWED = {"easy": {"Remember", "Understand"}, "medium": {"Understand", "Apply", "Analyse"}, "hard": {"Apply", "Analyse", "Evaluate"}}
HEADER_Q = [r"\baccording to the (curriculum|syllabus|document|text|source)\b", r"\b(listed|named|stated|mentioned|outlined) in the (curriculum|syllabus|document|text|source)\b",
            r"\b(which|what) (is|are) (the |a )?(strand|sub-?strand|content standard|learning indicator|indicator|exemplar)s?\b", r"\b(NaCCA|SBC|CCP)\b",
            r"\bunder which (strand|sub-?strand|topic|heading)\b", r"\bwhat is the (title|heading|name) of (this|the) (topic|strand|unit|section)\b",
            r"\b[BS]{1,3}\d{1,2}(\.\d+){2,}\b", r"\bindicator\s+[BS]", r"\bthis (topic|lesson|unit|strand) (is about|covers|teaches)\b"]
HEADER_RE = [re.compile(p, re.I) for p in HEADER_Q]
BAD_TEXT = re.compile(r"<[^>]*>|[<>]|\$|\\\(|\\\[|\\frac|answer key|correct answer|the answer is", re.I)

norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", (s or "").lower())).strip()
toks = lambda s: set(norm(s).split())
def jac(a, b): return len(a & b) / len(a | b) if a and b else 0.0
safe = lambda s: re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")

def read_rows(path):
    """Tolerant reader: code fences, repeated header rows and several CSV blocks in one file are all accepted."""
    text = Path(path).read_text(encoding="utf-8-sig", errors="replace")
    text = "\n".join(l for l in text.splitlines() if not l.strip().startswith("```"))
    rows, bad = [], 0
    for rec in csv.reader(io.StringIO(text)):
        if not rec or not any(c.strip() for c in rec): continue
        if [c.strip().lower() for c in rec[:len(COLS)]] == COLS: continue
        if len(rec) != len(COLS): bad += 1; continue
        rows.append({c: v.strip() for c, v in zip(COLS, rec)})
    return rows, bad

def row_errors(r, allowed_codes):
    e = []
    for c in ["level", "grade", "subject", "indicator_code", "topic", "concept", "difficulty", "cognitive_level", "answer_type", "question_text", "option_a", "option_b", "correct_answer", "explanation"]:
        if not r[c]: e.append(f"missing {c}")
    if r["level"].upper() not in LEVELS: e.append("level must be PRIMARY, JHS or SHS")
    if r["difficulty"] not in MIX: e.append("difficulty must be easy, medium or hard")
    if r["cognitive_level"] not in {"Remember", "Understand", "Apply", "Analyse", "Evaluate"}: e.append("bad cognitive_level")
    elif r["difficulty"] in ALLOWED and r["cognitive_level"] not in ALLOWED[r["difficulty"]]: e.append(f"{r['cognitive_level']} does not fit {r['difficulty']}")
    if r["answer_type"] not in ("SINGLE_CHOICE", "TRUE_FALSE"): e.append("answer_type must be SINGLE_CHOICE or TRUE_FALSE")
    opts = {k: r["option_" + k.lower()] for k in "ABCD"}
    if r["correct_answer"] not in opts or not opts.get(r["correct_answer"]): e.append("correct_answer points to nothing")
    if r["answer_type"] == "TRUE_FALSE":
        if (r["option_a"], r["option_b"]) != ("True", "False") or r["option_c"] or r["option_d"] or r["correct_answer"] not in "AB": e.append("bad TRUE_FALSE layout")
    else:
        filled = [norm(v) for v in opts.values() if v]
        if len(filled) != 4: e.append("SINGLE_CHOICE needs four options")
        if len(set(filled)) != len(filled): e.append("duplicate options")
        if any(re.search(r"(all|none) of the above", v, re.I) or re.fullmatch(r"(both )?[a-d]( and |, )[a-d]", v.strip(), re.I) for v in opts.values()): e.append("all/none-of-the-above style option")
    if BAD_TEXT.search(" ".join([r["question_text"], *opts.values()])): e.append("forbidden characters or answer wording")
    if any(p.search(r["question_text"] + " " + " ".join(opts.values())) for p in HEADER_RE): e.append("curriculum-header question (asks about the document, not the subject)")
    if len(r["question_text"].split()) < 5: e.append("question too short")
    if allowed_codes is not None and r["indicator_code"] not in allowed_codes: e.append("indicator_code is not in this unit's packs")
    return e

def unit_of(r): return (LEVELS.get(r["level"].upper(), r["level"]), r["grade"], r["subject"])

def sheet_text_for(unit):
    """indicator_code -> normalised INDICATOR + EXEMPLARS text from that unit's pack sheets (what source_quote must be copied from)."""
    d = WORK / "packs" / unit[0] / f"{safe(unit[1])}_{safe(unit[2])}"
    out = {}
    if not d.exists(): return out
    for p in d.glob("*.txt"):
        for block in p.read_text(encoding="utf-8").split("=== TOPIC ")[1:]:
            m = re.search(r"^INDICATOR CODE: (\S+)", block, re.M)
            if m: out[m.group(1)] = norm(" ".join(re.findall(r"^(?:INDICATOR|EXEMPLARS): (.*)$", block, re.M)))
    return out

def allowed_codes_for(unit):
    d = WORK / "packs" / unit[0] / f"{safe(unit[1])}_{safe(unit[2])}"
    if not d.exists(): return None
    return set(re.findall(r"^INDICATOR CODE: (\S+)", "\n".join(p.read_text(encoding="utf-8") for p in d.glob("*.txt")), re.M))

LETTER_REF = re.compile(r"(option|choice|answer)s?\s+[A-D]|[A-D]\s*(and|or|,)\s*[A-D]|\(\s*[A-D]\s*\)", re.I)
def shuffle_options(r):
    """Deterministically permute the four options of a SINGLE_CHOICE row (seeded by its wording) so the correct letter is not patterned.
    Skips rows whose question or explanation refers to a letter. Idempotent for a given question text."""
    if r["answer_type"] != "SINGLE_CHOICE" or LETTER_REF.search(r["question_text"] + " " + r["explanation"]): return r
    keys = "abcd"; vals = [r["option_" + k] for k in keys]
    if any(not v for v in vals) or r["correct_answer"] not in "ABCD": return r
    right = vals["ABCD".index(r["correct_answer"])]
    order = list(range(4)); random.Random(int(hashlib.sha256(norm(r["question_text"]).encode()).hexdigest()[:12], 16)).shuffle(order)
    new = [vals[i] for i in order]
    return {**r, **{"option_" + k: v for k, v in zip(keys, new)}, "correct_answer": "ABCD"[new.index(right)]}

def assign_letters(rows):
    """Give a topic's SINGLE_CHOICE rows a balanced, patternless sequence of correct letters, moving the options to match.
    Target counts differ by at most one; the sequence has no run of 3 equal letters and no A-B-C-D cycle (seeded, so re-running is stable).
    Rows that name a letter in the question or explanation are left alone."""
    idx = [i for i, r in enumerate(rows) if r["answer_type"] == "SINGLE_CHOICE" and r["correct_answer"] in "ABCD" and all(r["option_" + k] for k in "abcd")
           and not LETTER_REF.search(r["question_text"] + " " + r["explanation"])]
    n = len(idx)
    if n < 4: return rows
    seed = int(hashlib.sha256(("|".join(norm(rows[i]["question_text"]) for i in idx[:3])).encode()).hexdigest()[:12], 16)
    rng = random.Random(seed); base = list("ABCD" * (n // 4 + 1))[:n]
    for _ in range(400):
        seq = base[:]; rng.shuffle(seq)
        runs = any(seq[j] == seq[j + 1] == seq[j + 2] for j in range(n - 2))
        cyc = sum(1 for a, b in zip(seq, seq[1:]) if ord(b) - ord(a) in (1, -3)) / max(n - 1, 1)
        if not runs and cyc <= 0.3: break
    out = list(rows)
    for i, want in zip(idx, seq):
        r = rows[i]; vals = [r["option_" + k] for k in "abcd"]; right = vals["ABCD".index(r["correct_answer"])]
        others = [v for j, v in enumerate(vals) if j != "ABCD".index(r["correct_answer"])]
        rng.shuffle(others); put = "ABCD".index(want); new = others[:put] + [right] + others[put:]
        out[i] = {**r, **{"option_" + k: v for k, v in zip("abcd", new)}, "correct_answer": want}
    return out

def cyclic_share(rs):
    s = [x["correct_answer"] for x in rs]
    return sum(1 for a, b in zip(s, s[1:]) if ord(b) - ord(a) in (1, -3)) / max(len(s) - 1, 1)

def process(unit, rows, existing):
    """rows: candidate rows in arrival order. existing: rows already accepted. Returns accepted, rejects, warnings, gaps."""
    codes = allowed_codes_for(unit)
    sheets = sheet_text_for(unit)
    accepted, rejects, warn = list(existing), [], []
    seen_stem = {norm(r["question_text"]) for r in accepted}
    by_ind = defaultdict(list)
    for r in accepted: by_ind[r["indicator_code"]].append(r)
    for r in rows:
        why = row_errors(r, codes)
        src = sheets.get(r["indicator_code"])
        q = norm(r["source_quote"])
        if src is not None and not why:
            if not q: why.append("source_quote missing")
            elif q != norm(r["topic"]) and not all(part and part in src for part in [norm(x) for x in re.split(r"\s*\.\.\.\s*", r["source_quote"])]): why.append("source_quote is not copied word for word from this topic's indicator or exemplars")
            elif q == norm(r["topic"]) and len(src) > len(q) + 40: warn.append(f"{r['indicator_code']}: source_quote is only the topic name; quote an exemplar passage")
        s = norm(r["question_text"])
        if not why and s in seen_stem: why.append("duplicate question (same wording already in the bank)")
        if not why:
            near = next((o for o in by_ind[r["indicator_code"]] if jac(toks(r["question_text"]), toks(o["question_text"])) >= 0.85), None)
            if near: why.append("near-duplicate of another question in this topic")
        if why: rejects.append({**r, "reject_reason": "; ".join(why)}); continue
        accepted.append(r); by_ind[r["indicator_code"]].append(r); seen_stem.add(s)
    # letters: assign per topic for the rows added in this run (earlier accepted rows keep theirs)
    fresh = defaultdict(list)
    for k in range(len(existing), len(accepted)): fresh[accepted[k]["indicator_code"]].append(k)
    for code, ks in fresh.items():
        for k, nr in zip(ks, assign_letters([accepted[k] for k in ks])): accepted[k] = nr
    by_ind = defaultdict(list)
    for r in accepted: by_ind[r["indicator_code"]].append(r)
    gaps = []
    for code, rs in sorted(by_ind.items()):
        n = len(rs); diff = Counter(x["difficulty"] for x in rs); letters = Counter(x["correct_answer"] for x in rs)
        longest = sum(1 for x in rs if x["answer_type"] == "SINGLE_CHOICE" and len(x["option_" + x["correct_answer"].lower()]) > max(len(x["option_" + k]) for k in "abcd" if k != x["correct_answer"].lower()))
        sc = sum(1 for x in rs if x["answer_type"] == "SINGLE_CHOICE")
        if n >= 12 and cyclic_share(rs) > 0.6: warn.append(f"{code}: the correct letter follows an A-B-C-D cycle ({cyclic_share(rs):.0%} of steps): guessable")
        if sc >= 10 and longest / sc > 0.5: warn.append(f"{code}: the correct option is the longest in {longest} of {sc} questions (guessable)")
        if n >= 10 and max(letters.values()) / n > 0.4: warn.append(f"{code}: correct letter {letters.most_common(1)[0][0]} is {max(letters.values())} of {n}")
        if sum(1 for x in rs if x["answer_type"] == "TRUE_FALSE") > 5: warn.append(f"{code}: more than 5 TRUE_FALSE questions")
        ans = Counter(norm(x["option_" + x["correct_answer"].lower()]) for x in rs if x["answer_type"] == "SINGLE_CHOICE")
        for a, k in ans.items():
            if k > 3 and a: warn.append(f"{code}: the same correct answer '{a[:40]}' is used {k} times")
        need = {d: max(MIX[d] - diff.get(d, 0), 0) for d in MIX}
        if n < PER_TOPIC or any(need.values()): gaps.append({"indicator_code": code, "have": n, "need_total": max(PER_TOPIC - n, 0), "need_easy": need["easy"], "need_medium": need["medium"], "need_hard": need["hard"]})
    if codes:
        for code in sorted(codes - set(by_ind)): gaps.append({"indicator_code": code, "have": 0, "need_total": PER_TOPIC, "need_easy": 15, "need_medium": 20, "need_hard": 15})
    return accepted, rejects, warn, gaps

def write_csv(path, rows, cols):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=cols, quoting=csv.QUOTE_ALL, extrasaction="ignore"); w.writeheader(); w.writerows(rows)

def final_path(unit, n): return BANK / unit[0] / f"{safe(unit[1])}_{safe(unit[2])}_{n}.csv"
def existing_final(unit):
    hits = sorted((BANK / unit[0]).glob(f"{safe(unit[1])}_{safe(unit[2])}_*.csv")) if (BANK / unit[0]).exists() else []
    return (read_rows(hits[-1])[0], hits) if hits else ([], [])

def assemble(files, write=True):
    incoming = defaultdict(list); skipped = 0
    for f in files:
        rows, bad = read_rows(f); skipped += bad
        for r in rows: incoming[unit_of(r)].append(r)
        print(f"read {Path(f).name}: {len(rows)} rows" + (f", {bad} unreadable lines skipped" if bad else ""))
    for unit, rows in sorted(incoming.items()):
        old, old_files = existing_final(unit) if write else ([], [])   # a report-only check judges the file on its own, not against the bank
        acc, rej, warn, gaps = process(unit, rows, old)
        new = len(acc) - len(old)
        lines = [f"UNIT {unit[0]} {unit[1]} {unit[2]}", f"previously accepted: {len(old)}", f"submitted: {len(rows)}", f"newly accepted: {new}", f"rejected: {len(rej)}", f"total now: {len(acc)}", f"topics still short of 50 or of the 15/20/15 mix: {len(gaps)}", ""]
        for k, v in Counter(w for r in rej for w in r["reject_reason"].split("; ")).most_common(): lines.append(f"  rejected for: {k} x{v}")
        lines += ["", *[f"WARNING {w}" for w in warn]]
        print("\n".join(lines[:9 + 12]))
        if write:
            for p in old_files: p.unlink()
            write_csv(final_path(unit, len(acc)), acc, COLS)
            tag = f"{safe(unit[1])}_{safe(unit[2])}"
            write_csv(WORK / "rejects" / f"{tag}_rejects.csv", rej, COLS + ["reject_reason"])
            write_csv(WORK / "reports" / f"{tag}_gaps.csv", gaps, ["indicator_code", "have", "need_total", "need_easy", "need_medium", "need_hard"])
            (WORK / "reports").mkdir(parents=True, exist_ok=True); (WORK / "reports" / f"{tag}_report.txt").write_text("\n".join(lines), encoding="utf-8")
            print(f"-> {final_path(unit, len(acc)).relative_to(REPO)}")
    return incoming

LEDGER = WORK / "loaded"
def ledger_path(unit): return LEDGER / f"{safe(unit[1])}_{safe(unit[2])}.txt"
def ledger_read(unit):
    p = ledger_path(unit); return set(p.read_text(encoding="utf-8").splitlines()) - {""} if p.exists() else set()
def ledger_add(unit, stems):
    LEDGER.mkdir(parents=True, exist_ok=True)
    with open(ledger_path(unit), "a", encoding="utf-8") as f:
        f.writelines(s + chr(10) for s in stems)

def mark_loaded(files):
    for f in files:
        rows, _ = read_rows(f); by = defaultdict(list)
        for r in rows: by[unit_of(r)].append(norm(r["question_text"]))
        for unit, stems in by.items():
            have = ledger_read(unit); new = [s for s in stems if s not in have]
            ledger_add(unit, new); print(f"{Path(f).name}: {len(new)} questions recorded as loaded for {unit[1]} {unit[2]}")

def export_new():
    out_dir = BANK / "_load"; out_dir.mkdir(parents=True, exist_ok=True); made = 0
    for lvl in ("Primary", "JHS", "SHS"):
        for f in sorted((BANK / lvl).glob("*_*_*.csv")) if (BANK / lvl).exists() else []:
            rows, _ = read_rows(f)
            if not rows: continue
            unit = unit_of(rows[0]); have = ledger_read(unit)
            # whole topics only, so every load keeps the 15/20/15 blocks the loader checks
            by = defaultdict(list)
            for r in rows:
                if norm(r["question_text"]) not in have: by[r["indicator_code"]].append(r)
            fresh = [r for code, rs in by.items() if len(rs) == PER_TOPIC for r in rs]
            held = sum(len(rs) for rs in by.values()) - len(fresh)
            if not fresh:
                print(f"{f.name}: nothing new to load" + (f" ({held} questions in unfinished topics held back)" if held else "")); continue
            tag = f"{safe(unit[1])}_{safe(unit[2])}"
            for old in out_dir.glob(f"{tag}_new_*.csv"): old.unlink()
            path = out_dir / f"{tag}_new_{len(fresh)}.csv"; write_csv(path, fresh, COLS); made += 1
            ledger_add(unit, [norm(r["question_text"]) for r in fresh])
            print(f"-> {path.relative_to(REPO)}: {len(fresh)} new questions in {len(fresh) // PER_TOPIC} topics" + (f"; {held} held back (unfinished topics)" if held else ""))
    if not made: print("No new questions to load.")
    print("Load each file on Load Questions, then approve it on Approve Batches. Exported questions are recorded as loaded; if a load fails, delete the file's lines from _work/loaded/ and export again.")

def main(argv):
    if len(argv) < 2 or argv[1] not in ("assemble", "check", "reshuffle", "mark-loaded", "export-new"): print(__doc__); return 2
    if argv[1] == "mark-loaded": mark_loaded(argv[2:]); return 0
    if argv[1] == "export-new": export_new(); return 0
    if argv[1] == "reshuffle":
        for f in argv[2:]:
            rows, _ = read_rows(f); groups = defaultdict(list)
            for k, r in enumerate(rows): groups[r["indicator_code"]].append(k)
            new = list(rows)
            for ks in groups.values():
                for k, nr in zip(ks, assign_letters([rows[k] for k in ks])): new[k] = nr
            write_csv(Path(f), new, COLS); print(f"{Path(f).name}: {sum(1 for a, b in zip(rows, new) if a['correct_answer'] != b['correct_answer'])} of {len(rows)} correct letters moved; cycle now {cyclic_share(new):.0%}")
        return 0
    if argv[1] == "check": assemble(argv[2:], write=False); return 0
    inbox = WORK / "returns"; inbox.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in inbox.iterdir() if p.is_file() and p.suffix.lower() in (".csv", ".txt"))
    if not files: print(f"No files in {inbox}. Drop each returned batch there (.csv or .txt)."); return 1
    assemble(files)
    done = inbox / "_done"; done.mkdir(exist_ok=True)
    for f in files: shutil.move(str(f), str(done / f.name))
    return 0

if __name__ == "__main__": sys.exit(main(sys.argv))
