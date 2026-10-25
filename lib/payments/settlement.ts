import type { SupabaseClient } from "@supabase/supabase-js";
import { handlePaymentWebhook, registerPaymentProvider } from "@/lib/core/payments";
import { registerConfiguredProviders } from "./paystack";

// What happens after a provider callback is verified and applied to the ledger: a paid subscription is granted, a paid Marketplace set is recorded as a sale, a refund ends either.
// Settlement is idempotent end to end (the ledger ignores duplicate events; the database functions ignore a repeated fulfilment), so a provider
// that retries the callback can never grant or revoke twice.
let registered = false;
export const ensureProviders = (): string[] => {
  if (registered) return ["paystack"].filter(() => !!process.env.PAYSTACK_SECRET_KEY);
  const active = registerConfiguredProviders(registerPaymentProvider);
  registered = active.length > 0;
  return active;
};

// After a payment event is applied to the ledger: grant what was bought, or take it back after a refund. Every step is idempotent, so it is safe to run again for a repeated or retried event:
// a "duplicate_event" is treated like a settled one, because the first delivery may have recorded the event and then failed before fulfilling (a database error makes us answer 500 and the provider retries).
// A database that has not had the affiliate migration yet answers "function not found". That must never stop a customer's payment from being fulfilled, so the commission step is skipped (and runs on the next retry or Payment check once the migration is in).
const functionMissing = (error: { code?: string; message?: string } | null | undefined) => !!error && (error.code === "PGRST202" || error.code === "42883" || /could not find the function|does not exist/i.test(error.message ?? ""));

export async function fulfilAfter(admin: SupabaseClient, outcome: string | undefined, reference: string): Promise<{ ok: boolean; failure?: string }> {
  if (outcome === "credited" || outcome === "already_settled" || outcome === "duplicate_event") {
    const { error } = await admin.rpc("qb_fulfil_subscription_payment", { p_reference: reference });
    if (error) return { ok: false, failure: "fulfilment_failed" };
    // A Marketplace cart is recorded as a sale (60/40 split, 90 days of access); any other payment is ignored by this function.
    const sale = await admin.rpc("qb_mk_fulfil_purchase", { p_reference: reference });
    if (sale.error) return { ok: false, failure: "fulfilment_failed" };
    // A paid subscription by a referred customer accrues the affiliate's commission (held, then approved). It answers "programme_off" or "no_attribution" for everything else.
    const commission = await admin.rpc("qb_commission_accrue", { p_reference: reference });
    if (commission.error && !functionMissing(commission.error)) return { ok: false, failure: "commission_failed" };
  } else if (outcome === "refunded" || outcome === "reversed" || outcome === "insufficient_balance_manual_review") {
    const { error } = await admin.rpc("qb_revoke_subscription_payment", { p_reference: reference, p_reason: outcome });
    if (error) return { ok: false, failure: "revocation_failed" };
    const back = await admin.rpc("qb_mk_reverse_purchase", { p_reference: reference, p_reason: outcome });          // a refunded Marketplace sale ends the buyer's access and takes the teacher's share back
    if (back.error) return { ok: false, failure: "revocation_failed" };
    const undo = await admin.rpc("qb_commission_reverse", { p_reference: reference, p_reason: outcome });            // a refunded referred payment takes the affiliate's commission back with an explicit ledger row
    if (undo.error && !functionMissing(undo.error)) return { ok: false, failure: "revocation_failed" };
  }
  return { ok: true };
}

export async function processProviderCallback(admin: SupabaseClient, providerCode: string, rawBody: string, headers: Headers): Promise<{ status: number; outcome?: string }> {
  ensureProviders();
  const result = await handlePaymentWebhook(admin, providerCode, rawBody, headers);
  if (result.status !== 200 || !result.reference) return { status: result.status };
  const done = await fulfilAfter(admin, result.outcome, result.reference);
  if (!done.ok) return { status: 500, outcome: done.failure };                                  // 500 makes the provider retry; the retry is safe
  return { status: 200, outcome: result.outcome };
}
