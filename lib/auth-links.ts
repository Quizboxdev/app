// Server-safe helpers for Supabase email links (no Supabase client import).
// Generic landing for email links (signup confirmation, password recovery, magic links). Supabase sends a link to this path when the
// redirect URL is allow-listed, and to the Site URL root otherwise; "/" and "/login" forward any ?code= / error parameters here.
export const AUTH_CALLBACK_PATH = "/auth/callback";

type Params = Record<string, string | string[] | undefined>;

// True when a URL carries an email-link result that must be completed by AUTH_CALLBACK_PATH.
export function hasAuthLinkParams(params: Params) {
  return ["code", "token_hash", "error_code", "error_description"].some((key) => params[key] !== undefined);
}

// AUTH_CALLBACK_PATH with the same query string.
export function authCallbackHref(params: Params) {
  const query = new URLSearchParams(Object.entries(params).flatMap(([key, value]) => (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((item) => [key, item])));
  return `${AUTH_CALLBACK_PATH}?${query.toString()}`;
}
