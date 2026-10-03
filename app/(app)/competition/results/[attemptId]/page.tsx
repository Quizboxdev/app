import { notFound } from "next/navigation";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
import AttemptReviewPage from "@/app/(app)/student/results/[attemptId]/page";
export const dynamic = "force-dynamic";
export default function CompetitionResultPage() {
  if (!sponsorEngineEnabled(process.env)) notFound();
  return <AttemptReviewPage/>;
}
