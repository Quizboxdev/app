import { OG_SIZE, ogCard } from "@/lib/share/og-card";

// The preview card for the home page and the public pages. It sits beside the home page because that page sets its own openGraph block, which would otherwise drop the card inherited from the root (audit UX-032).
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "QuizBox: Learn. Practise. Compete.";

export default function Image() {
  return ogCard({ eyebrow: "Learning · Assessment · Competition", title: "Learn. Practise. Compete.", detail: "Curriculum-aligned practice for Primary, JHS and SHS, reviewed by subject experts." });
}
