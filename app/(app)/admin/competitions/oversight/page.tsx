import { notFound } from "next/navigation";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
import SponsorCompetitionOversight from "@/components/SponsorCompetitionOversight";
export const dynamic = "force-dynamic";
export default function OversightPage() {
  if (!sponsorEngineEnabled(process.env)) notFound();
  return <SponsorCompetitionOversight/>;
}
