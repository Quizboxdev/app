import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PolicyPage from "@/components/policies/PolicyPage";
import { policyMetadata } from "@/components/policies/PolicyRoute";
import { getPolicy } from "@/lib/policies/server";

// An earlier or draft version of a policy (/terms?v=2). middleware.ts serves this page for those requests so that /terms, /privacy, /refunds and /cookies
// themselves can be static and cached (audit UX-030). The address in the browser does not change.
const TITLES: Record<string, string> = { terms: "Terms", privacy: "Privacy", refunds: "Refund policy", cookies: "Cookies" };
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string }> };
const versionOf = (raw?: string) => { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : undefined; };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  return policyMetadata(slug, TITLES[slug] ?? "Policy", searchParams);
}

export default async function PolicyVersionPage({ params, searchParams }: Props) {
  const { slug } = await params;
  if (!TITLES[slug]) notFound();
  const policy = await getPolicy(slug, versionOf((await searchParams).v));
  if (!policy) notFound();
  return <PolicyPage policy={policy} base={`/${slug}`} />;
}
