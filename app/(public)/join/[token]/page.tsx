import type { Metadata } from "next";
import JoinChild from "@/components/family/JoinChild";

// A child's single-use link. Never indexed, never passed on in a Referer header, and never cached: the address itself is the one-time secret.
export const metadata: Metadata = { title: "Open your QuizBox workspace", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinChild token={token} />;
}
