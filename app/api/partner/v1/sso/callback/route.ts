import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { finishSignIn } from "@/lib/partner/sso";

// GET /api/partner/v1/sso/callback: the identity provider returns here. Every check (state, signature, issuer, audience, expiry, nonce) happens in lib/partner/oidc.ts before anything is linked.
export const runtime = "nodejs";
export async function GET(req: Request) {
  return finishSignIn(req, { admin: getSupabaseAdminClient() });
}
