// The referral link and the small cookie that carries an affiliate's code from /r/CODE to the moment the visitor signs in.
// The cookie is only a hint: the database validates the code, refuses self-referral and existing customers, and keeps the first attribution forever.
export const REFERRAL_COOKIE = "qb_ref";
export const REFERRAL_DAYS = 30;
export const REFERRAL_CODE = /^[A-Z0-9]{6,12}$/;

// "  ab12cd34 " becomes "AB12CD34"; anything that cannot be a code becomes null (so a link never sets a cookie from arbitrary text).
export function normaliseCode(raw: unknown): string | null {
  const code = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
  return REFERRAL_CODE.test(code) ? code : null;
}

export const referralCookieHeader = (code: string, secure: boolean) =>
  `${REFERRAL_COOKIE}=${code}; Path=/; Max-Age=${REFERRAL_DAYS * 86400}; SameSite=Lax${secure ? "; Secure" : ""}`;

export const readReferralCookie = (cookieString: string): string | null => {
  const hit = cookieString.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${REFERRAL_COOKIE}=`));
  return hit ? normaliseCode(decodeURIComponent(hit.slice(REFERRAL_COOKIE.length + 1))) : null;
};
export const clearReferralCookieHeader = () => `${REFERRAL_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
