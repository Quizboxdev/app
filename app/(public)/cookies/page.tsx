import LegalPlaceholder from "@/components/public/LegalPlaceholder";
import PolicyRoute, { policyMetadata } from "@/components/policies/PolicyRoute";

// The text comes from Admin, Policies. Until a version is published there, this notice shows and the page stays out of search results.
// Static and cached for five minutes; an earlier version (?v=2) is served by /policy-version/[slug] through middleware.ts (audit UX-030).
export const revalidate = 300;
export const generateMetadata = () => policyMetadata("cookies", "Cookies");
export default function CookiesPage() {
  return <PolicyRoute slug="cookies" fallback={<LegalPlaceholder title="Cookie and storage notice" crumb="Cookies" notice="QuizBox's cookie and storage notice is being finalized. Please contact us with any questions." />} />;
}
