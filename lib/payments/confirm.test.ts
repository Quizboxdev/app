import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmPayment } from "./confirm";

// The safety net for a late webhook: only Paystack's own answer counts, only for the caller's own payment, and settling is idempotent.
const REF = "QB-c86b44e12ebb40d1984647847ffda3f0", ME = "user-1";
const rpc = vi.fn();
let intent: Record<string, unknown> | null;
const admin: any = { rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: intent }) }) }) }) };
const paystack = (data: Record<string, unknown>, ok = true) => vi.fn(async () => new Response(JSON.stringify({ status: true, data }), { status: ok ? 200 : 500 })) as unknown as typeof fetch;
const SUCCESS = { id: 6688602926, status: "success", amount: 4000, currency: "GHS", reference: REF };
beforeEach(() => { rpc.mockReset(); intent = { payer_user_id: ME, beneficiary_user_id: ME, status: "initiated" }; rpc.mockImplementation(async (n: string) => n === "qb_payment_apply_event" ? { data: { outcome: "credited" }, error: null } : { data: {}, error: null }); });

describe("confirmPayment", () => {
  it("settles a payment Paystack says succeeded: credits it, then records the purchase", async () => {
    const out = await confirmPayment(admin, "sk", ME, REF, paystack(SUCCESS));
    expect(out).toEqual({ state: "confirmed" });
    expect(rpc).toHaveBeenCalledWith("qb_payment_apply_event", expect.objectContaining({ p_reference: REF, p_event_id: "charge.success:6688602926", p_status: "successful", p_amount_minor: 4000, p_currency: "GHS", p_verified: true }));
    expect(rpc).toHaveBeenCalledWith("qb_fulfil_subscription_payment", { p_reference: REF });
    expect(rpc).toHaveBeenCalledWith("qb_mk_fulfil_purchase", { p_reference: REF });
  });
  it("uses the same event id as the webhook, so the webhook arriving later changes nothing", async () => {
    await confirmPayment(admin, "sk", ME, REF, paystack(SUCCESS));
    expect(rpc.mock.calls.find((c) => c[0] === "qb_payment_apply_event")![1].p_event_id).toBe("charge.success:6688602926");
  });
  it("only handles the caller's own payment, and a malformed reference is ignored without asking anyone", async () => {
    intent = { payer_user_id: "someone-else", beneficiary_user_id: "another", status: "initiated" };
    const f = paystack(SUCCESS);
    expect(await confirmPayment(admin, "sk", ME, REF, f)).toEqual({ state: "unknown" });
    intent = null; expect(await confirmPayment(admin, "sk", ME, REF, f)).toEqual({ state: "unknown" });
    expect(await confirmPayment(admin, "sk", ME, "'; drop table", f)).toEqual({ state: "unknown" });
    expect(f).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not credit while Paystack says pending, abandoned or failed, or cannot be reached", async () => {
    expect(await confirmPayment(admin, "sk", ME, REF, paystack({ ...SUCCESS, status: "ongoing" }))).toEqual({ state: "pending" });
    expect(await confirmPayment(admin, "sk", ME, REF, paystack({ ...SUCCESS, status: "abandoned" }))).toEqual({ state: "failed" });
    expect(await confirmPayment(admin, "sk", ME, REF, paystack({ ...SUCCESS, status: "failed" }))).toEqual({ state: "failed" });
    expect(await confirmPayment(admin, "sk", ME, REF, (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toEqual({ state: "pending" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a reference that Paystack answers for under a different reference", async () => {
    expect(await confirmPayment(admin, "sk", ME, REF, paystack({ ...SUCCESS, reference: "QB-0000000000000000" }))).toEqual({ state: "pending" });   // never credited
    expect(rpc).not.toHaveBeenCalled();
  });
  it("an already settled payment is only checked for its purchase; a failure to record it is reported as pending so it is tried again", async () => {
    intent = { payer_user_id: ME, beneficiary_user_id: ME, status: "successful" };
    expect(await confirmPayment(admin, "sk", ME, REF, paystack(SUCCESS))).toEqual({ state: "confirmed" });
    expect(rpc).not.toHaveBeenCalledWith("qb_payment_apply_event", expect.anything());
    rpc.mockImplementation(async (n: string) => n === "qb_mk_fulfil_purchase" ? { data: null, error: { message: "boom" } } : { data: {}, error: null });
    expect(await confirmPayment(admin, "sk", ME, REF, paystack(SUCCESS))).toEqual({ state: "pending", error: "fulfilment_failed" });
  });
  it("a mismatched amount is not treated as paid", async () => {
    rpc.mockImplementation(async (n: string) => n === "qb_payment_apply_event" ? { data: { outcome: "amount_mismatch" }, error: null } : { data: {}, error: null });
    expect(await confirmPayment(admin, "sk", ME, REF, paystack(SUCCESS))).toEqual({ state: "failed" });
  });
});
