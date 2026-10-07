import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authCallbackHref, hasAuthLinkParams } from "@/lib/auth-links";
import PublicHome from "@/components/public/PublicHome";
import SessionGate from "@/components/public/SessionGate";
import { getPublicMarkets } from "@/lib/public/signup-markets";

export const metadata: Metadata = {
  title: "QuizBox — Learn, Practice & Compete",
  description:
    "QuizBox is a curriculum-aligned learning, assessment and competition platform for students, teachers, schools and sponsors, with content reviewed by qualified subject experts.",
  openGraph: {
    title: "QuizBox — Learn, Practice & Compete",
    description: "Curriculum-aligned practice, assessment and competitions, with SME-reviewed content.",
    images: [{ url: "/brand/quizbox-app-icon.png", width: 512, height: 512, alt: "QuizBox" }],
  },
};

// Supabase stores the browser session in sb-<project>-auth-token cookies (optionally chunked).
const SESSION_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

// Supabase sends email links to the Site URL (this page) when the requested redirect is not allow-listed: complete them in the callback.
export default async function RootPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (hasAuthLinkParams(params)) redirect(authCallbackHref(params));
  const [cookieStore, markets] = await Promise.all([cookies(), getPublicMarkets()]);
  const home = <PublicHome markets={markets} />;
  // Signed-out visitors get the server-rendered homepage. A session cookie hands off to the
  // existing bootstrapUser()/role routing without showing the homepage first.
  return cookieStore.getAll().some((c) => SESSION_COOKIE.test(c.name)) ? <SessionGate>{home}</SessionGate> : home;
}
