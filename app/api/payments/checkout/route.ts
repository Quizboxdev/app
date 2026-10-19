import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { findPlan, isOnlinePlan, planPriceMinor } from "@/lib/payments/plans";
import { createPaystackProvider } from "@/lib/payments/paystack";
import { SITE_URL } from "@/lib/site";

// Start a subscription payment. The caller's own session token (Authorization: Bearer) is used for the intent, so the database applies its rules:
// payments must be switched on, the provider enabled, a unit price set, and a payer may fund another learner only with permission.
// The price is computed here from the plan's Coins and the unit price in the database, never taken from the browser.
export const runtime = "nodejs";
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MESSAGES: Record<string, string> = {
  QB_FEATURE_DISABLED: "Online payment is not open yet. Please check back soon.", QB_SELF_PAY_DISABLED: "Online payment is not open yet. Please check back soon.",
  QB_PROVIDER_NOT_ENABLED: "Online payment is not open yet. Please check back soon.", QB_PRICING_NOT_CONFIGURED: "Online payment is not open yet. Please check back soon.",
  QB_FUNDING_NOT_PERMITTED: "You are not allowed to pay for that account.", QB_INVALID_BENEFICIARY: "That account cannot receive a subscription.",
};

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, error: "Please sign in." });
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return json(503, { ok: false, error: "Online payment is not open yet. Please check back soon." });
  let body: { planId?: unknown; beneficiary?: unknown; idempotencyKey?: unknown };
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const plan = findPlan(String(body.planId ?? ""));
  if (!isOnlinePlan(plan)) return json(400, { ok: false, error: "That plan is not sold online. Please contact us." });
  const beneficiaryIn = body.beneficiary === undefined ? null : String(body.beneficiary);
  if (beneficiaryIn !== null && !/^[0-9a-f-]{36}$/i.test(beneficiaryIn)) return json(400, { ok: false, error: "Invalid request." });

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoError } = await client.auth.getUser(authorization.slice(7));
  if (whoError || !who.user?.email) return json(401, { ok: false, error: "Please sign in." });

  // Children under 13 with a teacher-managed account never pay online: their school or guardian arranges a subscription.
  const minor = await client.from("student_profiles").select("is_minor").eq("user_id", who.user.id).maybeSingle();
  if ((minor.data as { is_minor?: boolean } | null)?.is_minor) return json(403, { ok: false, error: "Please ask your teacher or a parent to arrange your subscription." });

  const catalog = await client.rpc("qb_subscription_catalog");
  const unit = Number((catalog.data as { unit_price_minor?: number } | null)?.unit_price_minor ?? 0);
  const price = planPriceMinor(plan, unit);
  if (catalog.error || !price) return json(503, { ok: false, error: MESSAGES.QB_PRICING_NOT_CONFIGURED });

  const idem = typeof body.idempotencyKey === "string" && body.idempotencyKey.length >= 8 && body.idempotencyKey.length <= 120 ? body.idempotencyKey : `sub-${randomUUID()}`;
  const created = await client.rpc("qb_payment_intent_create", { p_beneficiary: beneficiaryIn ?? who.user.id, p_coins: plan.coins, p_currency: "GHS", p_provider: "paystack", p_method: "mobile_money", p_idem: idem });
  if (created.error) {
    const code = /(QB_[A-Z_]+)/.exec(created.error.message)?.[1] ?? "";
    return json(code in MESSAGES ? 403 : 400, { ok: false, error: MESSAGES[code] ?? "We could not start the payment. Please try again." });
  }
  const intent = created.data as { reference: string; amount_minor: number };
  if (Number(intent.amount_minor) !== price) return json(500, { ok: false, error: "We could not start the payment. Please try again." });      // the database and this route must agree on the price
  try {
    await getSupabaseAdminClient().rpc("qb_set_payment_plan", { p_reference: intent.reference, p_plan: plan.id, p_days: plan.days });
    const origin = new URL(SITE_URL).origin;
    const started = await createPaystackProvider(key).initialize({ email: who.user.email, amountMinor: price, currency: "GHS", reference: intent.reference,
      callbackUrl: `${origin}/subscribe?reference=${encodeURIComponent(intent.reference)}`, metadata: { plan: plan.id } });
    return json(200, { ok: true, url: started.url, reference: intent.reference });
  } catch {
    return json(502, { ok: false, error: "The payment service is not available right now. Please try again in a few minutes." });
  }
}
