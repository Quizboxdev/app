import { beforeEach, describe, expect, it, vi } from "vitest";
import { findPaymentIssues, settlePayment } from "./reconcile";

// Payment checks: what is flagged, what is left alone, and that settling uses Paystack's answer only and is written to the audit log.
const NOW = new Date("2026-10-24T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>; const inserted: { table: string; row: Row }[] = []; const rpc = vi.fn();
// A tiny stand-in for the database client: filters and ordering used by the checks, and insert.
const fake: any = {
  rpc,
  from: (table: string) => {
    let rows = [...(tables[table] ?? [])]; let single = false;
    const q: any = {
      select: () => q, gte: (c: string, v: string) => { rows = rows.filter((r) => String(r[c]) >= v); return q; }, order: () => { rows.sort((a, b) => (String(a.created_at) < String(b.created_at) ? 1 : -1)); return q; }, limit: () => q,
      in: (c: string, vs: unknown[]) => { rows = rows.filter((r) => vs.includes(r[c])); return q; }, eq: (c: string, v: unknown) => { rows = rows.filter((r) => r[c] === v); return q; },
      maybeSingle: () => { single = true; return q; }, insert: async (row: Row) => { inserted.push({ table, row }); return { error: null }; },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(ok),
    };
    return q;
  },
};
const intent = (reference: string, over: Row = {}): Row => ({ reference, status: "initiated", amount_minor: 4000, currency_code: "GHS", created_at: ago(60), credited_tx_id: null, beneficiary_user_id: "u1", payer_user_id: "u1", metadata: { purpose: "marketplace", item_title: "Physics Set" }, ...over });
const paystack = (status: Record<string, string>, fail: string[] = []) => vi.fn(async (url: string) => {
  const ref = decodeURIComponent(url.split("/verify/")[1]);
  if (fail.includes(ref)) throw new Error("offline");
  const s = status[ref]; if (!s) return new Response(JSON.stringify({ status: false }), { status: 404 });
  return new Response(JSON.stringify({ status: true, data: { id: 99, status: s, amount: 4000, currency: "GHS", reference: ref } }), { status: 200 });
}) as unknown as typeof fetch;

beforeEach(() => { inserted.length = 0; rpc.mockReset(); rpc.mockImplementation(async (n: string) => n === "qb_payment_apply_event" ? { data: { outcome: "credited" }, error: null } : { data: {}, error: null });
  tables = { profiles: [{ id: "u1", email: "esi@example.com" }], payment_intents: [], mk_purchases: [], learner_subscriptions: [] }; });

describe("findPaymentIssues", () => {
  it("flags a payment Paystack says succeeded but we never recorded, and shows the buyer", async () => {
    tables.payment_intents = [intent("QB-lost0001")];
    const r = await findPaymentIssues(fake, "sk", { fetchImpl: paystack({ "QB-lost0001": "success" }), now: NOW });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ reference: "QB-lost0001", issue: "paid_not_recorded", can_settle: true, paystack: "success", buyer_email: "esi@example.com", what: "Physics Set", amount_minor: 4000, db_status: "initiated" });
  });
  it("leaves abandoned, failed and never-seen payments as 'not paid', and in-progress ones as 'waiting'", async () => {
    tables.payment_intents = [intent("QB-aband001"), intent("QB-failed01"), intent("QB-never001"), intent("QB-ongoin01")];
    const r = await findPaymentIssues(fake, "sk", { fetchImpl: paystack({ "QB-aband001": "abandoned", "QB-failed01": "failed", "QB-ongoin01": "ongoing" }), now: NOW });
    const by = Object.fromEntries(r.rows.map((x) => [x.reference, x]));
    expect(by["QB-aband001"]).toMatchObject({ issue: "unpaid", can_settle: false }); expect(by["QB-failed01"].issue).toBe("unpaid");
    expect(by["QB-never001"]).toMatchObject({ issue: "unpaid", paystack: "not_found" }); expect(by["QB-ongoin01"]).toMatchObject({ issue: "waiting", can_settle: false });
  });
  it("does not ask about payments started in the last few minutes (the buyer may still be paying), or older than the look-back", async () => {
    tables.payment_intents = [intent("QB-fresh001", { created_at: ago(1) }), intent("QB-old00001", { created_at: new Date(NOW.getTime() - 20 * 86400000).toISOString() })];
    const f = paystack({});
    const r = await findPaymentIssues(fake, "sk", { fetchImpl: f, now: NOW, days: 14 });
    expect(r.rows).toEqual([]); expect(f).not.toHaveBeenCalled();
  });
  it("flags a payment we recorded as paid whose purchase was never granted, and ignores ones that were", async () => {
    tables.payment_intents = [intent("QB-nodeliv01", { status: "successful", credited_tx_id: "t1" }), intent("QB-delivere1", { status: "successful", credited_tx_id: "t2" }),
      intent("QB-nosub0001", { status: "successful", credited_tx_id: "t3", metadata: { purpose: "subscription", plan: "weekly" } }), intent("QB-coins0001", { status: "successful", credited_tx_id: "t4", metadata: {} })];
    tables.mk_purchases = [{ payment_reference: "QB-delivere1" }];
    const r = await findPaymentIssues(fake, "sk", { fetchImpl: paystack({}), now: NOW });
    expect(r.rows.map((x) => [x.reference, x.issue]).sort()).toEqual([["QB-nodeliv01", "paid_not_delivered"], ["QB-nosub0001", "paid_not_delivered"]]);   // a plain Coins top-up needs nothing delivered
  });
  it("counts the payments Paystack could not be reached for instead of guessing", async () => {
    tables.payment_intents = [intent("QB-offline01"), intent("QB-online001")];
    const r = await findPaymentIssues(fake, "sk", { fetchImpl: paystack({ "QB-online001": "success" }, ["QB-offline01"]), now: NOW });
    expect(r.unreachable).toBe(1); expect(r.rows.map((x) => x.reference)).toEqual(["QB-online001"]);
  });
});

describe("settlePayment", () => {
  it("records a payment Paystack says succeeded, grants the purchase, and writes the audit log", async () => {
    tables.payment_intents = [intent("QB-lost0001")];
    const out = await settlePayment(fake, "sk", "staff1", "QB-lost0001", paystack({ "QB-lost0001": "success" }));
    expect(out).toEqual({ state: "confirmed" });
    expect(rpc).toHaveBeenCalledWith("qb_payment_apply_event", expect.objectContaining({ p_reference: "QB-lost0001", p_status: "successful", p_verified: true }));
    expect(rpc).toHaveBeenCalledWith("qb_mk_fulfil_purchase", { p_reference: "QB-lost0001" });
    expect(inserted[0]).toMatchObject({ table: "audit_logs", row: { actor_user_id: "staff1", action: "payment.settle_manual", details: { reference: "QB-lost0001", result: "confirmed" } } });
  });
  it("does not credit anything Paystack does not show as paid", async () => {
    tables.payment_intents = [intent("QB-aband001")];
    expect((await settlePayment(fake, "sk", "staff1", "QB-aband001", paystack({ "QB-aband001": "abandoned" }))).state).toBe("failed");
    tables.payment_intents = [intent("QB-ongoin01")];
    expect((await settlePayment(fake, "sk", "staff1", "QB-ongoin01", paystack({ "QB-ongoin01": "ongoing" }))).state).toBe("pending");
    expect(rpc).not.toHaveBeenCalled();
    expect(inserted.map((i) => i.row.details)).toEqual([{ reference: "QB-aband001", result: "failed", error: null }, { reference: "QB-ongoin01", result: "pending", error: null }]);
  });
  it("grants a purchase that was recorded as paid but never delivered, without crediting again", async () => {
    tables.payment_intents = [intent("QB-nodeliv01", { status: "successful", credited_tx_id: "t1" })];
    expect((await settlePayment(fake, "sk", "staff1", "QB-nodeliv01", paystack({}))).state).toBe("confirmed");
    expect(rpc).toHaveBeenCalledWith("qb_mk_fulfil_purchase", { p_reference: "QB-nodeliv01" });
    expect(rpc).not.toHaveBeenCalledWith("qb_payment_apply_event", expect.anything());
  });
  it("ignores a malformed reference and one that does not exist", async () => {
    expect((await settlePayment(fake, "sk", "staff1", "'; drop", paystack({}))).state).toBe("unknown");
    expect((await settlePayment(fake, "sk", "staff1", "QB-doesnotex1", paystack({}))).state).toBe("unknown");
    expect(rpc).not.toHaveBeenCalled();
  });
});
