import HomeSections from "@/components/HomeSections";
import SmeReviewWorkbench from "@/components/SmeReviewWorkbench";
import SmeWorkload from "@/components/SmeWorkload";
import SponsorCandidateReviews from "@/components/SponsorCandidateReviews";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
export default function ReviewPage() {
  return <>
    <div className="qb-page-head"><div><h1>SME review work</h1><p>Your review queue, quality record and earnings. Assignment never creates earnings; completed eligible reviews do.</p></div></div>
    <SmeWorkload/>
    <SmeReviewWorkbench/>
    <HomeSections only={["sme","earnings","qa"]}/>
    {sponsorEngineEnabled(process.env) && <SponsorCandidateReviews/>}
  </>;
}
