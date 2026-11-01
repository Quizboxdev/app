import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadPayload, LoadRowPayload, LoadTopic } from "@/lib/question-loading/payload";

// A stand-in for the database that behaves like the real loader (one transaction per request, the batch row counts what it took, a file can only start once) and can
// fail in the awkward ways a real one does: a time-out BEFORE the work, a time-out AFTER the work was committed, and a refusal.
const h = vi.hoisted(() => {
  type Mode = "timeout-before" | "timeout-after" | "refuse" | "rate-limit";
  const state = { batches: [] as any[], stored: [] as string[], calls: 0, plan: {} as Record<number, Mode>, stamps: [] as number[], clock: 0 };
  const rpc = async (_fn: string, args: { p: any }) => {
    const p = args.p, mode = state.plan[++state.calls];
    state.stamps.push(state.clock);
    if (mode === "rate-limit") return { data: null, error: { message: "QB_CONTENT_RATE_LIMIT", code: "P0001" } };   // refused whole: nothing saved
    if (mode === "timeout-before") return { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } };
    if (mode === "refuse") return { data: null, error: { message: "QB_TOPIC_INVALID_CONCEPTS", code: "P0001" } };
    let b = p.batch_id ? state.batches.find((x) => x.id === p.batch_id) : undefined;
    if (!p.batch_id) {
      if (state.batches.some((x) => x.file_sha256 === p.file_sha256)) return { data: null, error: { message: "QB_LOAD_FILE_ALREADY_LOADED", code: "P0001" } };
      b = { id: `b${state.batches.length + 1}`, file_sha256: p.file_sha256, file_name: p.file_name, status: "LOADING", rows_total: 0, rows_loaded: 0, rows_rejected: 0, expected: p.expected_rows };
      state.batches.push(b);
    }
    if (!b) return { data: null, error: { message: "QB_LOAD_BATCH_NOT_FOUND", code: "P0001" } };
    if (b.status !== "LOADING") return { data: null, error: { message: "QB_LOAD_BATCH_CLOSED", code: "P0001" } };
    for (const r of p.rows) state.stored.push(r.question_text);
    b.rows_total += p.rows.length; b.rows_loaded += p.rows.length; if (b.rows_total >= b.expected) b.status = "LOADED";
    if (mode === "timeout-after") return { data: null, error: { message: "Gateway Timeout", status: 504 } };
    return { data: { batch_id: b.id, status: b.status, rows_total: b.rows_total, rows_loaded: b.rows_loaded, rows_rejected: 0, import: { row_errors: [] } }, error: null };
  };
  const find = (col: string, val: unknown) => state.batches.filter((b) => b[col] === val).at(-1) ?? null;
  const from = () => ({ select: () => ({ eq: (col: string, val: unknown) => ({
    order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: find(col, val), error: null }) }) }),
    maybeSingle: async () => ({ data: find(col, val), error: null }) }) }) });
  return { state, client: { rpc, from } };
});
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => h.client }));

import { findLoadBatchByHash, runQuestionLoad } from "./question-loading";
import { createPacer } from "@/lib/question-loading/resume";

const topic = (n: number): LoadTopic => ({ key: `t${n}`, indicator_node_id: `n${n}`, title: `Topic ${n}`, concepts: ["c"], target_questions: 50 });
const row = (t: number, i: number): LoadRowPayload => ({ topic_key: `t${t}`, concept: "c", indicator_node_id: `n${t}`, subject: "S", grade: "B4", question_text: `q${i}`, answer_type: "SINGLE_CHOICE",
  option_a: "a", option_b: "b", option_c: "c", option_d: "d", correct_answer: "A", explanation: "e", difficulty: "easy", cognitive_level: "Remember", source_reference: "s" });
const payload = (topics: number, per = 50): LoadPayload => ({ topics: Array.from({ length: topics }, (_, t) => topic(t)),
  rows: Array.from({ length: topics }, (_, t) => Array.from({ length: per }, (_, i) => row(t, t * per + i))).flat(), expectedRows: topics * per, skipped: [] });
const ALL = payload(52).rows.map((r) => r.question_text);   // 2,600 rows, like the two Science files together

const load = (extra: Record<string, unknown> = {}) => runQuestionLoad({ payload: payload(52), fileName: "science.csv", fileSha256: "a".repeat(64), marketId: "m", curriculumId: "c", sourceIds: ["s"], retryDelayMs: 0,
  pacer: createPacer({ limit: 0 }), rateWaitMs: 0, sleep: async () => {}, ...extra });
beforeEach(() => { h.state.batches = []; h.state.stored = []; h.state.calls = 0; h.state.plan = {}; h.state.stamps = []; h.state.clock = 0; });

describe("loading a large file", () => {
  it("sends every question exactly once, in order, in small requests", async () => {
    const r = await load();
    expect(h.state.stored).toEqual(ALL);
    expect(h.state.calls).toBe(11);               // ten of 250 and one of 100
    expect(r).toMatchObject({ status: "LOADED", rows_total: 2600, rows_loaded: 2600 });
  });

  it("retries a time-out that happened before any work was done, without duplicating anything", async () => {
    h.state.plan = { 3: "timeout-before", 4: "timeout-before" };
    const r = await load();
    expect(h.state.stored).toEqual(ALL);
    expect(r.status).toBe("LOADED");
  });

  it("does not resend a request the database already finished before the time-out reached us", async () => {
    h.state.plan = { 3: "timeout-after" };
    const r = await load();
    expect(h.state.stored).toEqual(ALL);          // no duplicates
    expect(h.state.stored.length).toBe(2600);
    expect(h.state.calls).toBe(11);               // nothing was sent twice
    expect(r.status).toBe("LOADED");
  });

  it("gives up after repeated time-outs and says where it stopped and why", async () => {
    h.state.plan = { 3: "timeout-before", 4: "timeout-before", 5: "timeout-before" };
    await expect(load()).rejects.toThrow(/questions 501 to 750 of 2600; 500 before that were saved.*57014/s);
    expect(h.state.stored).toEqual(ALL.slice(0, 500));
    expect(h.state.batches[0]).toMatchObject({ status: "LOADING", rows_total: 500 });
  });

  it("does not retry a rule the database refused, and the load can then be continued without repeating a single question", async () => {
    h.state.plan = { 4: "refuse" };
    await expect(load()).rejects.toThrow(/questions 751 to 1000 of 2600; 750 before that were saved/);
    expect(h.state.calls).toBe(4);                // stopped at once: no retry of a refusal
    expect(h.state.stored).toEqual(ALL.slice(0, 750));

    h.state.plan = {};
    const held = await findLoadBatchByHash("a".repeat(64));
    expect(held).toMatchObject({ id: "b1", status: "LOADING", rows_total: 750 });
    const r = await load({ resume: { batchId: held!.id, fromRow: held!.rows_total } });
    expect(h.state.stored).toEqual(ALL);          // every question once, none missing
    expect(r).toMatchObject({ status: "LOADED", rows_total: 2600 });
  });

  it("stops rather than leave a gap if it is told to continue past what the database holds", async () => {
    h.state.plan = { 4: "refuse" };
    await expect(load()).rejects.toThrow();
    h.state.plan = { 5: "timeout-before" };
    await expect(load({ resume: { batchId: "b1", fromRow: 1000 } })).rejects.toThrow(/fewer questions than this load expected/);
    expect(h.state.stored).toEqual(ALL.slice(0, 750));
  });

  it("treats the database's per-minute limit as a pause: waits, sends the same request again, loses and repeats nothing", async () => {
    h.state.plan = { 4: "rate-limit", 5: "rate-limit" };
    const waits: number[] = [];
    const r = await load({ rateWaitMs: 20_000, sleep: async (ms: number) => { waits.push(ms); }, onWait: (s: number) => waits.push(-s) });
    expect(h.state.stored).toEqual(ALL);
    expect(r).toMatchObject({ status: "LOADED", rows_total: 2600 });
    expect(h.state.calls).toBe(13);                           // eleven requests plus the two that were refused and sent again
    expect(waits.filter((w) => w > 0).reduce((a, b) => a + b, 0)).toBe(40_000);   // two waits of 20 seconds
    expect(waits).toContain(-20);                              // the screen is told how long the pause is
  });

  it("gives up with the plain message only after waiting about two minutes in vain, and the load can still be continued", async () => {
    h.state.plan = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [4 + i, "rate-limit" as const]));
    await expect(load()).rejects.toThrow(/Too many content requests.*questions 751 to 1000 of 2600; 750 before that were saved/s);
    expect(h.state.calls).toBe(3 + 7);                         // the first request refused plus six retries
    expect(h.state.stored).toEqual(ALL.slice(0, 750));
    h.state.plan = {};
    const r = await load({ resume: { batchId: "b1", fromRow: 750 } });
    expect(h.state.stored).toEqual(ALL);
    expect(r.status).toBe("LOADED");
  });

  it("spaces its own requests so that no minute ever holds more than eight of them", async () => {
    const pacer = createPacer({ limit: 8, now: () => h.state.clock, sleep: async (ms: number) => { h.state.clock += ms; } });
    await load({ pacer });                                     // 11 requests
    expect(h.state.calls).toBe(11);
    for (const t of h.state.stamps) expect(h.state.stamps.filter((s) => s >= t && s < t + 60_000).length).toBeLessThanOrEqual(8);
    expect(h.state.stamps.at(-1)! - h.state.stamps[0]).toBeGreaterThanOrEqual(60_000);   // the ninth request had to wait for the window
    expect(h.state.stored).toEqual(ALL);
  });

  it("refuses to load the same file twice from scratch", async () => {
    await load();
    await expect(load()).rejects.toThrow();
    expect(h.state.stored).toEqual(ALL);
  });
});
