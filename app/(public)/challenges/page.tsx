import type { Metadata } from "next";
import PublicList from "@/components/challenges/PublicList";

export const metadata: Metadata = { title: "Challenges | QuizBox", description: "Timed quiz challenges open to everyone. Play, score on the server, and see where you rank." };
export const revalidate = 60;
export default function ChallengesPage() { return <PublicList format="CHALLENGE" />; }
