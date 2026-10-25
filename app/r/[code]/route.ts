import { NextResponse } from "next/server";
import { normaliseCode, referralCookieHeader } from "@/lib/referral/code";

// An affiliate's link, https://www.quizbox.io/r/CODE. It remembers the code for 30 days in a small cookie and sends the visitor to the home page. The cookie is only a hint:
// the database checks the code when the visitor signs in (lib/referral/capture.ts), refuses self-referral and existing customers, and keeps only the first attribution.
// A code that cannot be a code sets nothing, so the link cannot be used to plant arbitrary text in a cookie.
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code: raw } = await ctx.params;
  const code = (() => { try { return normaliseCode(decodeURIComponent(raw)); } catch { return null; } })();   // a malformed % sequence is just "not a code"
  const res = NextResponse.redirect(new URL("/", request.url), 307);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  if (code) res.headers.append("Set-Cookie", referralCookieHeader(code, new URL(request.url).protocol === "https:"));
  return res;
}
