import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { processProviderCallback } from "@/lib/payments/settlement";

// Provider callback (server to server). The body is read raw because the signature covers the exact bytes. Nothing here trusts the caller: the
// provider adapter verifies the signature and re-queries the provider before any money is credited. Unverifiable calls change nothing (400).
export const runtime = "nodejs";
const KNOWN = new Set(["paystack"]);

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (!KNOWN.has(provider)) return new NextResponse(null, { status: 404 });
  const raw = await req.text();
  if (raw.length > 64 * 1024) return new NextResponse(null, { status: 413 });
  try {
    const result = await processProviderCallback(getSupabaseAdminClient(), provider, raw, req.headers);
    return NextResponse.json({ ok: result.status === 200 }, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
