import { OG_SIZE, ogCard } from "@/lib/share/og-card";

// The preview card for every page that has none of its own (audit UX-032).
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "QuizBox: Learn. Practise. Compete.";

export default function Image() {
  return ogCard({ eyebrow: "Learning · Assessment · Competition", title: "Learn. Practise. Compete.", detail: "Curriculum-aligned practice for Primary, JHS and SHS, reviewed by subject experts." });
}
