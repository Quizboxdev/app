// Security headers for every response (completion plan, Phase 3 step 1).
// Enforced now: transport security, no framing, no MIME sniffing, a strict referrer policy and no access to camera, microphone or location.
// The Content-Security-Policy starts in REPORT-ONLY mode: browsers report what it would block without blocking it. When the reports are clean,
// switch CSP_MODE to "enforce" (one line) and deploy.
export const CSP_MODE = "report-only" as "report-only" | "enforce";

const supabase = "https://*.supabase.co";
export const CONTENT_SECURITY_POLICY = [
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
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: CSP_MODE === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", value: CONTENT_SECURITY_POLICY },
];
