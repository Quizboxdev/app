import { notFound } from "next/navigation";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
import CompetitionReviewAssignments from "@/components/CompetitionReviewAssignments";
export const dynamic = "force-dynamic";
export default function CompetitionAssignmentsPage() {
  if (!sponsorEngineEnabled(process.env)) notFound();
  return <CompetitionReviewAssignments/>;
}
