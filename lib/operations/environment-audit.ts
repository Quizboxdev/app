import { validatePublicEnvironment } from "@/lib/env";

type Target = "production" | "preview" | "local";
type Environment = Record<string, string | undefined>;
export const SUPABASE_PROJECTS = { production: "fmgccmqxfjppqydkhaiu", preview: "fngdtxayfoiffbcbmcum" } as const;

function claims(key: string): { role?: string; ref?: string } | null {
  try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")); } catch { return null; }
}

// Read-only and value-free: safe to retain in CI artifacts. This does not authenticate to any provider.
export function auditEnvironment(env: Environment, target: Target, requireOperations = false, paymentMode: "test" | "live" = "test") {
  const issues: string[] = [];
  const publicKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try { validatePublicEnvironment({ NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey }); }
  catch { issues.push("PUBLIC_SUPABASE_CONFIG_INVALID"); }
  if (target !== "local") {
    try { if (new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname !== `${SUPABASE_PROJECTS[target]}.supabase.co`) issues.push("SUPABASE_TARGET_PROJECT_MISMATCH"); }
    catch { /* Public validator already reports the malformed URL. */ }
  }
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY && env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) issues.push("PUBLIC_KEY_ALIASES_DIFFER_VERIFY_PRECEDENCE");
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (service) {
    const jwt = claims(service);
    if (!service.startsWith("sb_secret_") && jwt?.role !== "service_role") issues.push("SERVER_KEY_IS_NOT_SERVICE_ROLE");
    try { if (jwt?.ref && jwt.ref !== new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0]) issues.push("SERVER_KEY_PROJECT_MISMATCH"); }
    catch { /* Public validator reports invalid URLs. */ }
  } else if (requireOperations) issues.push("SERVER_KEY_MISSING");
  const payment = env.PAYSTACK_SECRET_KEY;
  if (payment) {
    if (target !== "production" && !payment.startsWith("sk_test_")) issues.push("NON_PRODUCTION_PAYMENT_KEY_MUST_BE_TEST");
    if (target === "production" && !payment.startsWith(`sk_${paymentMode}_`)) issues.push("PRODUCTION_PAYMENT_MODE_MISMATCH");
  } else if (requireOperations) issues.push("PAYMENT_KEY_MISSING");
  if (env.NEXT_PUBLIC_URL_SITE) issues.push("MISSPELLED_SITE_URL_VARIABLE");
  if (env.NEXT_PUBLIC_SITE_URL && env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "") !== "https://www.quizbox.io") issues.push("CANONICAL_SITE_URL_MISMATCH");
  if (requireOperations) for (const name of ["RESEND_API_KEY", "EMAIL_FROM", "CRON_SECRET", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"]) if (!env[name]) issues.push(`${name}_MISSING`);
  return { target, paymentMode: target === "production" ? paymentMode : "test", verification: "static-only", ok: issues.length === 0, issues, configured: Object.keys(env).filter((key) => /^(NEXT_PUBLIC_|SUPABASE_|PAYSTACK_|RESEND_|EMAIL_|CRON_|VAPID_)/.test(key) && Boolean(env[key])).sort() };
}
