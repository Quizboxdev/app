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

export async function processProviderCallback(admin: SupabaseClient, providerCode: string, rawBody: string, headers: Headers): Promise<{ status: number; outcome?: string }> {
  ensureProviders();
  const result = await handlePaymentWebhook(admin, providerCode, rawBody, headers);
  if (result.status !== 200 || !result.reference) return { status: result.status };
  if (result.outcome === "credited" || result.outcome === "already_settled") {
    const { error } = await admin.rpc("qb_fulfil_subscription_payment", { p_reference: result.reference });
    if (error) return { status: 500, outcome: "fulfilment_failed" };                      // 500 makes the provider retry; the retry is safe
    // A Marketplace cart is recorded as a sale (60/40 split, 90 days of access); any other payment is ignored by this function.
    const sale = await admin.rpc("qb_mk_fulfil_purchase", { p_reference: result.reference });
    if (sale.error && !/qb_mk_fulfil_purchase|PGRST202|schema cache/i.test(sale.error.message)) return { status: 500, outcome: "fulfilment_failed" };
  } else if (result.outcome === "refunded" || result.outcome === "reversed" || result.outcome === "insufficient_balance_manual_review") {
    const { error } = await admin.rpc("qb_revoke_subscription_payment", { p_reference: result.reference, p_reason: result.outcome });
    if (error) return { status: 500, outcome: "revocation_failed" };
    const back = await admin.rpc("qb_mk_reverse_purchase", { p_reference: result.reference, p_reason: result.outcome });          // a refunded Marketplace sale ends the buyer's access and takes the teacher's share back
    if (back.error && !/qb_mk_reverse_purchase|PGRST202|schema cache/i.test(back.error.message)) return { status: 500, outcome: "revocation_failed" };
  }
  return { status: 200, outcome: result.outcome };
}
