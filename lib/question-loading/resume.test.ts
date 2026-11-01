import { describe, expect, it } from "vitest";
import { alreadyLoaded, CALL_ROWS, canContinue, continueFrom, createPacer, describeLoadFailure, isRateLimited, isTransientFailure, sliceCall } from "./resume";
import type { LoadPayload, LoadRowPayload, LoadTopic } from "./payload";

const topic = (n: number): LoadTopic => ({ key: `t${n}`, indicator_node_id: `n${n}`, title: `Topic ${n}`, concepts: ["c"], target_questions: 50 });
const row = (t: number, i: number): LoadRowPayload => ({ topic_key: `t${t}`, concept: "c", indicator_node_id: `n${t}`, subject: "S", grade: "B4", question_text: `q${i}`, answer_type: "SINGLE_CHOICE",
  option_a: "a", option_b: "b", option_c: "c", option_d: "d", correct_answer: "A", explanation: "e", difficulty: "easy", cognitive_level: "Remember", source_reference: "s" });
const payload = (rowsPerTopic: number, topics: number): LoadPayload => ({ topics: Array.from({ length: topics }, (_, t) => topic(t)),
  rows: Array.from({ length: topics }, (_, t) => Array.from({ length: rowsPerTopic }, (_, i) => row(t, t * rowsPerTopic + i))).flat(), expectedRows: rowsPerTopic * topics, skipped: [] });

describe("slicing a load into requests", () => {
  it("walks the whole file with no gap and no repeat, never over the row limit", () => {
    const p = payload(50, 52);   // 2,600 rows, like the two Science files
    const seen: string[] = []; let from = 0, calls = 0;
    while (from < p.rows.length) { const c = sliceCall(p, from); expect(c.rows.length).toBeGreaterThan(0); expect(c.rows.length).toBeLessThanOrEqual(CALL_ROWS); seen.push(...c.rows.map((r) => r.question_text)); from += c.rows.length; calls++; }
    expect(seen).toEqual(p.rows.map((r) => r.question_text));
    expect(calls).toBe(Math.ceil(2600 / CALL_ROWS));
  });
  it("sends exactly the topics a request's rows use, and every row's topic is present", () => {
    const p = payload(50, 10);
    const c = sliceCall(p, 100, 120);
    const used = new Set(c.rows.map((r) => r.topic_key));
    expect(c.topics.map((t) => t.key).sort()).toEqual([...used].sort());
    for (const r of c.rows) expect(c.topics.some((t) => t.key === r.topic_key)).toBe(true);
  });
  it("never sends more than the database's 100 topics in one request", () => {
    const p = payload(1, 400);   // one question per topic
    const c = sliceCall(p, 0, 250, 100);
    expect(c.topics.length).toBe(100);
    expect(c.rows.length).toBe(100);
    expect(sliceCall(p, 100, 250, 100).rows[0].question_text).toBe("q100");
  });
  it("returns nothing past the end and treats a negative start as zero", () => {
    const p = payload(5, 2);
    expect(sliceCall(p, 10).rows).toHaveLength(0);
    expect(sliceCall(p, -5, 3).rows.map((r) => r.question_text)).toEqual(["q0", "q1", "q2"]);
  });
});

describe("which failures are worth retrying", () => {
  it("retries time-outs, dropped connections and gateway errors", () => {
    expect(isTransientFailure({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(true);
    expect(isTransientFailure({ status: 504, message: "Gateway Timeout" })).toBe(true);
    expect(isTransientFailure({ status: 0, message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isTransientFailure({ message: "network request failed" })).toBe(true);
    expect(isTransientFailure({ code: "40P01", message: "deadlock detected" })).toBe(true);
  });
  it("never retries a rule the database refused", () => {
    expect(isTransientFailure({ message: "QB_TOPIC_INVALID_CONCEPTS" })).toBe(false);
    expect(isTransientFailure({ message: "QB_LOAD_FILE_ALREADY_LOADED", code: "P0001" })).toBe(false);
    expect(isTransientFailure({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isTransientFailure({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isTransientFailure(null)).toBe(false);
  });
});

describe("what the admin is told, and how a load continues", () => {
  it("says where it stopped and why, and how to carry on", () => {
    const m = describeLoadFailure("The operation could not be completed.", { code: "57014", message: "canceling statement due to statement timeout" }, { fromRow: 1000, toRow: 1250, total: 2600 });
    expect(m).toContain("questions 1001 to 1250 of 2600");
    expect(m).toContain("1000 before that were saved");
    expect(m).toContain("57014");
    expect(m).toContain("Choose the same file again");
  });
  it("continues from the database's own count and never past the file", () => {
    expect(continueFrom(1000, 2600)).toBe(1000);
    expect(continueFrom(3000, 2600)).toBe(2600);
    expect(continueFrom(null, 2600)).toBe(0);
    expect(continueFrom(-4, 2600)).toBe(0);
    expect(continueFrom(12.9, 2600)).toBe(12);
  });
  it("offers Continue only for a batch that stopped partway, and Already loaded for one that finished", () => {
    expect(canContinue({ id: "b", status: "LOADING", rows_total: 1000 }, 2600)).toBe(true);
    expect(canContinue({ id: "b", status: "LOADING", rows_total: 0 }, 2600)).toBe(false);
    expect(canContinue({ id: "b", status: "LOADED", rows_total: 2600 }, 2600)).toBe(false);
    expect(canContinue(null, 2600)).toBe(false);
    expect(alreadyLoaded({ id: "b", status: "LOADED", rows_total: 2600 }, 2600)).toBe(true);
    expect(alreadyLoaded({ id: "b", status: "LOADING", rows_total: 1000 }, 2600)).toBe(false);
    expect(alreadyLoaded(null, 2600)).toBe(false);
  });
});

describe("the per-minute request limit", () => {
  it("recognises the database's limit, and never confuses it with a failure to retry blindly", () => {
    expect(isRateLimited({ message: "QB_CONTENT_RATE_LIMIT", code: "P0001" })).toBe(true);
    expect(isRateLimited({ message: "QB_RATE_LIMITED" })).toBe(true);
    expect(isRateLimited({ message: "QB_TOPIC_INVALID_CONCEPTS", code: "P0001" })).toBe(false);
    expect(isRateLimited(null)).toBe(false);
    expect(isTransientFailure({ message: "QB_CONTENT_RATE_LIMIT", code: "P0001" })).toBe(false);
  });
  it("lets a burst through, then makes the next request wait for the window to clear", async () => {
    let clock = 0; const slept: number[] = [];
    const pacer = createPacer({ limit: 3, windowMs: 60_000, now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
    for (let i = 0; i < 3; i++) await pacer.wait();
    expect(slept).toEqual([]);
    await pacer.wait();
    expect(slept.reduce((a, b) => a + b, 0)).toBe(60_250);
    expect(clock).toBe(60_250);
  });
  it("is switched off by a limit of 0", async () => {
    const pacer = createPacer({ limit: 0, sleep: async () => { throw new Error("must not wait"); } });
    for (let i = 0; i < 50; i++) await pacer.wait();
  });
});
