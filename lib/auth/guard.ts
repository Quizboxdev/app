// A server-side check in front of the signed-in pages (audit QB-AUD-006). The pages already send a signed-out visitor to the login screen from the browser, and the data is protected by database rules either way;
// this adds a second line of defence: a signed-out request for a protected page is turned away by the server before the page is sent.
// It is OFF unless the environment variable QB_SERVER_GUARD is "on", so it can be tried on a Preview deployment first. It fails OPEN when the sign-in service cannot be reached, so an outage never locks everyone out.

// Every top-level section inside app/(app). A test compares this list with the folders, so a new section cannot be forgotten.
export const PROTECTED_PREFIXES = ["account", "admin", "competition", "creator", "drafts", "guides", "learn", "marketplace", "notifications", "open", "play", "practise", "review", "school", "seller", "sponsor", "student", "subscribe", "support", "teacher"] as const;

export const serverGuardOn = (env: Record<string, string | undefined>) => env.QB_SERVER_GUARD === "on";

export function isProtectedPath(pathname: string): boolean {
  const first = pathname.split("/")[1] ?? "";
  return (PROTECTED_PREFIXES as readonly string[]).includes(first);
}

// The sign-in cookie is named sb-<project>-auth-token, and is split into .0 .1 pieces when it is long.
export const hasAuthCookie = (names: string[]) => names.some((n) => /^sb-.+-auth-token(\.\d+)?$/.test(n));

export type Verdict = "valid" | "invalid" | "unreachable";
// What to do with a request for a protected page. "allow" lets it through, "login" sends the visitor to sign in.
export function guardDecision(input: { hasCookie: boolean; prefetch: boolean; verdict: Verdict | null }): "allow" | "login" {
  if (!input.hasCookie) return "login";                       // no session at all: no need to ask anyone
  if (input.prefetch) return "allow";                          // a background prefetch only warms the cache; the real visit is checked
  if (input.verdict === "invalid") return "login";            // the session is expired or forged
  return "allow";                                              // valid, or the sign-in service could not be reached (fail open)
}
