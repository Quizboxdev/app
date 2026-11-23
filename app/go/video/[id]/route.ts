import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { isVideoUuid, isYouTubeId, youtubeWatchUrl } from "@/lib/help/video";

// "Watch on YouTube" for a Help video: counts the click (once per video per device per hour) and sends the person to the video on QuizBox's YouTube channel, so the views are ours.
// Only published videos in the library can be reached, and the address it sends to is always built from the stored video id, never from anything in this request.
// A draft, an unknown video or a database problem sends the person to the Help centre instead. No personal data is stored: the device is a one-way hash.
export const runtime = "nodejs";
const go = (to: string, req: Request) => NextResponse.redirect(to.startsWith("http") ? to : new URL(to, req.url), { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "strict-origin-when-cross-origin" } });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isVideoUuid(id)) return go("/help", req);
  try {
    const admin = getSupabaseAdminClient();
    let count = true;
    const salt = process.env.INTAKE_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (salt) {
      const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
      const device = createHmac("sha256", salt).update(ip).digest("hex").slice(0, 24);
      const allowed = await admin.rpc("qb_consume_budget", { p_key: `helpvideo:out:${id}:${device}`, p_limit: 1, p_seconds: 3600 });
      if (allowed.error || allowed.data === false) count = false;
    }
    const { data, error } = await admin.rpc("qb_help_video_outbound", { p_id: id, p_count: count });
    if (error || typeof data !== "string" || !isYouTubeId(data)) return go("/help", req);
    return go(youtubeWatchUrl(data), req);
  } catch { return go("/help", req); }
}
