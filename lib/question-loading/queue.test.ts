import { describe, expect, it } from "vitest";
import { batchView, jobView, shortReason, summarise, type JobInput } from "./queue";

const okPlan = { canLoad: true, blockers: [], unresolved: [], report: { errorRows: 0, issues: [], batchFlags: [] } } as unknown as NonNullable<JobInput["plan"]>;
const badPlan = (over: Record<string, unknown> = {}) => ({ canLoad: false, blockers: ["QL_CHECK_FAILED"], unresolved: [], report: { errorRows: 2, issues: [{ row: 40, severity: "error", code: "QL_UNSAFE_CONTENT", field: "explanation" }], batchFlags: [] }, ...over }) as unknown as NonNullable<JobInput["plan"]>;
const job = (over: Partial<JobInput> = {}): JobInput => ({ checked: true, plan: okPlan, rowsCount: 1200, earlier: null, sourceIds: ["s1"], running: false, outcome: null, ...over });

describe("what state a file in the queue is in, and what can be done", () => {
  it("a clean, unseen file with a source is ready", () => {
    expect(jobView(job())).toMatchObject({ phase: "ready", runnable: true, tone: "ok" });
  });
  it("shows Checking until the file has been checked and the database asked", () => {
    expect(jobView(job({ checked: false, plan: null })).phase).toBe("checking");
    expect(jobView(job({ earlier: undefined })).phase).toBe("checking");
    expect(jobView(job({ checked: false })).runnable).toBe(false);
  });
  it("a file with errors needs attention and says the first thing to fix", () => {
    const v = jobView(job({ plan: badPlan() }));
    expect(v).toMatchObject({ phase: "blocked", runnable: false, tone: "bad" });
    expect(v.detail).toContain("row 40");
    expect(v.detail).toContain("2 questions have errors");
  });
  it("a file that cannot be read says so, in plain words", () => {
    const v = jobView(job({ checked: false, plan: null, readError: "QL_FILE_UNREADABLE" }));
    expect(v).toMatchObject({ phase: "blocked", runnable: false });
    expect(v.detail).toBe("The file could not be read.");
  });
  it("a file already in the system is never loaded again", () => {
    const v = jobView(job({ earlier: { id: "b", status: "LOADED", rows_total: 1200 } }));
    expect(v).toMatchObject({ phase: "loaded-before", runnable: false });
    expect(v.detail).toContain("1,200");
  });
  it("an interrupted file offers Continue from the database's own count, and only the rest will be sent", () => {
    const v = jobView(job({ rowsCount: 2600, earlier: { id: "b", status: "LOADING", rows_total: 1000 } }));
    expect(v).toMatchObject({ phase: "continue", runnable: true, label: "Continue from question 1,001" });
    expect(v.detail).toContain("1,000 of 2,600");
  });
  it("a file with no matching source waits for the admin to choose one", () => {
    expect(jobView(job({ sourceIds: [] }))).toMatchObject({ phase: "needs-source", runnable: false, tone: "warn" });
  });
  it("a file that failed to check is blocked before any source question is asked", () => {
    expect(jobView(job({ plan: badPlan(), sourceIds: [] })).phase).toBe("blocked");
  });
  it("running, done and stopped outrank everything else, and a stopped file can be retried", () => {
    expect(jobView(job({ running: true })).phase).toBe("running");
    expect(jobView(job({ outcome: { ok: true, rowsLoaded: 1200 } }))).toMatchObject({ phase: "done", runnable: false, label: "Loaded 1,200 into review" });
    const s = jobView(job({ outcome: { ok: false, message: "It stopped at 1,001" } }));
    expect(s).toMatchObject({ phase: "stopped", runnable: true, tone: "bad", detail: "It stopped at 1,001" });
  });
});

describe("reasons and summary", () => {
  it("explains unplaced questions and batch-level problems when there are no row errors", () => {
    const p = badPlan({ report: { errorRows: 0, issues: [], batchFlags: [] }, unresolved: [{ fileRow: 7, status: "UNKNOWN_INDICATOR" }] });
    expect(shortReason(p)).toBe("1 question is not on the curriculum. First: row 7, unknown indicator.");
    const q = badPlan({ report: { errorRows: 0, issues: [], batchFlags: [{ code: "QL_TOO_MANY_ROWS", severity: "error", detail: "(6000)" }] } });
    expect(shortReason(q)).toContain("5,000");
  });
  it("counts what pressing Load will do, without double counting questions already saved", () => {
    const ready = { view: jobView(job()), rowsCount: 1200 };
    const cont = { view: jobView(job({ rowsCount: 2600, earlier: { id: "b", status: "LOADING", rows_total: 1000 } })), rowsCount: 2600, savedRows: 1000 };
    const blocked = { view: jobView(job({ plan: badPlan() })), rowsCount: 500 };
    const done = { view: jobView(job({ outcome: { ok: true, rowsLoaded: 650 } })), rowsCount: 650 };
    const s = summarise([ready, cont, blocked, done]);
    expect(s.files).toBe(2);
    expect(s.questions).toBe(1200 + 1600);
    expect(s.attention).toBe(1);
    expect(s.line).toBe("2 files ready (2,800 questions) · 1 needs attention · 1 loaded now");
  });
});

describe("the batch list: every state has a way forward", () => {
  const b = (status: string, over: Record<string, unknown> = {}) => ({ status, rows_total: 1000, rows_loaded: 1000, rows_rejected: 0, report: { expected_rows: 2600 }, ...over });
  it("shows how far a stopped batch got out of how many were expected, and offers Continue", () => {
    expect(batchView(b("LOADING"), false)).toMatchObject({ label: "Stopped partway", progress: "1,000 of 2,600", action: "continue", tone: "warn" });
  });
  it("offers review for a loaded batch, with a note when some were rejected", () => {
    expect(batchView(b("LOADED", { rows_total: 650, rows_loaded: 650, report: { expected_rows: 650 } }), false)).toMatchObject({ action: "review", progress: "650 of 650" });
    const p = batchView(b("PARTIAL", { rows_rejected: 12 }), false);
    expect(p.action).toBe("review");
    expect(p.hint).toContain("12");
  });
  it("offers revoke for an approved batch, discard for a failed one, and nothing for a discarded one", () => {
    expect(batchView(b("LOADED"), true)).toMatchObject({ action: "revoke", label: "Live for learners", tone: "ok" });
    expect(batchView(b("FAILED"), false).action).toBe("discard");
    expect(batchView(b("DISCARDED"), false).action).toBe("none");
  });
  it("never reports a bigger denominator than the rows it has, even with no expected count recorded", () => {
    expect(batchView(b("LOADING", { report: {} }), false).progress).toBe("1,000 of 1,000");
    expect(batchView(b("LOADING", { report: null }), false).progress).toBe("1,000 of 1,000");
  });
  it("every status that can exist leads somewhere", () => {
    for (const s of ["CHECKED", "LOADING", "LOADED", "PARTIAL", "FAILED", "DISCARDED", "SOMETHING_NEW"]) {
      const v = batchView(b(s), false);
      expect(v.label.length).toBeGreaterThan(0);
      expect(v.hint.length).toBeGreaterThan(0);
    }
  });
});

describe("batches with an interrupted action", () => {
  const b = (status: string) => ({ status, rows_total: 1250, rows_loaded: 1250, rows_rejected: 0, report: { expected_rows: 1250 } });
  it("an approval cut off partway is never shown as complete: it offers Finish approval", () => {
    expect(batchView(b("LOADED"), true, true)).toMatchObject({ label: "Approval unfinished", action: "finish", tone: "warn" });
    expect(batchView(b("LOADED"), true, false)).toMatchObject({ label: "Live for learners", action: "revoke" });
  });
  it("a discard cut off partway offers Discard again", () => {
    expect(batchView(b("DISCARDING"), false)).toMatchObject({ label: "Being discarded", action: "discard" });
  });
});
