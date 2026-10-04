import type { Metadata } from "next";
import LegalPlaceholder from "@/components/public/LegalPlaceholder";

// LEGAL_CONTENT_REQUIRED: publication blocked until approved privacy notice text is supplied.
export const metadata: Metadata = { title: "Privacy | QuizBox", robots: { index: false, follow: true } };

export default function PrivacyPage() {
  return (
    <LegalPlaceholder
      title="Privacy"
      crumb="Privacy"
      notice="QuizBox's full privacy notice is being finalized. Please contact us for privacy-related enquiries."
    />
  );
}
