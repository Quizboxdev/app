import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { validateSubmission } from "@/lib/public/intake-validation";
import { SITE_URL } from "@/lib/site";
import { logFallback } from "@/lib/ops/log";

// Public enquiry intake. The browser posts here (never to Supabase). The route is the real gate: same origin, JSON, at most 8 KB, a honeypot,
// a minimum time-to-submit, strict validation, then a database function with durable rate limits. It answers generically and never echoes input.
export const runtime = "nodejs";
const MAX_BYTES = 8 * 1024;
const generic = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin"); if (!origin) return false;
  try {
    const o = new URL(origin).host, host = req.headers.get("host") ?? "", site = new URL(SITE_URL).host;
    return o === host || o === site || o === `www.${site}` || o.endsWith(".vercel.app") && o === host;
  } catch { return false; }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return generic(403, { ok: false });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return generic(415, { ok: false });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return generic(413, { ok: false });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return generic(400, { ok: false, error: "Invalid request." }); }
  // Bots fill the hidden field and submit instantly; both look like success to them but nothing is stored.
  const { website, elapsed_ms, ...fields } = body as { website?: unknown; elapsed_ms?: unknown } & Record<string, unknown>;
  if ((typeof website === "string" && website.trim()) || typeof elapsed_ms !== "number" || elapsed_ms < 3000) return generic(202, { ok: true });
  const checked = validateSubmission(fields);
  if (!checked.ok) return generic(400, { ok: false, error: checked.error });
  const key = process.env.INTAKE_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return generic(503, { ok: false, error: "Sending is temporarily unavailable. Please try again later." });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const clientHash = createHmac("sha256", key).update(ip).digest("hex");                  // pseudonymous; the address itself is never stored
  try {
    const { error } = await getSupabaseAdminClient().rpc("qb_submit_public_interest", { p: checked.value, p_client_hash: clientHash });
    if (error) {
      if (/QB_RATE_LIMITED/.test(error.message)) return generic(429, { ok: false, error: "Too many messages. Please try again later." });
      if (/QB_INTAKE_/.test(error.message)) return generic(400, { ok: false, error: "Please check your details and try again." });
      console.error(`[intake] could not store a message: ${error.message.replace(/\s+/g, " ").slice(0, 160)}`);
      return generic(503, { ok: false, error: "Sending is temporarily unavailable. Please try again later." });
    }
  } catch (e) { logFallback("intake", "could not store a message", e); return generic(503, { ok: false, error: "Sending is temporarily unavailable. Please try again later." }); }
  return generic(202, { ok: true });
}
