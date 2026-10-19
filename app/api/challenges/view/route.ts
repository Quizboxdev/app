import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { SITE_URL } from "@/lib/site";

// Counts one page view of a public challenge (analytics for the organiser). Same-origin, tiny body, no personal data, and it never fails loudly: a missed view is harmless.
export const runtime = "nodejs";
const quiet = (status = 204) => new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const origin = req.headers.get("origin"), host = req.headers.get("host") ?? "";
  try { if (!origin || (new URL(origin).host !== host && new URL(origin).host !== new URL(SITE_URL).host && new URL(origin).host !== `www.${new URL(SITE_URL).host}`)) return quiet(403); } catch { return quiet(403); }
  const raw = await req.text();
  if (raw.length > 200) return quiet(413);
  let slug = ""; try { slug = String(JSON.parse(raw)?.slug ?? ""); } catch { return quiet(400); }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return quiet(400);
  try { await getSupabaseAdminClient().rpc("challenge_track_view", { p_slug: slug }); } catch { /* ignore */ }
  return quiet();
}
