import { referralCapture } from "@/lib/api/affiliates";
import { clearReferralCookieHeader, readReferralCookie } from "./code";

// Called once after a visitor is signed in. If they arrived through an affiliate's link, ask the database to attribute them. Whatever the answer, the cookie is cleared so
// the call is made once; the database keeps the first attribution and ignores a second. A failure here must never get in the way of using the app.
export async function captureReferralIfAny(doc: { cookie: string } = document): Promise<string | null> {
  const code = readReferralCookie(doc.cookie);
  if (!code) return null;
  try {
    const { outcome } = await referralCapture(code);
    doc.cookie = clearReferralCookieHeader();
    return outcome;
  } catch {
    return null;                                                                                          // keep the cookie: try again on the next page load
  }
}
