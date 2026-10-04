import type { Metadata } from "next";
import LegalPlaceholder from "@/components/public/LegalPlaceholder";

// LEGAL_CONTENT_REQUIRED: publication blocked until approved terms of use are supplied.
export const metadata: Metadata = { title: "Terms | QuizBox", robots: { index: false, follow: true } };

export default function TermsPage() {
  return (
    <LegalPlaceholder
      title="Terms of use"
      crumb="Terms"
      notice="QuizBox's full terms of use are being finalized. Please contact us for questions about platform use."
    />
  );
}
