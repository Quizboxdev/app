#!/usr/bin/env python3
"""Compare two schema fingerprints produced by scripts/release/schema-fingerprint.sql.

usage: compare-fingerprint.py ACTUAL.txt EXPECTED.txt [--ignore-env]

Exit code 0 = identical (after optional environment-artifact filtering), 1 = differences, 2 = usage error.
Facts are `kind|key|detail`. Function bodies are compared in full.

--ignore-env drops differences that come from the environment, not from migrations:
  * `fnacl`, `relacl`, `seqacl`, `schemaacl` (effective grants depend on pg_default_acl, which differs between projects/eras);
    use this only to see structural drift, then review grants separately without the flag.
  * `ext` lines (managed extensions such as pg_net) and `bucket` rows (storage data, not schema).
  * auto-generated unique/index names truncated differently by different PostgreSQL major versions (`..._k` vs `..._co_key`).
"""
import collections, re, sys

def load(path):
    d = collections.defaultdict(list)
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            parts = line.split("|", 2) + [""] * 2
            d[(parts[0], parts[1])].append(parts[2])
    return d

def table_of(kind, key):
    # con keys are schema.table.constraint ; idx keys are schema.table
    return key.rsplit(".", 1)[0] if kind == "con" else key

def strip_names(kind, detail):
    # drop auto-generated names so only the definition is compared
    if kind == "idx":
        return re.sub(r"^(CREATE (?:UNIQUE )?INDEX) \S+ ON", lambda m: m.group(1) + " <name> ON", detail)
    return detail

def definition_multiset(d, kind):
    out = collections.defaultdict(list)
    for (k, key), details in d.items():
        if k == kind:
            for x in details:
                out[table_of(kind, key)].append(strip_names(kind, x))
    return {t: sorted(v) for t, v in out.items()}

def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    ignore_env = "--ignore-env" in argv
    if len(args) != 2:
        print(__doc__); return 2
    actual, expected = load(args[0]), load(args[1])
    skip_kinds = ("fnacl", "relacl", "seqacl", "schemaacl", "ext", "bucket")
    if ignore_env:
        # Constraints and indexes are compared by definition (names ignored): PostgreSQL majors truncate auto-generated names differently.
        for kind in ("con", "idx"):
            same = definition_multiset(actual, kind) == definition_multiset(expected, kind)
            if same:
                skip_kinds += (kind,)
    def keep(k): return not (ignore_env and k[0] in skip_kinds)
    ka = {k for k in actual if keep(k)}; ke = {k for k in expected if keep(k)}
    only_actual = sorted(ka - ke); only_expected = sorted(ke - ka)
    changed = sorted(k for k in ka & ke if sorted(actual[k]) != sorted(expected[k]))
    print(f"only in ACTUAL: {len(only_actual)} | only in EXPECTED: {len(only_expected)} | changed: {len(changed)}")
    for k in only_actual: print("  ACTUAL-ONLY  ", k[0], k[1], "::", actual[k][0][:160])
    for k in only_expected: print("  EXPECTED-ONLY", k[0], k[1], "::", expected[k][0][:160])
    for k in changed:
        print("  CHANGED      ", k[0], k[1])
        sa, se = set(actual[k]), set(expected[k])
        for x in sorted(sa - se)[:3]: print("      actual  :", x[:200])
        for x in sorted(se - sa)[:3]: print("      expected:", x[:200])
    return 0 if not (only_actual or only_expected or changed) else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv))
