import HomeSections from "@/components/HomeSections";
import SmeReviewWorkbench from "@/components/SmeReviewWorkbench";
import SmeWorkload from "@/components/SmeWorkload";
import SponsorCandidateReviews from "@/components/SponsorCandidateReviews";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
export default function ReviewPage() { return <><h1>SME Review Work</h1><HomeSections only={["sme","earnings","qa"]}/><SmeWorkload/><SmeReviewWorkbench/>{sponsorEngineEnabled(process.env) && <SponsorCandidateReviews/>}</>; }
