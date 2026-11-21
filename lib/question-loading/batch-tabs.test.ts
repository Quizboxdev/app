import { describe, expect, it } from "vitest";
import { canTickAll, countByTab, tabOf } from "./batch-tabs";
import type { BatchRow } from "./queue";

const row = (status: string): BatchRow => ({ status, rows_total: 10, rows_loaded: 10, rows_rejected: 0 });

describe("which list a batch belongs in", () => {
  it("keeps loaded, partial and stopped batches in the waiting list", () => {
    for (const s of ["LOADED", "PARTIAL", "LOADING", "FAILED", "DISCARDING"]) expect(tabOf(row(s), false)).toBe("waiting");
  });
  it("moves an approved batch to Approved, but keeps an unfinished approval in Waiting so it can be finished", () => {
    expect(tabOf(row("LOADED"), true, false)).toBe("approved");
    expect(tabOf(row("LOADED"), true, true)).toBe("waiting");
  });
  it("puts discarded batches in their own list", () => { expect(tabOf(row("DISCARDED"), false)).toBe("closed"); });
  it("counts each list for the tab labels", () => {
    const batches = [{ id: "a", ...row("LOADED") }, { id: "b", ...row("LOADED") }, { id: "c", ...row("DISCARDED") }, { id: "d", ...row("LOADED") }];
    const approvals: Record<string, { in_progress?: boolean }> = { b: {}, d: { in_progress: true } };
    expect(countByTab(batches, (x) => approvals[x.id])).toEqual({ waiting: 2, approved: 1, closed: 1 });
  });
});

describe("tick all on the sample", () => {
  it("is for the super administrator only", () => {
    expect(canTickAll({ super_admin: true })).toBe(true);
    expect(canTickAll({ super_admin: false })).toBe(false);
    expect(canTickAll(null)).toBe(false);
    expect(canTickAll(undefined)).toBe(false);
  });
});
