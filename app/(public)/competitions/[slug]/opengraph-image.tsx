import { OG_SIZE, ogCard } from "@/lib/share/og-card";
import { clampText } from "@/lib/share/og-text";
import { getPublicChallenge } from "@/lib/challenges/server";

// Preview card for a shared competition link. Only public competitions get their own title; a private, unlisted or missing one gets the general QuizBox card,
// so nothing private leaks into a preview (audit UX-032).
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A QuizBox competition";
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getPublicChallenge((await params).slug);
  if (!c || c.private || c.visibility !== "PUBLIC") return ogCard({ eyebrow: "Competition", title: "Take part on QuizBox", detail: "Curriculum-aligned questions for Primary, JHS and SHS." });
  const organiser = c.brand?.organiser_name ? `by ${c.brand.organiser_name} · ` : "";
  return ogCard({
    eyebrow: "Competition",
    title: clampText(c.title, 80),
    detail: clampText(`${organiser}${c.question_count} questions, ${Math.round(c.time_limit_seconds / 60)} minutes`, 90),
    accent: c.brand?.accent && /^#[0-9a-fA-F]{6}$/.test(c.brand.accent) ? c.brand.accent : "#2563eb",
  });
}
