// Turns a browser's Content-Security-Policy violation report into one safe summary line. Reports come from anyone, so addresses lose their query strings and fragments, odd characters are removed,
// and reports caused by browser extensions (which are not about our pages) are ignored.
const NOISE = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i;

export const cleanUri = (value: unknown): string => {
  const v = String(value ?? "").trim().slice(0, 300);
  if (/^https?:\/\//i.test(v)) { try { const u = new URL(v); return `${u.origin}${u.pathname}`.slice(0, 160); } catch { return "invalid"; } }
  return v.replace(/[^\w:.\-/*]/g, "").slice(0, 60);          // inline, eval, data, blob, self ...
};

export type CspSummary = { directive: string; blocked: string; page: string; mode: string };
export function summariseReport(raw: unknown): CspSummary | null {
  const first = Array.isArray(raw) ? (raw as Record<string, unknown>[]).find((r) => r?.type === "csp-violation")?.body : (raw as Record<string, unknown> | null)?.["csp-report"];
  const r = first as Record<string, unknown> | undefined;
  if (!r || typeof r !== "object") return null;
  const blocked = cleanUri(r["blocked-uri"] ?? r["blockedURL"] ?? r["blockedURI"]);
  if (NOISE.test(blocked)) return null;
  return {
    directive: String(r["effective-directive"] ?? r["effectiveDirective"] ?? r["violated-directive"] ?? "unknown").split(" ")[0].slice(0, 40),
    blocked, page: cleanUri(r["document-uri"] ?? r["documentURL"]).replace(/^https?:\/\/[^/]+/i, "") || "/", mode: String(r["disposition"] ?? "report").slice(0, 10),
  };
}
