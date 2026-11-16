import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyVerifiedPaymentEvent } from "@/lib/core/payments";
import { fulfilAfter } from "./settlement";
import { confirmPayment } from "./confirm";

// A family order (reference QBF-...) is settled by its own database function; a normal payment (QB-...) is untouched.
const fakeAdmin = (calls: Array<[string, Record<string, unknown>]>, data: unknown = { outcome: "credited" }, tables: Record<string, unknown> = {}) => ({
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return { data, error: null }; }),
  from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tables[table] ?? null, error: null }) }) }) }),
}) as unknown as SupabaseClient;
const event = (reference: string) => ({ provider: "paystack", eventId: "charge.success:1", reference, status: "successful" as const, providerReference: "1", amountMinor: 3000, currency: "GHS" });

describe("family orders in the payment path", () => {
  it("a verified event for an order reference goes to the order settlement, with the amount and currency", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    expect(await applyVerifiedPaymentEvent(fakeAdmin(calls), event("QBF-abcdef0123456789"))).toEqual({ outcome: "credited" });
    expect(calls[0][0]).toBe("qb_family_order_apply");
    expect(calls[0][1]).toMatchObject({ p_reference: "QBF-abcdef0123456789", p_amount_minor: 3000, p_currency: "GHS", p_event_id: "charge.success:1" });
  });
  it("a normal payment still uses the single-payment function", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    await applyVerifiedPaymentEvent(fakeAdmin(calls), event("QB-abcdef0123456789"));
    expect(calls[0][0]).toBe("qb_payment_apply_event");
  });
  it("a settled order is fulfilled through the order function, a refunded one revoked, and a failed one left alone", async () => {
    for (const [outcome, fn] of [["credited", "qb_family_order_fulfil"], ["already_settled", "qb_family_order_fulfil"], ["duplicate_event", "qb_family_order_fulfil"], ["refunded", "qb_family_order_revoke"]] as const) {
      const calls: Array<[string, Record<string, unknown>]> = [];
      expect(await fulfilAfter(fakeAdmin(calls), outcome, "QBF-abcdef0123456789")).toEqual({ ok: true });
      expect(calls.map((c) => c[0])).toEqual([fn]);
    }
    const none: Array<[string, Record<string, unknown>]> = [];
    expect(await fulfilAfter(fakeAdmin(none), "amount_mismatch", "QBF-abcdef0123456789")).toEqual({ ok: true }); expect(none).toEqual([]);
  });
  it("only the parent who made an order can confirm it", async () => {
    const mine = { family_orders: { parent_user_id: "p1", status: "paid" } };
    const calls: Array<[string, Record<string, unknown>]> = [];
    expect(await confirmPayment(fakeAdmin(calls, { outcome: "fulfilled" }, mine), "sk", "p1", "QBF-abcdef0123456789")).toEqual({ state: "confirmed" });
    expect((await confirmPayment(fakeAdmin([], {}, mine), "sk", "someone-else", "QBF-abcdef0123456789")).state).toBe("unknown");
    expect((await confirmPayment(fakeAdmin([], {}, {}), "sk", "p1", "QBF-abcdef0123456789")).state).toBe("unknown");
  });
});
