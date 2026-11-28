import { createHmac } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { sourceParam } from "@/lib/interschool/text";

// Counts visits to and shares of a public competition page, by where the link came from. One count per device, page and hour; only a one-way hash of the address is used for that limit.
export const runtime = "nodejs";
const quiet = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 200) return quiet(413);
  let slug = "", kind = "", source = ""; try { const body = JSON.parse(raw); slug = String(body?.slug ?? ""); kind = body?.kind === "share" ? "share" : "view"; source = sourceParam(body?.source); } catch { return quiet(400); }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 70) return quiet(400);
  const salt = process.env.INTAKE_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) return quiet();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const device = createHmac("sha256", salt).update(ip).digest("hex").slice(0, 24);
  try {
    const admin = getSupabaseAdminClient();
    const allowed = await admin.rpc("qb_consume_budget", { p_key: `interschool:${kind}:${slug}:${device}`, p_limit: 1, p_seconds: 3600 });
    if (allowed.error || allowed.data === false) return quiet();                          // over the limit, or the limiter is unavailable: count nothing
    await admin.rpc("interschool_track", { p_slug: slug, p_kind: kind, p_source: source });
  } catch { /* a missed count is harmless */ }
  return quiet();
}
