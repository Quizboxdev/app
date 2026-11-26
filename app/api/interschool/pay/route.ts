import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createPaystackProvider } from "@/lib/payments/paystack";
import { returnOrigin } from "@/lib/site";
import { plain, codeOf } from "@/lib/interschool/text";

// Starts paying one sponsorship invoice. The caller's own session token is used, so the database decides who may pay which invoice and what the amount is;
// the browser sends only the invoice id. Money is credited only when Paystack's own answer is verified (webhook or the return page).
export const runtime = "nodejs";
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, error: "Please sign in." });
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return json(503, { ok: false, code: "NO_PROVIDER_KEY", error: "Online payment is not open yet. Please check back soon." });
  let body: { invoiceId?: unknown };
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const invoiceId = String(body.invoiceId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return json(400, { ok: false, error: "Invalid request." });
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoError } = await client.auth.getUser(authorization.slice(7));
  if (whoError || !who.user?.email) return json(401, { ok: false, error: "Please sign in." });
  const started = await client.rpc("interschool_payment_start", { p_invoice: invoiceId });
  if (started.error) { console.error(`[interschool-pay] ${codeOf(started.error.message) || "START_FAILED"}`); return json(codeOf(started.error.message) ? 403 : 400, { ok: false, code: codeOf(started.error.message), error: plain(started.error.message) }); }
  const attempt = started.data as { reference: string; amount_minor: number; currency: string; invoice: string };
  try {
    const opened = await createPaystackProvider(key).initialize({ email: who.user.email, amountMinor: Number(attempt.amount_minor), currency: attempt.currency, reference: attempt.reference,
      callbackUrl: `${returnOrigin(request.url)}/interschool/sponsor?reference=${encodeURIComponent(attempt.reference)}`, metadata: { invoice: attempt.invoice } });
    return json(200, { ok: true, url: opened.url, reference: attempt.reference });
  } catch (e) {
    console.error(`[interschool-pay] PROVIDER_UNAVAILABLE ${e instanceof Error ? e.message.slice(0, 160) : ""}`);
    return json(502, { ok: false, code: "PROVIDER_UNAVAILABLE", error: "The payment service is not available right now. Please try again in a few minutes." });
  }
}
