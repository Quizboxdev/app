import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { SITE_URL } from "@/lib/site";
import { clientHash, withinLimit } from "./api-auth";
import { decryptSecret, safeEqual, secretsKey, signCookie, verifyCookie } from "./crypto";
import { OidcError, buildAuthorizationUrl, emailVerified, exchangeCode, pkcePair, randomState, verifyIdToken, type FetchLike, type OidcConfig } from "./oidc";
import { mapDbError } from "./errors";

// Partner sign-in (OpenID Connect). QuizBox never sees the person's partner password. The browser goes to the partner's identity provider and comes back with a one-time code; this server exchanges it
// (PKCE), verifies the signed ID token, then finds or links the QuizBox account and hands over to the normal QuizBox sign-in (a single-use Supabase link), so sessions, profiles and RLS work as for any user.
type Admin = ReturnType<typeof getSupabaseAdminClient>;
export type SsoDeps = { admin: Admin; fetchImpl?: FetchLike; key?: Buffer; nowSeconds?: number; fetchJwks?: (u: string) => Promise<any[]>; origin?: string };
export const COOKIE = "qb_psso";
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/;
const origin = (d: SsoDeps) => (d.origin ?? process.env.PARTNER_SSO_ORIGIN ?? SITE_URL).replace(/\/+$/, "");
export const redirectUri = (d: SsoDeps) => `${origin(d)}/api/partner/v1/sso/callback`;

const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store", ...headers } });
const cookieHeader = (value: string, maxAge: number, d: SsoDeps) =>
  `${COOKIE}=${value}; Path=/api/partner/v1/sso; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${origin(d).startsWith("https://") ? "; Secure" : ""}`;
const fail = (slug: string | null, code: string, d: SsoDeps) => redirect(`${origin(d)}${slug && SLUG.test(slug) ? `/partner/${slug}` : "/login"}?error=${encodeURIComponent(code)}`, { "Set-Cookie": cookieHeader("", 0, d) });

async function loadConfig(admin: Admin, slug: string): Promise<OidcConfig | null> {
  const { data, error } = await admin.rpc("qb_partner_oidc_config", { p_slug: slug });
  if (error || !data) return null;
  return data as OidcConfig;
}

export async function startSignIn(slug: string, req: Request, d: SsoDeps): Promise<Response> {
  if (!SLUG.test(slug)) return fail(null, "PARTNER_SSO_UNAVAILABLE", d);
  try {
    if (!(await withinLimit(d.admin, `ip:${clientHash(req)}:sso`, 30, 60))) return fail(slug, "PARTNER_RATE_LIMITED", d);
    const cfg = await loadConfig(d.admin, slug);
    if (!cfg) return fail(slug, "PARTNER_SSO_UNAVAILABLE", d);
    const { verifier, challenge } = pkcePair(), state = randomState(), nonce = randomState();
    const cookie = signCookie({ slug, state, nonce, verifier, exp: Math.floor(Date.now() / 1000) + 600 }, d.key ?? secretsKey());
    return redirect(buildAuthorizationUrl(cfg, { redirectUri: redirectUri(d), state, nonce, challenge }), { "Set-Cookie": cookieHeader(cookie, 600, d) });
  } catch { return fail(slug, "PARTNER_SSO_UNAVAILABLE", d); }
}

const readCookie = (req: Request) => (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

export async function finishSignIn(req: Request, d: SsoDeps): Promise<Response> {
  let slug: string | null = null;
  try {
    const url = new URL(req.url);
    const c = verifyCookie<{ slug: string; state: string; nonce: string; verifier: string; exp: number }>(readCookie(req), d.key ?? secretsKey());
    slug = c?.slug ?? null;
    if (!c || c.exp < (d.nowSeconds ?? Math.floor(Date.now() / 1000))) return fail(slug, "PARTNER_SSO_EXPIRED", d);
    if (!(await withinLimit(d.admin, `ip:${clientHash(req)}:sso`, 30, 60))) return fail(slug, "PARTNER_RATE_LIMITED", d);
    const state = url.searchParams.get("state"), code = url.searchParams.get("code");
    if (!state || !safeEqual(state, c.state)) return fail(slug, "PARTNER_SSO_STATE_INVALID", d);          // CSRF and replay: the state must be the one we issued to this browser
    if (url.searchParams.get("error") || !code || code.length > 2000) return fail(slug, "PARTNER_SSO_DENIED", d);
    const cfg = await loadConfig(d.admin, c.slug);
    if (!cfg) return fail(slug, "PARTNER_SSO_UNAVAILABLE", d);

    const secret = cfg.client_secret_enc ? decryptSecret(cfg.client_secret_enc, d.key ?? secretsKey()) : undefined;
    const idToken = await exchangeCode(cfg, { code, verifier: c.verifier, redirectUri: redirectUri(d), clientSecret: secret }, d.fetchImpl);
    const claims = await verifyIdToken(idToken, cfg, { nonce: c.nonce, nowSeconds: d.nowSeconds, fetchJwks: d.fetchJwks });
    const email = typeof claims.email === "string" ? claims.email.toLowerCase().trim() : null, verified = emailVerified(claims);

    const found = await d.admin.rpc("qb_partner_sso_find_account", { p_partner: cfg.partner_id, p_issuer: cfg.issuer, p_subject: claims.sub, p_email: email, p_email_verified: verified });
    if (found.error) return fail(slug, "PARTNER_SSO_FAILED", d);
    if (found.data?.via === "revoked") return fail(slug, "PARTNER_MEMBER_REVOKED", d);
    let userId: string | null = found.data?.user_id ?? null;

    if (!userId) {
      // No account yet. Provision only when staff enabled it for this partner, the address is verified and inside the partner's approved domain, and the partner supplied a grade. Never a staff role.
      const domain = email?.split("@")[1] ?? "";
      const grade = typeof claims.grade === "string" ? claims.grade : null;
      if (!(cfg.auto_provision && email && verified && cfg.allowed_domains.includes(domain) && grade)) return fail(slug, "PARTNER_ACCOUNT_NOT_FOUND", d);
      const created = await d.admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: typeof claims.name === "string" ? claims.name.slice(0, 150) : "Learner", grade } });
      if (created.error || !created.data.user) return fail(slug, "PARTNER_PROVISION_FAILED", d);
      userId = created.data.user.id;
    }

    const ref = typeof claims.qb_member_ref === "string" && claims.qb_member_ref ? claims.qb_member_ref : claims.sub;
    const linked = await d.admin.rpc("qb_partner_sso_link", { p_partner: cfg.partner_id, p_issuer: cfg.issuer, p_subject: claims.sub, p_user: userId, p_external_ref: ref });
    if (linked.error) {
      const m = linked.error.message;
      return fail(slug, /MINOR_CONSENT/.test(m) ? "PARTNER_MINOR_CONSENT_REQUIRED" : /IDENTITY_CONFLICT/.test(m) ? "PARTNER_IDENTITY_CONFLICT" : /MEMBER_REVOKED/.test(m) ? "PARTNER_MEMBER_REVOKED" : mapDbError(m) === "INTERNAL" ? "PARTNER_SSO_FAILED" : "PARTNER_SSO_DENIED", d);
    }

    const profile = await d.admin.from("profiles").select("email").eq("id", userId).single();
    const accountEmail = (profile.data as { email?: string } | null)?.email;
    if (!accountEmail) return fail(slug, "PARTNER_SSO_FAILED", d);
    const link = await d.admin.auth.admin.generateLink({ type: "magiclink", email: accountEmail, options: { redirectTo: `${origin(d)}/auth/callback?next=/student` } });
    const action = (link.data as any)?.properties?.action_link as string | undefined;
    if (link.error || !action) return fail(slug, "PARTNER_SSO_FAILED", d);
    return redirect(action, { "Set-Cookie": cookieHeader("", 0, d) });
  } catch (e) {
    return fail(slug, e instanceof OidcError ? e.code : "PARTNER_SSO_FAILED", d);
  }
}
