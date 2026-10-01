import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const expected = process.env.QB_OPS_SECRET;
  const provided = request.headers.get("x-qb-ops-secret");

  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    const [platform, learning] = await Promise.all([
      supabase.rpc("qb_refresh_daily_metrics", {
        p_metric_date: today,
      }),
      supabase.rpc("qb_refresh_learning_metrics", {
        p_metric_date: today,
      }),
    ]);

    if (platform.error) throw platform.error;
    if (learning.error) throw learning.error;

    return NextResponse.json({
      status: "PASS",
      platform: platform.data,
      learning: learning.data,
      refreshed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: "FAIL",
        error: error?.message ?? "Analytics refresh failed",
      },
      { status: 500 }
    );
  }
}
