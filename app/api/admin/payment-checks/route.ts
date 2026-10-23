import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { findPaymentIssues, settlePayment } from "@/lib/payments/reconcile";

// Payment checks for finance staff. The caller must be a finance admin or the owner: that is checked by the database (qb_admin_payments refuses anyone else) before anything else happens.
// "check" asks Paystack about recent open payments and finds paid-but-undelivered ones; "settle" records one payment and grants what was bought, the same idempotent way the webhook does.
export const runtime = "nodejs";
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, error: "Please sign in." });
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return json(503, { ok: false, error: "Online payment is not set up on this site." });
  let body: { action?: unknown; reference?: unknown; days?: unknown };
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoError } = await client.auth.getUser(authorization.slice(7));
  if (whoError || !who.user) return json(401, { ok: false, error: "Please sign in." });
  const gate = await client.rpc("qb_admin_payments", { p_limit: 1 });
  if (gate.error) return json(403, { ok: false, error: "Only finance staff can check payments." });

  const admin = getSupabaseAdminClient();
  if (body.action === "check") {
    const days = Number.isInteger(body.days) && Number(body.days) >= 1 && Number(body.days) <= 60 ? Number(body.days) : 14;
    return json(200, { ok: true, ...(await findPaymentIssues(admin, key, { days })) });
  }
  if (body.action === "settle") {
    const reference = typeof body.reference === "string" ? body.reference : "";
    if (!/^QB-[A-Za-z0-9]{8,64}$/.test(reference)) return json(400, { ok: false, error: "Invalid payment reference." });
    const result = await settlePayment(admin, key, who.user.id, reference);
    if (result.error) console.error(`[payment-settle] ${result.error} ${reference.slice(0, 12)}`);
    return json(200, { ok: result.state === "confirmed", state: result.state, error: result.state === "confirmed" ? undefined : result.state === "pending" ? "Paystack has not confirmed this payment yet, or recording it failed. Try again in a minute." : result.state === "failed" ? "Paystack does not show this payment as paid." : "That payment was not found." });
  }
  return json(400, { ok: false, error: "Invalid request." });
}
