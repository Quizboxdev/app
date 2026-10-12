import type { PublicMarkets } from "@/lib/public/signup-markets";
import type { PublicPlatformStats } from "@/lib/public/platform-stats";
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
      <PlatformStats stats={stats} />
      <RoleEcosystem />
      <GovernanceSection />
      <StudentSection />
      <TeacherSection />
      <SponsorSection />
      <SmeSection />
      <SchoolsSection />
      <ContentPipeline />
      <CompetitionSection />
      <CurriculumSubjects markets={markets} />
      <FinalCta />
    </PublicShell>
  );
}
