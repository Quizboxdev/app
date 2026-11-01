import { beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the database's step functions: it counts down what is left and reports done on the last step, and can be told to fail or to lack the new functions.
const h = vi.hoisted(() => {
  const state = { left: 0, calls: [] as Array<{ fn: string; args: any }>, missing: false, failOnce: null as null | { code: string; message: string } };
  const rpc = async (fn: string, args: any) => {
    state.calls.push({ fn, args });
    if (state.missing && fn.endsWith("_step")) return { data: null, error: { code: "PGRST202", message: `Could not find the function public.${fn} in the schema cache` } };
    if (state.failOnce) { const e = state.failOnce; state.failOnce = null; return { data: null, error: e }; }
    if (fn === "qb_owner_approve_batch_step") {
      const n = Math.min(args.p_limit, state.left); state.left -= n; const done = n < args.p_limit;
      return { data: { approval_id: "a1", done, approved: 250 - state.left, questions_found: 253, skipped: 3, published: true }, error: null };
    }
    if (fn === "qb_owner_revoke_batch_approval_step") { const n = Math.min(args.p_limit, state.left); state.left -= n; return { data: { done: n < args.p_limit, returned_to_review: 250 - state.left }, error: null }; }
    if (fn === "qb_owner_batch_discard_step") { const n = Math.min(args.p_limit, state.left); state.left -= n; const done = n < args.p_limit; return { data: done ? { batch_id: args.p_batch, done, withdrawn: 250 } : { batch_id: args.p_batch, done, withdrawn_now: n }, error: null }; }
    return { data: { approval_id: "old", approved: 250, questions_found: 253, skipped: 3, published: true, returned_to_review: 250 }, error: null };
  };
  return { state, client: { rpc } };
});
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => h.client }));
vi.mock("@/lib/question-loading/resume", async (orig) => ({ ...(await orig<typeof import("@/lib/question-loading/resume")>()), realSleep: async () => {} }));

import { approveBatch, discardBatch, finishApproval, revokeBatchApproval } from "./owner";

beforeEach(() => { h.state.left = 250; h.state.calls = []; h.state.missing = false; h.state.failOnce = null; });
const names = () => h.state.calls.map((c) => c.fn);

describe("owner batch actions run in small steps", () => {
  it("approves a big batch in steps of 100 and reports progress", async () => {
    const seen: number[] = [];
    const r = await approveBatch("b1", "Read 25 of 250; sound.", 25, (n) => seen.push(n));
    expect(names()).toEqual(Array(3).fill("qb_owner_approve_batch_step"));
    expect(h.state.calls[0].args).toMatchObject({ p_batch: "b1", p_sample_reviewed: 25, p_publish: true, p_limit: 100 });
    expect(seen).toEqual([100, 200, 250]);
    expect(r).toMatchObject({ approved: 250, skipped: 3 });
  });
  it("finishing an approval sends no note and no sample, so it can never approve a batch nobody reviewed", async () => {
    await finishApproval("b1");
    expect(h.state.calls[0].args).toMatchObject({ p_note: "", p_sample_reviewed: 0 });
  });
  it("sends a step again after a database time-out, and the action still completes", async () => {
    h.state.failOnce = { code: "57014", message: "canceling statement due to statement timeout" };
    const r = await approveBatch("b1", "Read 25 of 250; sound.", 25);
    expect(r.approved).toBe(250);
    expect(names().length).toBe(4);   // the cut-off step, then three real ones
  });
  it("shows the technical reason when the database refuses for a reason it has no sentence for", async () => {
    h.state.failOnce = { code: "23514", message: "new row violates check constraint question_load_batches_status_check" };
    await expect(approveBatch("b1", "Read 25 of 250; sound.", 25)).rejects.toThrow(/could not be completed.*23514.*status_check/s);
  });
  it("falls back to the original single-call approval when the step function is not installed yet", async () => {
    h.state.missing = true;
    const r = await approveBatch("b1", "Read 25 of 250; sound.", 25);
    expect(names()).toEqual(["qb_owner_approve_batch_step", "qb_owner_approve_batch"]);
    expect(r.approved).toBe(250);
  });
  it("revokes in steps and falls back the same way", async () => {
    expect((await revokeBatchApproval("a1", "Reviewers will take over.")).returned_to_review).toBe(250);
    expect(names()).toEqual(Array(3).fill("qb_owner_revoke_batch_approval_step"));
    h.state.calls = []; h.state.missing = true;
    await revokeBatchApproval("a1", "Reviewers will take over.");
    expect(names()).toEqual(["qb_owner_revoke_batch_approval_step", "qb_owner_revoke_batch_approval"]);
  });
  it("discards in steps and reports how many were withdrawn; with no step function it says what to apply", async () => {
    const seen: number[] = [];
    expect(await discardBatch("b1", "File was wrong, loading it again.", (n) => seen.push(n))).toEqual({ batch_id: "b1", withdrawn: 250 });
    expect(seen).toEqual([100, 200, 250]);
    h.state.missing = true; h.state.left = 250;
    await expect(discardBatch("b1", "File was wrong, loading it again.")).rejects.toThrow(/20261052100000/);
  });
});
