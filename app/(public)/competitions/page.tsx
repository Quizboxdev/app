import type { Metadata } from "next";
import PublicList from "@/components/challenges/PublicList";
import InterschoolFeed from "@/components/interschool/Feed";
import { listPublicCompetitions } from "@/lib/interschool/server";

export const metadata: Metadata = { title: "Competitions | QuizBox", description: "Competitions with rounds: the best players go through to the next round until a winner is found." };
export const revalidate = 60;
export default async function CompetitionsPage() { return <PublicList format="COMPETITION" after={<InterschoolFeed items={await listPublicCompetitions(6)} surface="public" />} />; }
