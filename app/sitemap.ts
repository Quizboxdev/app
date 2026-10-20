import type { MetadataRoute } from "next";
import { PUBLIC_PATHS, SITE_URL } from "@/lib/site";
import { listPublicChallenges } from "@/lib/challenges/server";

// Public pages plus every live public challenge. Private, unlisted and draft campaigns never appear: the database only returns live public ones.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = PUBLIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path.startsWith("/join") ? 0.8 : 0.4,
  }));
  const [challenges, competitions] = await Promise.all([listPublicChallenges("CHALLENGE"), listPublicChallenges("COMPETITION")]);
  return [...pages, { url: `${SITE_URL}/challenges`, changeFrequency: "daily", priority: 0.7 }, { url: `${SITE_URL}/competitions`, changeFrequency: "daily", priority: 0.7 },
    ...competitions.map((c) => ({ url: `${SITE_URL}/competitions/${c.slug}`, changeFrequency: "daily" as const, priority: 0.6 })), ...challenges.map((c) => ({ url: `${SITE_URL}/challenges/${c.slug}`, changeFrequency: "daily" as const, priority: 0.6 }))];
}
