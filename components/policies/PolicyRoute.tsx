import type { Metadata } from "next";
import type { ReactNode } from "react";
import PolicyPage from "@/components/policies/PolicyPage";
import { getPolicy } from "@/lib/policies/server";

// Shared by /terms, /privacy, /refunds and /cookies: the published version from the policy section, or the page's built-in text when nothing is published yet.
type Search = Promise<{ v?: string }>;
const versionOf = async (searchParams?: Search) => { const n = Number((await searchParams)?.v); return Number.isInteger(n) && n > 0 ? n : undefined; };

export async function policyMetadata(slug: string, title: string, searchParams?: Search): Promise<Metadata> {
  const p = await getPolicy(slug, await versionOf(searchParams));
  if (!p) return { title: `${title} | QuizBox`, robots: { index: false, follow: true } };
  return { title: `${p.title} | QuizBox`, description: `${p.title}, version ${p.version_no}.`, robots: p.state === "published" ? { index: true, follow: true } : { index: false, follow: true } };
}

export default async function PolicyRoute({ slug, searchParams, fallback }: { slug: string; searchParams?: Search; fallback: ReactNode }) {
  const policy = await getPolicy(slug, await versionOf(searchParams));
  return policy ? <PolicyPage policy={policy} base={`/${slug}`} /> : <>{fallback}</>;
}
