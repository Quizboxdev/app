import LegalPlaceholder from "@/components/public/LegalPlaceholder";
import PolicyRoute, { policyMetadata } from "@/components/policies/PolicyRoute";

// The text comes from Admin, Policies. Until a version is published there, this notice shows and the page stays out of search results.
type Props = { searchParams: Promise<{ v?: string }> };
export const generateMetadata = ({ searchParams }: Props) => policyMetadata("privacy", "Privacy", searchParams);
export default function PrivacyPage({ searchParams }: Props) {
  return <PolicyRoute slug="privacy" searchParams={searchParams} fallback={<LegalPlaceholder title="Privacy" crumb="Privacy" notice="QuizBox's full privacy notice is being finalized. Please contact us for privacy-related enquiries." />} />;
}
