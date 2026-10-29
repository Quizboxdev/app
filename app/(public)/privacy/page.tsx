import LegalPlaceholder from "@/components/public/LegalPlaceholder";
import PolicyRoute, { policyMetadata } from "@/components/policies/PolicyRoute";

// The text comes from Admin, Policies. Until a version is published there, this notice shows and the page stays out of search results.
// Static and cached for five minutes; an earlier version (?v=2) is served by /policy-version/[slug] through middleware.ts (audit UX-030).
export const revalidate = 300;
export const generateMetadata = () => policyMetadata("privacy", "Privacy");
export default function PrivacyPage() {
  return <PolicyRoute slug="privacy" fallback={<LegalPlaceholder title="Privacy" crumb="Privacy" notice="QuizBox's full privacy notice is being finalized. Please contact us for privacy-related enquiries." />} />;
}
