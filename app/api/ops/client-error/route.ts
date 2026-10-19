import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { SITE_URL } from "@/lib/site";

// Receives browser error reports. Same origin only, JSON, at most 4 KB; always answers 204 so it can never be used to probe the system.
// The database function scrubs the path and message, counts repeats and caps the volume.
export const runtime = "nodejs";
const done = () => new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin"), host = req.headers.get("host") ?? "", site = new URL(SITE_URL).host;
    const o = origin ? new URL(origin).host : "";
    if (!o || !(o === host || o === site || o === `www.${site}`)) return done();
    const raw = await req.text();
    if (raw.length > 4096) return done();
    const b = JSON.parse(raw) as Record<string, unknown>;
    if (!["RENDER", "UNHANDLED", "NETWORK"].includes(String(b.kind))) return done();
    await getSupabaseAdminClient().rpc("qb_record_client_error", { p_kind: String(b.kind), p_route: String(b.route ?? "/").slice(0, 300), p_digest: String(b.digest ?? "").slice(0, 64), p_message: String(b.message ?? "").slice(0, 300) });
  } catch { /* a monitoring failure must never surface */ }
  return done();
}
