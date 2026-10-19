// After signing in, a visitor can be sent back to a challenge they opened (deep-link auth return, blueprint test matrix B).
// Only a short allow-list of in-app paths is accepted, so the parameter can never become an open redirect.
const SAFE = /^\/(play|challenges)\/[a-z0-9]+(-[a-z0-9]+)*$/;
export function safeNextPath(value: unknown): string | null {
  return typeof value === "string" && value.length <= 80 && SAFE.test(value) ? value : null;
}
export const loginHrefFor = (path: string) => { const next = safeNextPath(path); return next ? `/login?next=${encodeURIComponent(next)}` : "/login"; };
