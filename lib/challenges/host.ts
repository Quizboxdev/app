// challenge.quizbox.io is a short, shareable entry point. It sends people to the same pages on www.quizbox.io rather than serving its own copy, so sign-in
// (cookies are per host) keeps working and there is one canonical URL for search engines. Decision for ADR-003, reviewed with the owner's delegation.
export const CHALLENGE_HOSTS = ["challenge.quizbox.io", "challenges.quizbox.io"];
export const WWW_ORIGIN = "https://www.quizbox.io";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function challengeHostRedirect(host: string | null | undefined, pathname: string): string | null {
  const h = (host ?? "").toLowerCase().split(":")[0];
  if (!CHALLENGE_HOSTS.includes(h)) return null;
  if (pathname.startsWith("/_next") || pathname.startsWith("/api/") || pathname === "/favicon.ico" || pathname === "/robots.txt") return null;
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/") return `${WWW_ORIGIN}/challenges`;
  const bare = clean.slice(1);
  if (SLUG.test(bare) && bare.length <= 60 && bare !== "challenges") return `${WWW_ORIGIN}/challenges/${bare}`;
  if (/^\/(challenges|competitions|play|creator|login)(\/[a-z0-9-]+)?$/.test(clean)) return `${WWW_ORIGIN}${clean}`;
  return `${WWW_ORIGIN}/challenges`;
}
