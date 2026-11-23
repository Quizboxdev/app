import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { SITE_URL } from "@/lib/site";
import { isVideoUuid } from "@/lib/help/video";

// Counts one play of a Help video (pressed play inside QuizBox). Same origin, tiny body, and at most one play per video per device per hour. No personal data is stored: the device is a
// one-way hash, and the answer never fails loudly (a missed count is harmless).
export const runtime = "nodejs";
const quiet = (status = 204) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("host") ?? "";
  try { if (!origin) return quiet(403); const o = new URL(origin).host, site = new URL(SITE_URL).host; if (o !== host && o !== site && o !== `www.${site}`) return quiet(403); } catch { return quiet(403); }
  const raw = await req.text();
  if (raw.length > 200) return quiet(413);
  let id = "", event = "";
  try { const b = JSON.parse(raw); id = String(b?.id ?? ""); event = String(b?.event ?? ""); } catch { return quiet(400); }
  if (!isVideoUuid(id) || event !== "play") return quiet(400);
  const salt = process.env.INTAKE_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) return quiet();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  const device = createHmac("sha256", salt).update(ip).digest("hex").slice(0, 24);
  try {
    const admin = getSupabaseAdminClient();
    const allowed = await admin.rpc("qb_consume_budget", { p_key: `helpvideo:play:${id}:${device}`, p_limit: 1, p_seconds: 3600 });
    if (allowed.error || allowed.data === false) return quiet();
    await admin.rpc("qb_help_video_track", { p_id: id, p_event: "play" });
  } catch { /* a missed count is harmless */ }
  return quiet();
}
