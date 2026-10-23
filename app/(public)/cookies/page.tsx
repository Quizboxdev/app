import LegalPlaceholder from "@/components/public/LegalPlaceholder";
import PolicyRoute, { policyMetadata } from "@/components/policies/PolicyRoute";

// The text comes from Admin, Policies. Until a version is published there, this notice shows and the page stays out of search results.
type Props = { searchParams: Promise<{ v?: string }> };
export const generateMetadata = ({ searchParams }: Props) => policyMetadata("cookies", "Cookies", searchParams);
export default function CookiesPage({ searchParams }: Props) {
  return <PolicyRoute slug="cookies" searchParams={searchParams} fallback={<LegalPlaceholder title="Cookie and storage notice" crumb="Cookies" notice="QuizBox's cookie and storage notice is being finalized. Please contact us with any questions." />} />;
}
