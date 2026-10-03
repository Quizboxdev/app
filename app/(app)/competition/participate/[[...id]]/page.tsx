import { notFound } from "next/navigation";
import { sponsorEngineEnabled } from "@/lib/competition/local-gate";
import CompetitionParticipation from "@/components/CompetitionParticipation";
export const dynamic = "force-dynamic";
export default async function ParticipationPage({ params }: { params: Promise<{ id?: string[] }> }) {
  if (!sponsorEngineEnabled(process.env)) notFound();
  const { id } = await params;
  if (id && (id.length !== 1 || !/^[0-9a-f-]{36}$/i.test(id[0]))) notFound();
  return <CompetitionParticipation competition={id?.[0]}/>;
}
