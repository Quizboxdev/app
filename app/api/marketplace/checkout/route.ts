import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { createPaystackProvider } from "@/lib/payments/paystack";
import { SITE_URL } from "@/lib/site";

// Buy one Marketplace question set. The cart is priced HERE from the database (the browser sends only the set's id), recorded on the payment, and sent to Paystack as the
// payment's metadata, so the merchant account shows exactly what was bought, from which school and by which teacher. When Paystack confirms the payment, the webhook records the sale
// (lib/payments/settlement.ts), splits it 60/40 and opens the buyer's 90 days.
export const runtime = "nodejs";
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
const refuse = (status: number, code: string, error: string, detail = "") => { console.error(`[mk-checkout] ${code}${detail ? ` ${detail}` : ""}`); return json(status, { ok: false, code, error }); };
const CLOSED = "Online payment is not open yet. Please check back soon.";
const MESSAGES: Record<string, string> = {
  QB_FEATURE_DISABLED: "The Marketplace is not open yet.", QB_NOT_FOUND: "That question set is not on sale.", QB_OWN_ITEM: "This is your own question set.",
  QB_ALREADY_OWNED: "You already have this set. Open it from My question sets.", QB_MINOR_CANNOT_PAY: "Please ask your teacher or a parent to buy this for you.", QB_AUTHENTICATION_REQUIRED: "Please sign in.",
  QB_SELF_PAY_DISABLED: CLOSED, QB_PROVIDER_NOT_ENABLED: CLOSED, QB_PRICING_NOT_CONFIGURED: CLOSED, QB_BELOW_MINIMUM_CHARGE: "The smallest online payment is GHS 5.",
};
type Cart = { item_id: string; title: string; subject: string; school: string; grade: string; seller: string; seller_id: string; price_minor: number };

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, error: "Please sign in." });
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return refuse(503, "NO_PROVIDER_KEY", CLOSED);
  let body: { itemId?: unknown };
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)) return json(400, { ok: false, error: "Invalid request." });

  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoError } = await client.auth.getUser(authorization.slice(7));
  if (whoError || !who.user?.email) return json(401, { ok: false, error: "Please sign in." });

  // The database says whether this person may buy this set and what it costs: not your own set, not a child, not a set you still have, only a set that is on sale.
  const prepared = await client.rpc("qb_mk_prepare_purchase", { p_item: itemId });
  if (prepared.error) {
    const code = /(QB_[A-Z_]+)/.exec(prepared.error.message)?.[1] ?? "";
    return refuse(code === "QB_NOT_FOUND" ? 404 : 403, code || "PREPARE_FAILED", MESSAGES[code] ?? "We could not start the payment. Please try again.", code ? "" : prepared.error.message.slice(0, 120));
  }
  const cart = prepared.data as Cart;
  const catalog = await client.rpc("qb_subscription_catalog");
  const unit = Number((catalog.data as { unit_price_minor?: number } | null)?.unit_price_minor ?? 0);
  if (catalog.error || !unit) return refuse(503, "QB_PRICING_NOT_CONFIGURED", CLOSED, catalog.error ? catalog.error.message.slice(0, 120) : "");
  const price = Number(cart.price_minor);
  if (!Number.isSafeInteger(price) || price % unit !== 0 || price / unit < 5) return refuse(400, "PRICE_NOT_WHOLE_COINS", "This set cannot be bought online right now. Please contact support.", `price=${price} unit=${unit}`);
  const coins = price / unit;

  // One payment per buyer, set and ten minutes: a double click returns the same payment instead of charging twice.
  const idem = `mk-${itemId}-${Math.floor(Date.now() / 600000)}`;
  const created = await client.rpc("qb_payment_intent_create", { p_beneficiary: who.user.id, p_coins: coins, p_currency: "GHS", p_provider: "paystack", p_method: "mobile_money", p_idem: idem });
  if (created.error) {
    const code = /(QB_[A-Z_]+)/.exec(created.error.message)?.[1] ?? "";
    return refuse(code in MESSAGES ? 403 : 400, code || "INTENT_FAILED", MESSAGES[code] ?? "We could not start the payment. Please try again.", code ? "" : created.error.message.slice(0, 120));
  }
  const intent = created.data as { reference: string; amount_minor: number };
  if (Number(intent.amount_minor) !== price) return refuse(500, "PRICE_MISMATCH", "We could not start the payment. Please try again.", `db=${intent.amount_minor} route=${price}`);
  try {
    const marked = await getSupabaseAdminClient().rpc("qb_mk_set_payment_item", { p_reference: intent.reference, p_item: cart.item_id, p_price_minor: price });
    if (marked.error) return refuse(409, "CART_NOT_RECORDED", "We could not start the payment. Please try again.", marked.error.message.slice(0, 120));
    const origin = new URL(SITE_URL).origin;
    // What the merchant account shows for this payment: the set, its source (subject, school, class) and the teacher.
    const metadata = { purpose: "marketplace", item_id: cart.item_id, item_title: cart.title, subject: cart.subject, school: cart.school, grade: cart.grade, seller: cart.seller, seller_id: cart.seller_id, price_minor: price,
      custom_fields: [{ display_name: "Question set", variable_name: "item", value: cart.title }, { display_name: "Source", variable_name: "source", value: `${cart.subject} · ${cart.school}` }, { display_name: "Class", variable_name: "grade", value: cart.grade }, { display_name: "Teacher", variable_name: "seller", value: cart.seller }] };
    const started = await createPaystackProvider(key).initialize({ email: who.user.email, amountMinor: price, currency: "GHS", reference: intent.reference, callbackUrl: `${origin}/marketplace/mine?reference=${encodeURIComponent(intent.reference)}`, metadata });
    return json(200, { ok: true, url: started.url, reference: intent.reference });
  } catch (e) {
    return refuse(502, "PROVIDER_UNAVAILABLE", "The payment service is not available right now. Please try again in a few minutes.", e instanceof Error ? e.message.slice(0, 160) : "");
  }
}
