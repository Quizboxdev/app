import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";

// Help search for the public and in-app Help pages. Public by design (it returns only published guides). The text is limited, the database ignores wildcards, and the answer is never cached
// for long so a newly published guide is found within a minute.
export const runtime = "nodejs";
const out = (status: number, body: unknown) => NextResponse.json(body, { status, headers: { "Cache-Control": "public, max-age=30" } });

export async function GET(req: Request) {
  const url = new URL(req.url), q = (url.searchParams.get("q") ?? "").trim().slice(0, 100), audience = url.searchParams.get("audience");
  if (q.length < 2) return out(200, { ok: true, results: [] });
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("qb_help_search", { p_query: q, p_audience: audience && ["student", "teacher", "school", "sponsor"].includes(audience) ? audience : null });
    if (error) { console.error("[help] search failed:", `${error.code ?? ""} ${error.message}`.trim()); return out(503, { ok: false, results: [] }); }
    return out(200, { ok: true, results: data ?? [] });
  } catch (e) { console.error("[help] search unavailable:", e instanceof Error ? e.message : "unknown error"); return out(503, { ok: false, results: [] }); }
}
