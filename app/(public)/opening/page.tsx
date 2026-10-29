import type { Metadata } from "next";
import PublicHome from "@/components/public/PublicHome";
import SessionGate from "@/components/public/SessionGate";
import { getPublicMarkets } from "@/lib/public/signup-markets";
import { getPublicPlatformStats } from "@/lib/public/platform-stats";

// Served by middleware.ts in place of "/" when the request carries a Supabase session cookie. The cookie is a hint, not proof: SessionGate verifies the
// session and routes by role; a stale session falls back to the public home page. Never linked, never indexed.
export const metadata: Metadata = { title: "Opening QuizBox", robots: { index: false, follow: false } };
export const revalidate = 300;

export default async function OpeningPage() {
  const [markets, stats] = await Promise.all([getPublicMarkets(), getPublicPlatformStats()]);
  return <SessionGate><PublicHome markets={markets} stats={stats} /></SessionGate>;
}
