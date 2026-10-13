import type { PublicMarkets } from "@/lib/public/signup-markets";
import type { PublicPlatformStats } from "@/lib/public/platform-stats";
import { showPublic } from "@/lib/public/visibility";
import PublicShell from "./PublicShell";
import HeroSection from "./HeroSection";
import PlatformStats from "./PlatformStats";
import RoleEcosystem from "./RoleEcosystem";
import GovernanceSection from "./GovernanceSection";
import StudentSection from "./StudentSection";
import TeacherSection from "./TeacherSection";
import SponsorSection from "./SponsorSection";
import SmeSection from "./SmeSection";
import SchoolsSection from "./SchoolsSection";
import ContentPipeline from "./ContentPipeline";
import CompetitionSection from "./CompetitionSection";
import CurriculumSubjects from "./CurriculumSubjects";
import FinalCta from "./FinalCta";

export default function PublicHome({ markets, stats = null }: { markets: PublicMarkets | null; stats?: PublicPlatformStats | null }) {
  return (
    <PublicShell>
      <HeroSection />
      {showPublic("platform_stats") && <PlatformStats stats={stats} />}
      {showPublic("role_ecosystem") && <RoleEcosystem />}
      {showPublic("governance") && <GovernanceSection />}
      {showPublic("students") && <StudentSection />}
      {showPublic("teachers") && <TeacherSection />}
      {showPublic("sponsors") && <SponsorSection />}
      {showPublic("reviewers") && <SmeSection />}
      {showPublic("schools") && <SchoolsSection />}
      {showPublic("content_pipeline") && <ContentPipeline />}
      {showPublic("competitions") && <CompetitionSection />}
      {showPublic("curriculum_subjects") && <CurriculumSubjects markets={markets} />}
      {showPublic("final_cta") && <FinalCta />}
    </PublicShell>
  );
}
