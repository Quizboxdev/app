import { notFound } from "next/navigation";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
import SponsorWorkspace from "@/components/SponsorWorkspace";
export const dynamic = "force-dynamic";
export default function SponsorWorkspacePage() {
  if (!sponsorEngineEnabled(process.env)) notFound();
  return <SponsorWorkspace/>;
}
