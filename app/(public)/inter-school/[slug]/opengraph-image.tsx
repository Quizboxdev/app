import { OG_SIZE, ogCard } from "@/lib/share/og-card";
import { clampText } from "@/lib/share/og-text";
import { getPublicCompetition } from "@/lib/interschool/server";
import { day } from "@/lib/interschool/text";

// The preview card of a shared campaign link. A competition that is not public gets the general QuizBox card.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "A QuizBox inter-school competition";
export const revalidate = 300;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const c = await getPublicCompetition((await params).slug);
  if (!c) return ogCard({ eyebrow: "Inter-school", title: "Take part on QuizBox", detail: "Quiz competitions between schools." });
  return ogCard({ eyebrow: c.sponsor_name ? clampText(`Sponsored by ${c.sponsor_name}`, 60) : "Inter-school competition", title: clampText(c.title, 80),
    detail: clampText(`${c.divisions.map((d) => d.title).join(", ")} · Register by ${day(c.registration_closes_at)}`, 90) });
}
