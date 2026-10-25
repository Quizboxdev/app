// After signing in, a visitor can be sent back to a challenge they opened (deep-link auth return, blueprint test matrix B).
// Only a short allow-list of in-app paths is accepted, so the parameter can never become an open redirect.
// Challenge links, plus the one fixed page /subscribe (the pricing page's Subscribe button): a person who signs in or signs up from it lands there.
const SAFE = /^(\/(play|challenges|competitions)\/[a-z0-9]+(-[a-z0-9]+)*|\/subscribe)$/;
export function safeNextPath(value: unknown): string | null {
  return typeof value === "string" && value.length <= 80 && SAFE.test(value) ? value : null;
}
export const loginHrefFor = (path: string) => { const next = safeNextPath(path); return next ? `/login?next=${encodeURIComponent(next)}` : "/login"; };

// A shared link must survive sign-up: the confirmation email opens a new page, so the path is remembered on this device until the person lands on it.
const KEY = "qb-next";
export function rememberNext(path: unknown): void { const safe = safeNextPath(path); try { if (safe) window.localStorage.setItem(KEY, safe); } catch { /* private mode: they still arrive on their home page */ } }
export function takeNext(): string | null { try { const v = safeNextPath(window.localStorage.getItem(KEY)); window.localStorage.removeItem(KEY); return v; } catch { return null; } }
