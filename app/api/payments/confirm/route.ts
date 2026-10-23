import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { confirmPayment } from "@/lib/payments/confirm";

// Called by the page a buyer returns to after paying. It asks Paystack how the payment ended (the browser's claim is not trusted) and settles it if the webhook has not already.
export const runtime = "nodejs";
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return json(401, { ok: false, error: "Please sign in." });
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) return json(503, { ok: false, state: "pending" });
  let body: { reference?: unknown };
  try { body = await request.json(); } catch { return json(400, { ok: false, error: "Invalid request." }); }
  const reference = typeof body.reference === "string" ? body.reference : "";
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !who.user) return json(401, { ok: false, error: "Please sign in." });
  const result = await confirmPayment(getSupabaseAdminClient(), key, who.user.id, reference);
  if (result.error) console.error(`[payment-confirm] ${result.error} ${reference.slice(0, 12)}`);
  return json(200, { ok: true, state: result.state });
}
