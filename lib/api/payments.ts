import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

// Subscription payments from the browser. Money is never handled here: checkout asks the server for a payment page address, and the provider
// confirms the payment to the server separately. The owner's switches use the existing guarded settings function.
export type Catalog = { payments_enabled: boolean; currency: string; unit_price_minor: number | null; providers: string[] };
export async function getCatalog(): Promise<Catalog | null> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_subscription_catalog");
  return error ? null : (data as Catalog);
}

export async function startCheckout(planId: string): Promise<{ url: string }> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in to subscribe.");
  const res = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ planId }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.url) throw Object.assign(new Error(typeof body?.error === "string" ? body.error : "We could not start the payment. Please try again."), { code: typeof body?.code === "string" ? body.code : "" });
  return { url: String(body.url) };
}

// Buy Coins on their own (for example to pay for seats on a quiz). The server works out the price; the buyer comes back to their quiz page afterwards.
export async function startTopup(coins: number, returnTo: string): Promise<{ url: string }> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in to buy Coins.");
  const res = await fetch("/api/payments/checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ coins, returnTo }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.url) throw Object.assign(new Error(typeof body?.error === "string" ? body.error : "We could not start the payment. Please try again."), { code: typeof body?.code === "string" ? body.code : "" });
  return { url: String(body.url) };
}

// Back from the payment page: ask the server to check with Paystack how the payment ended, in case the webhook has not arrived. Safe to call more than once; it never throws.
export async function confirmReturn(reference: string): Promise<"confirmed" | "pending" | "failed" | "unknown"> {
  try {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return "unknown";
    const res = await fetch("/api/payments/confirm", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ reference }) });
    const body = await res.json().catch(() => ({}));
    return ["confirmed", "pending", "failed", "unknown"].includes(body?.state) ? body.state : "pending";
  } catch { return "pending"; }
}

export type PaymentRow = { reference: string; status: string; provider: string; method: string; amount_minor: number; currency: string; coins: number; plan: string | null;
  reconciliation: string; learner: string; created_at: string; settled_at: string | null };
export async function listPayments(limit = 50): Promise<PaymentRow[]> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_admin_payments", { p_limit: limit });
  if (error) throw new Error(userFacingError(error));
  return (data ?? []) as PaymentRow[];
}

const setting = async (key: string, value: unknown) => {
  const { error } = await getSupabaseBrowserClient().rpc("qb_setting_set", { p_key: key, p_value: value });
  if (error) throw new Error(userFacingError(error));
};
export const setPaymentsOpen = async (open: boolean) => { await setting("flags.buy_coins_enabled", open); await setting("flags.student_self_pay", open); await setting("payments.providers", open ? ["paystack"] : []); };
// Owner switch for seat limits on challenges and competitions (migration 20261041100000). Off means no quiz has a limit.
export async function getPaidChallenges(): Promise<boolean> {
  const { data } = await getSupabaseBrowserClient().from("platform_settings").select("value").eq("key", "flags.paid_challenges").eq("scope_type", "global").maybeSingle();
  return (data as { value?: unknown } | null)?.value === true;
}
export const setPaidChallenges = (on: boolean) => setting("flags.paid_challenges", on);
export const setCoinUnitPrice = (pesewas: number) => setting("coins.unit_price_minor", { GHS: pesewas });
