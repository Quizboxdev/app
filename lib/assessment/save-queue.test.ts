import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveQueue, type SaveQueueState } from "./save-queue";

// Audit UX-011: an answer whose save failed must never be silently dropped, and the warning must clear once everything is saved.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const deferred = () => { let resolve!: () => void, reject!: (e: unknown) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

describe("createSaveQueue", () => {
  it("saves queued answers in order and reports that nothing is left", async () => {
    const saved: string[] = [];
    const q = createSaveQueue<string>({ save: async (k, v) => { saved.push(`${k}=${v}`); } });
    q.enqueue("q1", "A"); q.enqueue("q2", "B");
    expect(await q.flush()).toBe(true);
    expect(saved).toEqual(["q1=A", "q2=B"]);
    expect(q.hasUnsaved()).toBe(false);
  });

  it("keeps a failed answer queued, retries it by itself, and clears the failed state", async () => {
    let online = false; const saved: string[] = []; const states: SaveQueueState[] = [];
    const q = createSaveQueue<string>({ save: async (k, v) => { if (!online) throw new Error("Failed to fetch"); saved.push(`${k}=${v}`); }, onChange: (s) => states.push(s), retryDelaysMs: [1000] });
    q.enqueue("q2", "B");
    expect(await q.flush()).toBe(false);
    expect(q.hasUnsaved()).toBe(true);
    expect(states.at(-1)!.failed.has("q2")).toBe(true);
    online = true;
    await vi.advanceTimersByTimeAsync(1000);                       // the scheduled retry runs without any user action
    expect(saved).toEqual(["q2=B"]);
    expect(q.hasUnsaved()).toBe(false);
    expect(states.at(-1)!.failed.size).toBe(0);
    q.dispose();
  });

  it("does not let an earlier failed answer be submitted as blank: the final flush saves it too", async () => {
    let online = false; const saved: string[] = [];
    const q = createSaveQueue<string>({ save: async (k, v) => { if (!online) throw new Error("offline"); saved.push(k + "=" + v); }, retryDelaysMs: [60000] });
    q.enqueue("q2", "B");
    await q.flush();                                               // q2 failed
    online = true;
    q.enqueue("q3", "C");                                          // the student carries on
    expect(await q.flush()).toBe(true);                            // what submit waits for
    expect(saved.sort()).toEqual(["q2=B", "q3=C"]);
    q.dispose();
  });

  it("the newest answer for a question wins over an older save still in flight", async () => {
    const first = deferred(); const calls: string[] = [];
    const q = createSaveQueue<string>({ save: async (k, v) => { calls.push(`${k}=${v}`); if (v === "A") await first.promise; } });
    q.enqueue("q1", "A");
    await Promise.resolve();
    q.enqueue("q1", "B");                                          // changed their mind while A is being saved
    first.resolve();
    expect(await q.flush()).toBe(true);
    expect(calls).toEqual(["q1=A", "q1=B"]);
    expect(q.hasUnsaved()).toBe(false);
  });

  it("retryNow skips the waiting time (for the Try now button and the browser online event)", async () => {
    let online = false; const saved: string[] = [];
    const q = createSaveQueue<string>({ save: async (k, v) => { if (!online) throw new Error("x"); saved.push(k + v); }, retryDelaysMs: [60000] });
    q.enqueue("q1", "A"); await q.flush();
    online = true;
    expect(await q.retryNow()).toBe(true);
    expect(saved).toEqual(["q1A"]);
    q.dispose();
  });

  it("stops retrying after dispose", async () => {
    const save = vi.fn(async () => { throw new Error("x"); });
    const q = createSaveQueue<string>({ save, retryDelaysMs: [1000] });
    q.enqueue("q1", "A"); await q.flush();
    const before = save.mock.calls.length;
    q.dispose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(save.mock.calls.length).toBe(before);
  });

  it("drops an answer the server refuses (not retryable) and reports it, then carries on", async () => {
    const saved: string[] = []; const rejected: string[] = [];
    const q = createSaveQueue<string>({
      save: async (k, v) => { if (k === "q1") throw new Error("closed"); saved.push(k + v); },
      isRetryable: (e) => (e as Error).message !== "closed", onReject: (k) => rejected.push(k),
    });
    q.enqueue("q1", "A"); q.enqueue("q2", "B");
    expect(await q.flush()).toBe(true);
    expect(rejected).toEqual(["q1"]);
    expect(saved).toEqual(["q2B"]);
    expect(q.hasUnsaved()).toBe(false);
  });
});
