import { describe, expect, it } from "vitest";
import { compareFingerprints, formatComparison, historyLine, parseFingerprint } from "./fingerprint";

const TABLE = (rows: string[]) => ["| version        | checks | found | status | missing |", "| -------------- | ------ | ----- | ------ | ------- |", ...rows].join("\n");
const ok = (v: string) => `| ${v} | 3 | 3 | ok |  |`;

describe("fingerprint comparison", () => {
  it("reads the markdown tables Supabase produces, several tables in one text, and escaped pipes", () => {
    const rows = parseFingerprint(TABLE([ok("20261020100000"), ok("20261021100000")]) + "\n\n" + TABLE(["| 20261044100000 | 1 | 0 | MISSING | public.help_articles\\|slug in ('a')\\|2 |"]));
    expect(rows.map((r) => r.version)).toEqual(["20261020100000", "20261021100000", "20261044100000"]);
    expect(rows[2]).toMatchObject({ status: "MISSING", found: 0, missing: "public.help_articles|slug in ('a')|2" });
  });
  it("calls two all-ok tables identical", () => {
    const t = parseFingerprint(TABLE([ok("20261020100000"), ok("20261021100000")]));
    const c = compareFingerprints(t, t);
    expect(c.identical).toBe(true);
    expect(formatComparison(c)).toContain("RESULT: IDENTICAL");
  });
  it("reports a migration that is ok in one project and missing in the other", () => {
    const prod = parseFingerprint(TABLE([ok("20261020100000"), ok("20261021100000")]));
    const prev = parseFingerprint(TABLE([ok("20261020100000"), "| 20261021100000 | 5 | 0 | MISSING | public.x, public.y |"]));
    const c = compareFingerprints(prod, prev);
    expect(c.identical).toBe(false);
    expect(c.differences).toEqual([{ version: "20261021100000", production: "ok", preview: "MISSING" }]);
    expect(formatComparison(c)).toContain("20261021100000: Production ok, Preview MISSING");
  });
  it("does not call two projects identical when they agree on something that is not ok", () => {
    const t = parseFingerprint(TABLE([ok("20261020100000"), "| 20261021100000 | 5 | 2 | PARTIAL | public.x |"]));
    const c = compareFingerprints(t, t);
    expect(c.differences).toEqual([]);
    expect(c.identical).toBe(false);
    expect(formatComparison(c)).toContain("PARTIAL");
  });
  it("treats a migration present in only one table as a difference, and empty input as not identical", () => {
    expect(compareFingerprints(parseFingerprint(TABLE([ok("20261020100000")])), []).differences).toEqual([{ version: "20261020100000", production: "ok", preview: "absent" }]);
    expect(compareFingerprints([], []).identical).toBe(false);
  });
  it("writes one history line", () => {
    const t = parseFingerprint(TABLE([ok("20261020100000")]));
    expect(historyLine(compareFingerprints(t, t), "2026-11-01", "monthly | check")).toBe("| 2026-11-01 | 1/1 ok | 1/1 ok | identical | monthly / check |");
  });
});
