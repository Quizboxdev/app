import type { Metadata } from "next";
import PublicHome from "@/components/public/PublicHome";
import { getPublicMarkets } from "@/lib/public/signup-markets";
import { getPublicPlatformStats } from "@/lib/public/platform-stats";

export const metadata: Metadata = {
  title: "QuizBox — Learn. Practise. Compete.",
  description:
    "QuizBox is a curriculum-aligned learning, assessment and competition platform for students, teachers, schools and sponsors, with content reviewed by qualified subject experts.",
  alternates: { canonical: "/" },
  twitter: { card: "summary_large_image" },
  openGraph: {
    url: "/",
    title: "QuizBox — Learn. Practise. Compete.",
    description: "Curriculum-aligned practice, assessment and competitions, with SME-reviewed content.",
  },
};

// The home page is static and refreshed every five minutes, so it comes from the edge cache (audit UX-030). The two things that used to make it
// dynamic now happen in middleware.ts before the page is chosen: an email-link result in the URL is forwarded to the auth callback, and a request
// that carries a Supabase session cookie is served /opening (the same page behind the session gate, so signed-in users never see the home page flash).
export const revalidate = 300;

export default async function RootPage() {
  const [markets, stats] = await Promise.all([getPublicMarkets(), getPublicPlatformStats()]);
  return <PublicHome markets={markets} stats={stats} />;
}
