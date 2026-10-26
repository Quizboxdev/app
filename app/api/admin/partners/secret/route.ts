import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { encryptSecret, randomToken } from "@/lib/partner/crypto";
import { UUID } from "@/lib/partner/http";

// POST /api/admin/partners/secret: encrypts a webhook secret or an OIDC client secret with the server key and stores the CIPHERTEXT through the database function, called AS the signed-in person
// (their own token), so the database still decides whether they are a super admin. A new webhook secret is returned once, here, and never again.
export const runtime = "nodejs";
const out = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(auth)) return out(401, { error: "Sign in again." });
  let body: any;
  try { body = await req.json(); } catch { return out(400, { error: "Invalid request." }); }
  if (typeof body?.partner_id !== "string" || !UUID.test(body.partner_id)) return out(400, { error: "Invalid request." });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return out(503, { error: "Not available." });
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (body.kind === "webhook") {
      const secret = `whsec_${randomToken(32)}`;
      const { error } = await user.rpc("qb_admin_partner_webhook_secret_rotate", { p_partner: body.partner_id, p_secret_enc: encryptSecret(secret) });
      if (error) return out(/NOT_AUTHORIZED|AUTHENTICATION/.test(error.message) ? 403 : 422, { error: /NOT_VERIFIED/.test(error.message) ? "The partner must be verified first." : "Not allowed." });
      return out(200, { secret });
    }
    if (body.kind === "oidc") {
      const secret = typeof body.client_secret === "string" && body.client_secret.trim() ? body.client_secret.trim() : null;
      if (secret && secret.length > 500) return out(400, { error: "Invalid request." });
      const { error } = await user.rpc("qb_admin_partner_oidc_endpoints_save", { p_partner: body.partner_id, p_authorization: body.authorization_endpoint ?? "", p_token: body.token_endpoint ?? "", p_client_secret_enc: secret ? encryptSecret(secret) : null });
      if (error) return out(/NOT_AUTHORIZED|AUTHENTICATION/.test(error.message) ? 403 : 422, { error: /https|check/.test(error.message) ? "Addresses must start with https://." : /NOT_CONFIGURED/.test(error.message) ? "Save the identity settings first." : "Not allowed." });
      return out(200, { ok: true });
    }
    return out(400, { error: "Invalid request." });
  } catch { return out(503, { error: "The server key is not configured." }); }
}
