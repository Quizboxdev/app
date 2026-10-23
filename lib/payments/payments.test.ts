import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPaystackProvider } from "./paystack";
import { findPlan, isOnlinePlan, planPriceMinor } from "./plans";

const SECRET = "sk_test_secret";
const sign = (raw: string) => createHmac("sha512", SECRET).update(raw).digest("hex");
const chargeSuccess = (over: Record<string, unknown> = {}) => JSON.stringify({ event: "charge.success", data: { id: 99, reference: "QB-abc", amount: 1000, currency: "GHS", status: "success", ...over } });
const live = (data: Record<string, unknown>, ok = true) => vi.fn(async () => ({ ok, json: async () => ({ status: ok, data }) }) as unknown as Response);

describe("plans and prices", () => {
  it("sells only plans that name their Coins and days, priced from the unit price", () => {
    expect(isOnlinePlan(findPlan("learner_monthly"))).toBe(true);
    expect(isOnlinePlan(findPlan("school"))).toBe(false);
    expect(isOnlinePlan(findPlan("nope"))).toBe(false);
    expect(planPriceMinor(findPlan("learner_monthly")!, 100)).toBe(1000);
    expect(planPriceMinor(findPlan("learner_monthly")!, 0)).toBeNull();
    expect(planPriceMinor(findPlan("school")!, 100)).toBeNull();
  });
});

describe("Paystack adapter", () => {
  it("accepts a correctly signed charge only after the provider itself confirms it", async () => {
    const raw = chargeSuccess();
    const fetchMock = live({ status: "success", amount: 1000, currency: "GHS" });
    const e = await createPaystackProvider(SECRET, fetchMock as any).verifyWebhook(raw, new Headers({ "x-paystack-signature": sign(raw) }));
    expect(e).toEqual({ provider: "paystack", eventId: "charge.success:99", reference: "QB-abc", status: "successful", providerReference: "99", amountMinor: 1000, currency: "GHS" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls as any[][])[0][0])).toContain("/transaction/verify/QB-abc");
  });
  it("rejects a bad, missing or wrong-key signature without calling the provider", async () => {
    const raw = chargeSuccess(); const fetchMock = live({ status: "success", amount: 1000, currency: "GHS" });
    const p = createPaystackProvider(SECRET, fetchMock as any);
    expect(await p.verifyWebhook(raw, new Headers())).toBeNull();
    expect(await p.verifyWebhook(raw, new Headers({ "x-paystack-signature": "abc" }))).toBeNull();
    expect(await p.verifyWebhook(raw, new Headers({ "x-paystack-signature": createHmac("sha512", "other").update(raw).digest("hex") }))).toBeNull();
    expect(await p.verifyWebhook(raw + " ", new Headers({ "x-paystack-signature": sign(raw) }))).toBeNull();          // the body was altered
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a signed claim the provider does not confirm: wrong status, amount, currency or an unreachable API", async () => {
    const raw = chargeSuccess(); const h = new Headers({ "x-paystack-signature": sign(raw) });
    for (const data of [{ status: "failed", amount: 1000, currency: "GHS" }, { status: "success", amount: 500, currency: "GHS" }, { status: "success", amount: 1000, currency: "USD" }])
      expect(await createPaystackProvider(SECRET, live(data) as any).verifyWebhook(raw, h)).toBeNull();
    expect(await createPaystackProvider(SECRET, live({}, false) as any).verifyWebhook(raw, h)).toBeNull();
  });
  it("maps failures and refunds, and ignores events it does not understand", async () => {
    const p = createPaystackProvider(SECRET, live({}) as any);
    const fail = JSON.stringify({ event: "charge.failed", data: { id: 7, reference: "QB-x", amount: 1000, currency: "GHS" } });
    expect(await p.verifyWebhook(fail, new Headers({ "x-paystack-signature": sign(fail) }))).toMatchObject({ status: "failed", reference: "QB-x" });
    const refund = JSON.stringify({ event: "refund.processed", data: { id: 5, transaction_reference: "QB-abc", amount: 1000, currency: "GHS" } });
    expect(await p.verifyWebhook(refund, new Headers({ "x-paystack-signature": sign(refund) }))).toMatchObject({ status: "refunded", reference: "QB-abc", eventId: "refund.processed:5" });
    const other = JSON.stringify({ event: "customeridentification.success", data: {} });
    expect(await p.verifyWebhook(other, new Headers({ "x-paystack-signature": sign(other) }))).toBeNull();
  });
  it("starts a transaction with the server-computed amount and returns only the checkout address", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/xyz", reference: "QB-abc" } }) }) as unknown as Response);
    const r = await createPaystackProvider(SECRET, fetchMock as any).initialize({ email: "a@b.com", amountMinor: 1000, currency: "GHS", reference: "QB-abc", callbackUrl: "https://www.quizbox.io/subscribe" });
    expect(r).toEqual({ url: "https://checkout.paystack.com/xyz", reference: "QB-abc" });
    const [, init] = (fetchMock.mock.calls as any[][])[0];
    expect(JSON.parse(init.body)).toMatchObject({ amount: 1000, currency: "GHS", reference: "QB-abc", channels: ["mobile_money", "card"] });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    await expect(createPaystackProvider(SECRET, vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response) as any).initialize({ email: "a@b.com", amountMinor: 1, currency: "GHS", reference: "r", callbackUrl: "u" })).rejects.toThrow("PAYMENT_PROVIDER_UNAVAILABLE");
  });
});

describe("settlement after a verified callback", () => {
  const rpc = vi.fn();
  const admin: any = { rpc };
  beforeEach(() => { rpc.mockReset(); process.env.PAYSTACK_SECRET_KEY = SECRET; vi.resetModules(); });
  const run = async (raw: string, ledgerOutcome: string, fetchData: Record<string, unknown> = { status: "success", amount: 1000, currency: "GHS" }) => {
    vi.stubGlobal("fetch", live(fetchData));
    rpc.mockImplementation(async (name: string) => name === "qb_payment_apply_event" ? { data: { outcome: ledgerOutcome }, error: null } : { data: {}, error: null });
    const { processProviderCallback } = await import("./settlement");
    return processProviderCallback(admin, "paystack", raw, new Headers({ "x-paystack-signature": sign(raw) }));
  };
  it("grants the subscription after a credited payment, and is safe to repeat", async () => {
    const res = await run(chargeSuccess(), "credited");
    expect(res).toEqual({ status: 200, outcome: "credited" });
    expect(rpc).toHaveBeenCalledWith("qb_fulfil_subscription_payment", { p_reference: "QB-abc" });
    rpc.mockClear();
    expect((await run(chargeSuccess(), "already_settled")).status).toBe(200);                                         // a retried callback re-checks fulfilment, harmlessly
    expect(rpc).toHaveBeenCalledWith("qb_fulfil_subscription_payment", { p_reference: "QB-abc" });
  });
  it("does not grant for a duplicate event, a mismatch or an unverifiable call", async () => {
    await run(chargeSuccess(), "duplicate_event"); await run(chargeSuccess(), "amount_mismatch");
    expect(rpc).not.toHaveBeenCalledWith("qb_fulfil_subscription_payment", expect.anything());
    rpc.mockClear();
    const raw = chargeSuccess();
    vi.stubGlobal("fetch", live({ status: "success", amount: 1000, currency: "GHS" }));
    const { processProviderCallback } = await import("./settlement");
    expect((await processProviderCallback(admin, "paystack", raw, new Headers({ "x-paystack-signature": "bad" }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("revokes the subscription on a refund, and asks the provider to retry if fulfilment fails", async () => {
    const refund = JSON.stringify({ event: "refund.processed", data: { id: 5, transaction_reference: "QB-abc", amount: 1000, currency: "GHS" } });
    await run(refund, "refunded");
    expect(rpc).toHaveBeenCalledWith("qb_revoke_subscription_payment", { p_reference: "QB-abc", p_reason: "refunded" });
    rpc.mockReset(); vi.stubGlobal("fetch", live({ status: "success", amount: 1000, currency: "GHS" }));
    rpc.mockImplementation(async (name: string) => name === "qb_payment_apply_event" ? { data: { outcome: "credited" }, error: null } : { data: null, error: { message: "boom" } });
    const { processProviderCallback } = await import("./settlement");
    const raw = chargeSuccess();
    expect((await processProviderCallback(admin, "paystack", raw, new Headers({ "x-paystack-signature": sign(raw) }))).status).toBe(500);
  });
  it("records a Marketplace sale after a credited payment, reverses it on a refund, and tolerates a database that has no Marketplace yet", async () => {
    await run(chargeSuccess(), "credited");
    expect(rpc).toHaveBeenCalledWith("qb_mk_fulfil_purchase", { p_reference: "QB-abc" });
    const refund = JSON.stringify({ event: "refund.processed", data: { id: 6, transaction_reference: "QB-abc", amount: 1000, currency: "GHS" } });
    rpc.mockClear(); await run(refund, "refunded");
    expect(rpc).toHaveBeenCalledWith("qb_mk_reverse_purchase", { p_reference: "QB-abc", p_reason: "refunded" });
    rpc.mockReset(); vi.stubGlobal("fetch", live({ status: "success", amount: 1000, currency: "GHS" }));
    rpc.mockImplementation(async (name: string) => name === "qb_payment_apply_event" ? { data: { outcome: "credited" }, error: null } : name === "qb_mk_fulfil_purchase" ? { data: null, error: { message: "Could not find the function public.qb_mk_fulfil_purchase in the schema cache" } } : { data: {}, error: null });
    const { processProviderCallback } = await import("./settlement");
    const raw = chargeSuccess();
    expect((await processProviderCallback(admin, "paystack", raw, new Headers({ "x-paystack-signature": sign(raw) }))).status).toBe(200);
    rpc.mockImplementation(async (name: string) => name === "qb_payment_apply_event" ? { data: { outcome: "credited" }, error: null } : name === "qb_mk_fulfil_purchase" ? { data: null, error: { message: "deadlock detected" } } : { data: {}, error: null });
    expect((await processProviderCallback(admin, "paystack", raw, new Headers({ "x-paystack-signature": sign(raw) }))).status).toBe(500);   // a real failure makes the provider retry
  });
});
