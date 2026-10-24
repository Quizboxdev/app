import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { guardDecision, hasAuthCookie, isProtectedPath, serverGuardOn, type Verdict } from "@/lib/auth/guard";
import { loginHrefFor } from "@/lib/auth/next-path";
import { challengeHostRedirect } from "@/lib/challenges/host";
import { authCallbackHref, hasAuthLinkParams } from "@/lib/auth-links";

// 0. On "/", email-link results go to the auth callback and signed-in visitors are served /opening (the home page behind the session gate).
const POLICY_PAGES = new Set(["/terms", "/privacy", "/refunds", "/cookies"]);

// 1. The challenge.quizbox.io host is sent to the same pages on www.quizbox.io (see lib/challenges/host.ts).
// 2. When QB_SERVER_GUARD is "on", a signed-out request for a signed-in page is sent to the login screen by the server (see lib/auth/guard.ts). Everything else passes straight through.
export async function middleware(request: NextRequest) {
  const target = challengeHostRedirect(request.headers.get("host"), request.nextUrl.pathname);
  if (target) return NextResponse.redirect(target, 307);

  const { pathname } = request.nextUrl;
  // The home page is static (see app/(public)/page.tsx), so what used to be decided inside it is decided here.
  if (pathname === "/") {
    const params: Record<string, string[]> = {};
    request.nextUrl.searchParams.forEach((value, key) => { (params[key] ??= []).push(value); });
    if (hasAuthLinkParams(params)) return NextResponse.redirect(new URL(authCallbackHref(params), request.url), 307);
    if (hasAuthCookie(request.cookies.getAll().map((c) => c.name))) return NextResponse.rewrite(new URL("/opening", request.url));
  }
  // An earlier policy version (/terms?v=2) is served by a dynamic page so the policy pages themselves can be cached.
  if (POLICY_PAGES.has(pathname) && request.nextUrl.searchParams.has("v")) return NextResponse.rewrite(new URL(`/policy-version${pathname}${request.nextUrl.search}`, request.url));
  if (!serverGuardOn(process.env) || !isProtectedPath(pathname)) return NextResponse.next();

  const toLogin = () => NextResponse.redirect(new URL(loginHrefFor(pathname), request.url), 307);
  const hasCookie = hasAuthCookie(request.cookies.getAll().map((c) => c.name));
  const prefetch = request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
  if (!hasCookie) return toLogin();
  if (prefetch) return NextResponse.next();

  // Ask the sign-in service whether the session is real (this also refreshes an expiring session and passes the new cookie on).
  let response = NextResponse.next({ request });
  let verdict: Verdict = "unreachable";
  try {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookies: { name: string; value: string; options: CookieOptions }[]) => { cookies.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options)); },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    if (data?.user) verdict = "valid";
    else if (error && /Retryable|fetch|network|timeout/i.test(`${error.name} ${error.message}`)) verdict = "unreachable";
    else verdict = "invalid";
  } catch { verdict = "unreachable"; }
  return guardDecision({ hasCookie, prefetch, verdict }) === "login" ? toLogin() : response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
