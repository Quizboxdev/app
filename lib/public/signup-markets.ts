import type { SignupCountry } from "@/lib/api/markets";

// Public market metadata for the marketing pages. Source: public.qb_signup_markets(), which is
// intentionally executable by anon (docs/security-release-review.md; grant in
// 20261003100000_multi_market_platform.sql). Only display labels leave this module: no market
// ids, codes or configuration internals are rendered publicly.

export type PublicMarket = {
  country: string;
  market: string;
  educationLevels: string[];
  subjects: string[];
};

export type PublicMarkets = {
  available: PublicMarket[];
  upcomingCountries: string[];
};

const labels = (options: Array<{ label?: unknown }> | undefined) =>
  Array.from(new Set((options ?? []).map((o) => (typeof o?.label === "string" ? o.label.trim() : "")).filter((l) => l.length > 0 && l.length <= 80)));

export function toPublicMarkets(rows: unknown): PublicMarkets {
  const list = Array.isArray(rows) ? (rows as Partial<SignupCountry>[]) : [];
  const available: PublicMarket[] = [];
  const upcomingCountries: string[] = [];
  for (const row of list) {
    const country = typeof row?.country === "string" ? row.country.trim() : "";
    if (!country) continue;
    if (row.available) {
      available.push({
        country,
        market: typeof row.market === "string" && row.market.trim() ? row.market.trim() : country,
        educationLevels: labels(row.education_levels),
        subjects: labels(row.subjects),
      });
    } else {
      upcomingCountries.push(country);
    }
  }
  return { available, upcomingCountries };
}

// Server-side only. Cached for an hour so the public homepage stays fast and does not call the
// database per visitor. Failure returns null and the page falls back to static copy.
export async function getPublicMarkets(): Promise<PublicMarkets | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/qb_signup_markets`, {
      method: "POST",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
      body: "{}",
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;
    return toPublicMarkets(await response.json());
  } catch {
    return null;
  }
}
