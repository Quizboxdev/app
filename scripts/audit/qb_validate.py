import csv, glob, os, re, sys, json, collections
root = sys.argv[1]
out = sys.argv[2]
REQ = ["level","grade","subject","strand","sub_strand","indicator_code","topic","concept","difficulty","cognitive_level","answer_type","question_text","option_a","option_b","option_c","option_d","correct_answer","explanation","source_reference","source_quote"]
norm = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
files = sorted(glob.glob(os.path.join(root, "*", "*.csv")))
res = []; seen = {}; allrows = 0
for f in files:
    rel = os.path.relpath(f, root).replace("\\", "/")
    if "/_" in rel or rel.startswith(("_", "scratch", "Questions Bank")): continue
    with open(f, encoding="utf-8-sig", newline="") as fh:
        rd = csv.DictReader(fh); hdr = rd.fieldnames or []
        rows = list(rd)
    iss = collections.Counter(); ex = {}
    def flag(k, i):
        iss[k] += 1; ex.setdefault(k, i + 2)
    if hdr != REQ: iss["HEADER_MISMATCH"] += 1
    m = re.search(r"_(\d+)\.csv$", f); declared = int(m.group(1)) if m else None
    ans = collections.Counter(); diff = collections.Counter(); local = {}
    for i, r in enumerate(rows):
        q = (r.get("question_text") or "").strip()
        opts = [(r.get("option_" + c) or "").strip() for c in "abcd"]
        ca = (r.get("correct_answer") or "").strip().upper()
        if not q: flag("EMPTY_QUESTION", i)
        if any(not o for o in opts): flag("MISSING_OPTION", i)
        if len(set(norm(o) for o in opts if o)) < len([o for o in opts if o]): flag("DUPLICATE_OPTIONS", i)
        if ca not in list("ABCD"): flag("BAD_ANSWER_KEY", i)
        else:
            ans[ca] += 1
            if not opts["ABCD".index(ca)]: flag("KEY_POINTS_TO_EMPTY_OPTION", i)
        if not (r.get("explanation") or "").strip(): flag("NO_EXPLANATION", i)
        if not (r.get("source_reference") or "").strip(): flag("NO_SOURCE_REFERENCE", i)
        if (r.get("difficulty") or "").strip().lower() not in ("easy", "medium", "hard"): flag("BAD_DIFFICULTY", i)
        diff[(r.get("difficulty") or "").strip().lower()] += 1
        if (r.get("answer_type") or "").strip() != "SINGLE_CHOICE": flag("NON_SINGLE_CHOICE", i)
        g = (r.get("grade") or "").strip(); ic = (r.get("indicator_code") or "").strip()
        if not ic: flag("NO_INDICATOR", i)
        elif g and not ic.upper().replace("SHS", "SHS").startswith(g.upper().replace("SHS-", "SHS")[:2]): flag("INDICATOR_GRADE_MISMATCH", i)
        txt = q + " " + " ".join(opts) + " " + (r.get("explanation") or "")
        if "�" in txt or re.search("Ã.|â€", txt): flag("ENCODING_DAMAGE", i)
        if re.search(r"\s{3,}|^\s|\s$", q): flag("WHITESPACE", i)
        k = (g, (r.get("subject") or "").strip(), norm(q))
        if k in local: flag("DUPLICATE_IN_FILE", i)
        local[k] = i
        if k in seen and seen[k] != rel: flag("DUPLICATE_ACROSS_FILES", i)
        seen.setdefault(k, rel)
        if len(q) < 12: flag("VERY_SHORT_QUESTION", i)
        if ca in list("ABCD") and len(opts["ABCD".index(ca)]) > 0:
            longest = max(opts, key=len)
            if opts["ABCD".index(ca)] == longest and len(longest) > 2 * (sorted(len(o) for o in opts)[1] or 1): flag("KEY_IS_OUTLIER_LONGEST", i)
    allrows += len(rows)
    n = len(rows)
    skew = max(ans.values()) / sum(ans.values()) if ans else 0
    res.append({"file": rel, "rows": n, "declared_in_name": declared, "name_matches": declared == n, "answer_dist": dict(ans), "max_key_share": round(skew, 3), "difficulty": dict(diff), "issues": dict(iss), "first_row_example": ex})
json.dump({"files": res, "total_rows": allrows}, open(out, "w"), indent=1)
print("files", len(res), "rows", allrows)
tot = collections.Counter()
for r in res:
    for k, v in r["issues"].items(): tot[k] += v
print(dict(tot))
print("name/row mismatch:", [(r["file"], r["declared_in_name"], r["rows"]) for r in res if not r["name_matches"]])
print("answer-key skew >0.40:", [(r["file"], r["max_key_share"]) for r in res if r["max_key_share"] > 0.40])
