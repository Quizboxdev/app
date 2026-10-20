import type { Metadata } from "next";
import PublicDetail, { detailMetadata } from "@/components/challenges/PublicDetail";

export const revalidate = 30;
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> { return detailMetadata((await params).slug, "CHALLENGE"); }
export default async function ChallengePage({ params }: Props) { return <PublicDetail slug={(await params).slug} format="CHALLENGE" />; }
