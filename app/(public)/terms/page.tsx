import LegalPlaceholder from "@/components/public/LegalPlaceholder";
import PolicyRoute, { policyMetadata } from "@/components/policies/PolicyRoute";

// The text comes from Admin, Policies. Until a version is published there, this notice shows and the page stays out of search results.
type Props = { searchParams: Promise<{ v?: string }> };
export const generateMetadata = ({ searchParams }: Props) => policyMetadata("terms", "Terms", searchParams);
export default function TermsPage({ searchParams }: Props) {
  return <PolicyRoute slug="terms" searchParams={searchParams} fallback={<LegalPlaceholder title="Terms of use" crumb="Terms" notice="QuizBox's full terms of use are being finalized. Please contact us for questions about platform use." />} />;
}
