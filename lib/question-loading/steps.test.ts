import { describe, expect, it } from "vitest";
import { isMissingFunction, runSteps } from "./steps";

const fail = (code: string, rawMessage: string) => Object.assign(new Error("friendly sentence"), { code, rawMessage });
const noWait = { retryDelayMs: 0, sleep: async () => {} };

describe("running a database action in steps", () => {
  it("keeps going until the database says it is done, and tells the screen about every step", async () => {
    let calls = 0; const seen: number[] = [];
    const r = await runSteps(async () => ({ done: ++calls === 4, n: calls * 100 }), { ...noWait, onStep: (x) => seen.push(x.n) });
    expect(calls).toBe(4);
    expect(seen).toEqual([100, 200, 300, 400]);
    expect(r.done).toBe(true);
  });
  it("sends a step again after a time-out (the step changed nothing) and carries on", async () => {
    let calls = 0;
    const r = await runSteps(async () => { calls++; if (calls === 2 || calls === 3) throw fail("57014", "canceling statement due to statement timeout"); return { done: calls >= 4 }; }, noWait);
    expect(r.done).toBe(true);
    expect(calls).toBe(4);
  });
  it("gives up on a step that keeps timing out, with the original error", async () => {
    let calls = 0;
    await expect(runSteps(async () => { calls++; throw fail("57014", "statement timeout"); }, noWait)).rejects.toThrow("friendly sentence");
    expect(calls).toBe(4);   // the first try and three more
  });
  it("never retries a rule the database refused", async () => {
    let calls = 0;
    await expect(runSteps(async () => { calls++; throw fail("P0001", "QB_BATCH_IS_LIVE"); }, noWait)).rejects.toThrow("friendly sentence");
    expect(calls).toBe(1);
  });
  it("stops a runaway loop instead of running for ever", async () => {
    await expect(runSteps(async () => ({ done: false }), { ...noWait, maxSteps: 5 })).rejects.toThrow(/much longer than expected/);
  });
  it("recognises a function that is not installed yet", () => {
    expect(isMissingFunction(fail("PGRST202", "Could not find the function public.qb_owner_approve_batch_step in the schema cache"))).toBe(true);
    expect(isMissingFunction(fail("P0001", "QB_BATCH_IS_LIVE"))).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});
