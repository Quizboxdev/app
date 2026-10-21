import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { PLANS } from "@/lib/payments/plans";
import type { PriceRow } from "./format";

// The active prices for the public pricing page, read on the server. If the price list is not installed yet, or is empty, the plans in config/subscription-plans.json are shown
// (all "Price to be announced" until priced), so the page is never blank and never shows a broken price.
export const FALLBACK_PRICES: PriceRow[] = [
  ...PLANS.map((p): PriceRow => ({ code: p.id, kind: "plan", name: p.name, audience: p.audience === "Schools" ? "school" : "learner", description: "", includes: p.includes, period: (["month", "term", "year"].includes(p.period) ? p.period : "month") as PriceRow["period"], price_minor: null, currency: "GHS", highlight: false, checkout_url: null })),
  { code: "sponsor_quiz", kind: "campaign", name: "Challenges and campaigns", audience: "sponsor", description: "Run a branded quiz on your own material.", includes: ["Your logo and colours", "Reading material for players", "Results and participation reports"], period: "campaign", price_minor: null, currency: "GHS", highlight: false, checkout_url: null },
];

export async function getPrices(): Promise<PriceRow[]> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("qb_price_list");
    if (!error && Array.isArray(data) && data.length > 0) return data as PriceRow[];
    // Say why the fallback is showing (a missing server key, an unapplied migration, an empty list) so it is visible in the function logs. No secret is logged.
    console.error("[pricing] price list not used:", error ? `${error.code ?? ""} ${error.message}`.trim() : "the list is empty");
  } catch (e) { console.error("[pricing] price list unavailable:", e instanceof Error ? e.message : "unknown error"); }
  return FALLBACK_PRICES;
}
