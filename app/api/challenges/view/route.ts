import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { SITE_URL } from "@/lib/site";

// Counts one page view (or, with event "share", one share) of a public challenge or competition (analytics for the organiser). Same-origin, tiny body, no personal data, and it never fails loudly: a missed view is harmless.
// The Origin header can be forged from outside a browser, so each device (a one-way hash of its address, never stored as an address) also counts at most once per challenge and kind per hour (audit QB-AUD-007).
export const runtime = "nodejs";
const quiet = (status = 204) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("host") ?? "";
  try { if (!origin || (new URL(origin).host !== host && new URL(origin).host !== new URL(SITE_URL).host && new URL(origin).host !== `www.${new URL(SITE_URL).host}`)) return quiet(403); } catch { return quiet(403); }
  const raw = await req.text();
  if (raw.length > 200) return quiet(413);
  let slug = "", event = ""; try { const body = JSON.parse(raw); slug = String(body?.slug ?? ""); event = String(body?.event ?? ""); } catch { return quiet(400); }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return quiet(400);
  const salt = process.env.INTAKE_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) return quiet();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const device = createHmac("sha256", salt).update(ip).digest("hex").slice(0, 24);
  const kind = event === "share" ? "share" : "view";
  try {
    const admin = getSupabaseAdminClient();
    const allowed = await admin.rpc("qb_consume_budget", { p_key: `challenge:${kind}:${slug}:${device}`, p_limit: 1, p_seconds: 3600 });
    if (allowed.error || allowed.data === false) return quiet();                         // over the limit, or the limiter is unavailable: count nothing
    await admin.rpc(kind === "share" ? "challenge_track_share" : "challenge_track_view", { p_slug: slug });
  } catch { /* a missed count is harmless */ }
  return quiet();
}
