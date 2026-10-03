import { notFound } from "next/navigation";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
import AttemptPage from "@/app/(app)/student/attempt/[id]/page";
export const dynamic = "force-dynamic";
export default function CompetitionAttemptPage() {
  if (!sponsorEngineEnabled(process.env)) notFound();
  return <AttemptPage/>;
}
