import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { startSignIn } from "@/lib/partner/sso";

// GET /api/partner/v1/sso/{slug}/start: sends the browser to the partner's identity provider (authorization code + PKCE, state and nonce kept in a signed, short-lived, HttpOnly cookie).
export const runtime = "nodejs";
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  return startSignIn(slug, req, { admin: getSupabaseAdminClient() });
}
