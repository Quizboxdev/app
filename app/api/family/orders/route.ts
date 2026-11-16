import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { resolveSellablePlan } from "@/lib/payments/plans";
import { createPaystackProvider } from "@/lib/payments/paystack";
import { returnOrigin } from "@/lib/site";

// A parent pays once for the children they ticked: Coins for each, or a subscription plan for each (the plan can differ child by child). The caller's own session creates the order, so the
// database checks the parent's permission for every child. Plans and prices are computed here from the admin price list and the unit price, never taken from the browser, and the total the
// database returns must equal ours. Coins and subscriptions are granted only after the signed Paystack webhook (or a server-to-server check) confirms the charge.
export const runtime = "nodejs";
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refuse = (status: number, code: string, error: string, detail = "") => { console.error(`[family-order] ${code}${detail ? ` ${detail}` : ""}`); return json(status, { ok: false, code, error }); };
const MESSAGES: Record<string, string> = {
  QB_FEATURE_DISABLED: "Online payment is not open yet. Please check back soon.", QB_PROVIDER_NOT_ENABLED: "Online payment is not open yet. Please check back soon.", QB_PRICING_NOT_CONFIGURED: "Online payment is not open yet. Please check back soon.",
  QB_BELOW_MINIMUM_CHARGE: "The smallest online payment for one child is GHS 5 (5 Coins). Choose a larger amount.", QB_FUNDING_NOT_PERMITTED: "You are not allowed to pay for one of those children.", QB_FAMILY_FORBIDDEN: "You can only buy for your own children.",
  QB_INVALID_BENEFICIARY: "One of those accounts cannot receive a payment.",
};
type Item = { studentId: string; coins?: number; planId?: string };

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, error: "Please sign in." });
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return refuse(503, "NO_PROVIDER_KEY", MESSAGES.QB_FEATURE_DISABLED);
  let body: { kind?: unknown; items?: unknown; idempotencyKey?: unknown };
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const kind = body.kind === "coins" || body.kind === "subscription" ? body.kind : null;
  const raw = Array.isArray(body.items) ? (body.items as Item[]) : null;
  if (!kind || !raw || raw.length < 1 || raw.length > 10) return json(400, { ok: false, error: "Tick at least one child." });
  if (raw.some((i) => !i || typeof i.studentId !== "string" || !/^[0-9a-f-]{36}$/i.test(i.studentId))) return json(400, { ok: false, error: "Invalid request." });

  const svc = getSupabaseAdminClient();
  const priceRows = kind === "subscription" ? await svc.rpc("qb_price_list").then((r) => r.data, () => null) : null;
  const resolved: Array<{ studentId: string; coins: number; plan?: { id: string; days: number } }> = [];
  for (const item of raw) {
    if (kind === "coins") {
      const coins = Number(item.coins);
      if (!Number.isSafeInteger(coins) || coins < 5 || coins > 1000) return refuse(400, "INVALID_COINS", "Choose a whole number of Coins from 5 to 1000 for each child.");
      resolved.push({ studentId: item.studentId, coins });
    } else {
      const plan = resolveSellablePlan(String(item.planId ?? ""), priceRows);
      if (!plan) return refuse(400, "PLAN_NOT_SOLD", "One of those plans is not sold online. Please choose another.", `plan=${String(item.planId ?? "").slice(0, 60)}`);
      resolved.push({ studentId: item.studentId, coins: plan.coins, plan: { id: plan.id, days: plan.days } });
    }
  }

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoError } = await client.auth.getUser(authorization.slice(7));
  if (whoError || !who.user?.email) return json(401, { ok: false, error: "Please sign in." });
  const catalog = await client.rpc("qb_subscription_catalog");
  const unit = Number((catalog.data as { unit_price_minor?: number } | null)?.unit_price_minor ?? 0);
  if (catalog.error || !(unit > 0)) return refuse(503, "QB_PRICING_NOT_CONFIGURED", MESSAGES.QB_PRICING_NOT_CONFIGURED);
  const expected = resolved.reduce((n, r) => n + r.coins * unit, 0);

  const idem = typeof body.idempotencyKey === "string" && body.idempotencyKey.length >= 8 && body.idempotencyKey.length <= 120 ? body.idempotencyKey : `fam-${randomUUID()}`;
  const created = await client.rpc("qb_family_order_create", { p_kind: kind, p_items: resolved.map((r) => ({ student_id: r.studentId, coins: r.coins })), p_idem: idem });
  if (created.error) {
    const code = /(QB_[A-Z_]+)/.exec(created.error.message)?.[1] ?? "";
    return refuse(code in MESSAGES ? 403 : 400, code || "ORDER_FAILED", MESSAGES[code] ?? "We could not start the payment. Please try again.", code ? "" : created.error.message.slice(0, 120));
  }
  const order = created.data as { reference: string; total_minor: number; items: Array<{ student_id: string; reference: string }> };
  if (Number(order.total_minor) !== expected) return refuse(500, "PRICE_MISMATCH", "We could not start the payment. Please try again.", `db=${order.total_minor} route=${expected}`);
  try {
    if (kind === "subscription") {
      for (const r of resolved) {
        const line = order.items.find((i) => i.student_id === r.studentId);
        if (!line || !r.plan) return refuse(500, "ORDER_ITEM_MISSING", "We could not start the payment. Please try again.");
        const set = await svc.rpc("qb_set_payment_plan", { p_reference: line.reference, p_plan: r.plan.id, p_days: r.plan.days });
        if (set.error) return refuse(500, "PLAN_NOT_SET", "We could not start the payment. Please try again.", set.error.message.slice(0, 100));
      }
    }
    const origin = returnOrigin(request.url);
    const started = await createPaystackProvider(key).initialize({ email: who.user.email, amountMinor: expected, currency: "GHS", reference: order.reference,
      callbackUrl: `${origin}/family/pay?reference=${encodeURIComponent(order.reference)}`, metadata: { family_order: kind } });
    return json(200, { ok: true, url: started.url, reference: order.reference });
  } catch (e) {
    return refuse(502, "PROVIDER_UNAVAILABLE", "The payment service is not available right now. Please try again in a few minutes.", e instanceof Error ? e.message.slice(0, 160) : "");
  }
}
