// Browser-side error reporting (completion plan G9). Sends a small, privacy-safe report to /api/ops/client-error. Never throws, never blocks the page,
// and sends at most MAX_PER_PAGE reports per page load, one per distinct error.
const MAX_PER_PAGE = 5;
const seen = new Set<string>();
export type ClientErrorKind = "RENDER" | "UNHANDLED" | "NETWORK";

export function errorDigest(error: unknown): string {
  const text = String((error as { digest?: string })?.digest ?? (error as { message?: string })?.message ?? error ?? "");
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function reportClientError(kind: ClientErrorKind, error: unknown, route?: string): void {
  try {
    if (typeof window === "undefined" || seen.size >= MAX_PER_PAGE) return;
    const digest = errorDigest(error), key = `${kind}:${digest}`;
    if (seen.has(key)) return;
    seen.add(key);
    const message = String((error as { message?: string })?.message ?? error ?? "").slice(0, 200);
    const body = JSON.stringify({ kind, route: route ?? window.location.pathname, digest, message });
    if (navigator.sendBeacon?.("/api/ops/client-error", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/ops/client-error", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch { /* reporting must never cause an error */ }
}
