// Security headers for every response (completion plan, Phase 3 step 1).
// Enforced now: transport security, no framing, no MIME sniffing, a strict referrer policy and no access to camera, microphone or location.
// The Content-Security-Policy runs in REPORT-ONLY mode until the owner switches it on: browsers report what it would block without blocking it.
// To enforce, set the environment variable QB_CSP_MODE=enforce in Vercel (Preview first, then Production) and redeploy; remove the variable to go back.
// The decision rule and the steps are in docs/ops/CSP_ENFORCEMENT.md. Nothing in the code needs editing.
export type CspMode = "report-only" | "enforce";

// Only the exact word "enforce" turns blocking on; any other value (or none) keeps the safe report-only mode.
export const cspMode = (env: Record<string, string | undefined>): CspMode => (env.QB_CSP_MODE === "enforce" ? "enforce" : "report-only");

const supabase = "https://*.supabase.co";
export function contentSecurityPolicy(mode: CspMode): string {
  return [
    "default-src 'self'",
    // Next.js needs inline bootstrapping scripts; 'unsafe-eval' is not allowed.
    "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${supabase}`,
    `connect-src 'self' ${supabase} wss://*.supabase.co https://vitals.vercel-insights.com`,
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // Browsers post violations here; the route writes a one-line summary to the function logs (no query strings), so the policy can be checked before it is enforced.
    "report-uri /api/ops/csp-report",
    // Browsers ignore this directive in report-only mode (and log a console notice), so it is added only when enforcing.
    ...(mode === "enforce" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function securityHeaders(mode: CspMode): { key: string; value: string }[] {
  return [
    { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", value: contentSecurityPolicy(mode) },
  ];
}

export const CSP_MODE: CspMode = cspMode(process.env);
export const CONTENT_SECURITY_POLICY = contentSecurityPolicy(CSP_MODE);
export const SECURITY_HEADERS = securityHeaders(CSP_MODE);
