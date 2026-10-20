import type { Metadata } from "next";
import PublicList from "@/components/challenges/PublicList";

export const metadata: Metadata = { title: "Competitions | QuizBox", description: "Competitions with rounds: the best players go through to the next round until a winner is found." };
export const revalidate = 60;
export default function CompetitionsPage() { return <PublicList format="COMPETITION" />; }
