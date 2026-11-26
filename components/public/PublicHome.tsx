import type { PublicMarkets } from "@/lib/public/signup-markets";
import type { PublicPlatformStats } from "@/lib/public/platform-stats";
import { showPublic } from "@/lib/public/visibility";
import PublicShell from "./PublicShell";
import HeroSection from "./HeroSection";
import PlatformStats from "./PlatformStats";
import RoleEcosystem from "./RoleEcosystem";
import StakeholderTabs from "./StakeholderTabs";
import FaqSection from "./FaqSection";
import GovernanceSection from "./GovernanceSection";
import StudentSection from "./StudentSection";
import ParentsSection from "./ParentsSection";
import TeacherSection from "./TeacherSection";
import SponsorSection from "./SponsorSection";
import SmeSection from "./SmeSection";
import SchoolsSection from "./SchoolsSection";
import ContentPipeline from "./ContentPipeline";
import CompetitionSection from "./CompetitionSection";
import InterschoolFeed from "@/components/interschool/Feed";
import type { PublicListing } from "@/lib/interschool/types";
import CurriculumSubjects from "./CurriculumSubjects";
import FinalCta from "./FinalCta";

export default function PublicHome({ markets, stats = null, competitions = [] }: { markets: PublicMarkets | null; stats?: PublicPlatformStats | null; competitions?: PublicListing[] }) {
  return (
    <PublicShell>
      <HeroSection />
      {showPublic("platform_stats") && <PlatformStats stats={stats} />}
      {showPublic("role_ecosystem") && <RoleEcosystem />}
      {showPublic("stakeholder_tabs") && <StakeholderTabs />}
      {showPublic("governance") && <GovernanceSection />}
      {showPublic("students") && <StudentSection />}
      {showPublic("parents") && <ParentsSection />}
      {showPublic("teachers") && <TeacherSection />}
      {showPublic("sponsors") && <SponsorSection />}
      {showPublic("reviewers") && <SmeSection />}
      {showPublic("schools") && <SchoolsSection />}
      {showPublic("content_pipeline") && <ContentPipeline />}
      {showPublic("competitions") && <CompetitionSection />}
      <InterschoolFeed items={competitions} surface="public" />
      {showPublic("curriculum_subjects") && <CurriculumSubjects markets={markets} />}
      {showPublic("faq") && <FaqSection where="home" />}
      {showPublic("final_cta") && <FinalCta />}
    </PublicShell>
  );
}
