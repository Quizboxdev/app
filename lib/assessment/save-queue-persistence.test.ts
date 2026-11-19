import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaveQueue } from "./save-queue";
import { unsavedAnswersStore } from "./unsaved-answers";

// December gate MB-D1: answers waiting for the network must survive a reload of the answer page.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
};
type Answer = { value: { selectedAnswer: string }; seconds: number };

describe("unsaved answers survive a reload", () => {
  it("an answer whose save failed is still there after the page is rebuilt, and is saved once the connection returns", async () => {
    const backing = fakeStorage();
    let online = false;
    const saved: string[] = [];
    const save = async (k: string, v: Answer) => { if (!online) throw new Error("offline"); saved.push(`${k}=${v.value.selectedAnswer}`); };

    const first = createSaveQueue<Answer>({ save, storage: unsavedAnswersStore<Answer>("attempt-1", backing) });
    first.enqueue("q1", { value: { selectedAnswer: "B" }, seconds: 4 });
    first.enqueue("q2", { value: { selectedAnswer: "C" }, seconds: 6 });
    await vi.advanceTimersByTimeAsync(0);
    first.dispose();                                    // the phone reloads the page or kills the tab
    expect(backing.data.size).toBe(1);

    const second = createSaveQueue<Answer>({ save, storage: unsavedAnswersStore<Answer>("attempt-1", backing) });
    expect(second.snapshot().map(([k, v]) => `${k}=${v.value.selectedAnswer}`)).toEqual(["q1=B", "q2=C"]);
    expect(second.hasUnsaved()).toBe(true);
    online = true;
    expect(await second.retryNow()).toBe(true);
    expect(saved).toEqual(["q1=B", "q2=C"]);
    expect(backing.data.size).toBe(0);                  // nothing left behind once everything is saved
    second.dispose();
  });

  it("a newer answer for the same question replaces the stored one", async () => {
    const backing = fakeStorage();
    const q = createSaveQueue<Answer>({ save: async () => { throw new Error("offline"); }, storage: unsavedAnswersStore<Answer>("a", backing) });
    q.enqueue("q1", { value: { selectedAnswer: "A" }, seconds: 1 });
    q.enqueue("q1", { value: { selectedAnswer: "D" }, seconds: 2 });
    await vi.advanceTimersByTimeAsync(0);
    q.dispose();
    const stored = unsavedAnswersStore<Answer>("a", backing).read();
    expect(stored).toHaveLength(1);
    expect(stored[0][1].value.selectedAnswer).toBe("D");
  });

  it("an answer the server refuses (attempt closed) is dropped from storage too", async () => {
    const backing = fakeStorage();
    const first = createSaveQueue<Answer>({ save: async () => { throw new Error("QB_ATTEMPT_NOT_ACTIVE"); }, isRetryable: () => false, storage: unsavedAnswersStore<Answer>("a", backing) });
    first.enqueue("q1", { value: { selectedAnswer: "A" }, seconds: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(backing.data.size).toBe(0);
    first.dispose();
  });

  it("storage kept for one attempt is never offered to another, and old entries are ignored", () => {
    const backing = fakeStorage();
    let now = 1_000_000;
    unsavedAnswersStore<Answer>("attempt-1", backing, () => now).write([["q1", { value: { selectedAnswer: "A" }, seconds: 1 }]]);
    expect(unsavedAnswersStore<Answer>("attempt-2", backing, () => now).read()).toEqual([]);
    expect(unsavedAnswersStore<Answer>("attempt-1", backing, () => now).read()).toHaveLength(1);
    now += 13 * 60 * 60 * 1000;
    expect(unsavedAnswersStore<Answer>("attempt-1", backing, () => now).read()).toEqual([]);
    expect(backing.data.size).toBe(0);                  // the stale entry was removed
  });

  it("blocked, full or corrupt storage never breaks answering", async () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => { throw new Error("blocked"); } };
    const saved: string[] = [];
    const q = createSaveQueue<Answer>({ save: async (k, v) => { saved.push(`${k}=${v.value.selectedAnswer}`); }, storage: unsavedAnswersStore<Answer>("a", broken) });
    q.enqueue("q1", { value: { selectedAnswer: "A" }, seconds: 1 });
    expect(await q.flush()).toBe(true);
    expect(saved).toEqual(["q1=A"]);
    const corrupt = fakeStorage(); corrupt.data.set("qb-unsaved-answers:a", "{not json");
    expect(unsavedAnswersStore<Answer>("a", corrupt).read()).toEqual([]);
    q.dispose();
  });
});
