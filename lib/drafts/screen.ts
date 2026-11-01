// Pure rules for keeping an admin screen's unfinished form as a draft. The saving itself is lib/drafts/use-draft.ts; this decides WHAT is saved.
// Rules: a draft never holds a secret (passwords, keys, tokens and client secrets are removed before anything leaves the browser), never holds anything the
// browser cannot turn into plain JSON (files, functions), and is only saved when the form differs from how it started.
export const SECRET_KEY = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential|authorization)/i;

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const plain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

// A copy of the value that is safe to store: secret-looking keys and any named in `omit` are dropped (at any depth), and anything that is not plain data is left out.
export function scrub(value: unknown, omit: readonly string[] = []): Json | undefined {
  const skip = new Set(omit.map((k) => k.toLowerCase()));
  const walk = (v: unknown): Json | undefined => {
    if (v === null || typeof v === "boolean" || typeof v === "string") return v as Json;
    if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
    if (Array.isArray(v)) return v.map((x) => walk(x) ?? null);
    if (plain(v)) {
      const out: { [k: string]: Json } = {};
      for (const [k, x] of Object.entries(v)) { if (SECRET_KEY.test(k) || skip.has(k.toLowerCase())) continue; const w = walk(x); if (w !== undefined) out[k] = w; }
      return out;
    }
    return undefined;
  };
  return walk(value);
}

// True when the two values hold the same data once scrubbed (so an untouched form is never saved as a "draft").
export function sameData(a: unknown, b: unknown, omit: readonly string[] = []): boolean {
  return JSON.stringify(scrub(a, omit) ?? null) === JSON.stringify(scrub(b, omit) ?? null);
}

// The holder keeps at most 100,000 characters of payload; stay well under it so a save is never refused silently.
export const DRAFT_MAX_CHARS = 90_000;
export const fitsDraft = (payload: unknown): boolean => JSON.stringify(payload ?? null).length <= DRAFT_MAX_CHARS;

// One draft per person per screen: the scope key is the screen's name, limited to what the holder accepts (letters, digits, dash, underscore; 1 to 64).
export function screenScope(screen: string, id?: string): string {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return (`admin-${clean(screen)}` + (id ? `-${clean(id)}` : "")).slice(0, 64);
}

// The holder allows titles of up to 120 characters.
export const draftTitle = (label: string, detail?: string): string => (detail?.trim() ? `${label}: ${detail.trim()}` : label).replace(/\s+/g, " ").slice(0, 120);
