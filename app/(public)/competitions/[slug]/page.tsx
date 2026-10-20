import type { Metadata } from "next";
import PublicDetail, { detailMetadata } from "@/components/challenges/PublicDetail";

export const revalidate = 30;
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { return detailMetadata((await params).slug, "COMPETITION"); }
export default async function CompetitionPage({ params }: Props) { return <PublicDetail slug={(await params).slug} format="COMPETITION" />; }
