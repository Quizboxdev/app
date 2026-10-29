import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Audit UX-023: the list of reportable operations exists twice (the database function and the browser's sanitiser). They must never drift apart,
// and the rollback must restore the list from before ATTEMPT_SAVE.
const listIn = (text: string, open: RegExp) => { const m = text.match(open); return m ? [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]).sort() : []; };
const migration = readFileSync("supabase/migrations/20261047100000_attempt_save_failure_log.sql", "utf8");
const rollback = readFileSync("supabase/rollback/attempt_save_failure_log.sql", "utf8");
const original = readFileSync("supabase/migrations/20261004120000_competition_school_admin_ops.sql", "utf8");
const safety = readFileSync("lib/operations/safety.ts", "utf8");
const IN_LIST = /p_operation not in \(([^)]*)\)/;

describe("reportable operation names", () => {
  it("the new migration allows ATTEMPT_SAVE and everything the browser sanitiser allows", () => {
    const db = listIn(migration, IN_LIST);
    const browser = [...(safety.match(/const allowed = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([A-Z_]+)"/g)].map((x) => x[1]).sort();
    expect(db).toContain("ATTEMPT_SAVE");
    expect(db).toEqual(browser);
  });
  it("adds exactly one name to the list the database had before", () => {
    const before = listIn(original, /p_operation not in \(([^)]*)\)/);
    expect(listIn(migration, IN_LIST)).toEqual([...before, "ATTEMPT_SAVE"].sort());
  });
  it("the rollback restores the earlier list", () => {
    expect(listIn(rollback, IN_LIST)).toEqual(listIn(original, /p_operation not in \(([^)]*)\)/));
  });
  it("keeps the sign-in check, the rate budget and the code filter", () => {
    for (const text of [migration, rollback]) {
      expect(text).toContain("auth.uid() is null");
      expect(text).toContain("enforce_budget('failure_events',20,60)");
      expect(text).toContain("'^[A-Z][A-Z0-9_]{2,60}$'");
    }
  });
});
