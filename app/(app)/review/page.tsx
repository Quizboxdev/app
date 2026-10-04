import HomeSections from "@/components/HomeSections";
import DashboardHero from "@/components/DashboardHero";
import SmeReviewWorkbench from "@/components/SmeReviewWorkbench";
import SmeWorkload from "@/components/SmeWorkload";
import SponsorCandidateReviews from "@/components/SponsorCandidateReviews";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
export default function ReviewPage() {
  return <>
    <div className="qb-page-head"><div><h1>SME review work</h1><p>Your review queue, quality record and earnings. Assignment never creates earnings; completed eligible reviews do.</p></div></div>
    <DashboardHero eyebrow="SME workspace" title="Human review keeps content defensible." description="Work through assigned reviews and track quality outcomes." primary={{ label: "Open review queue", href: "#review-queue" }} secondary={{ label: "View quality and workload", href: "#review-quality" }} />
    <div id="review-quality" className="qb-anchor"><SmeWorkload/></div>
    <div id="review-queue" className="qb-anchor"><SmeReviewWorkbench/></div>
    <HomeSections only={["sme","earnings","qa"]}/>
    {sponsorEngineEnabled(process.env) && <SponsorCandidateReviews/>}
  </>;
}
