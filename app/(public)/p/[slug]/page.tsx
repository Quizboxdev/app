import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicShell from "@/components/public/PublicShell";
import PublicPost from "@/components/posts/PublicPost";
import { getPost } from "@/lib/posts/server";
import { flyerUrl, postUrl } from "@/lib/posts/presentation";
import { SITE_URL } from "@/lib/site";

// A marketing post (Admin, Posts). This is the address pasted into social media, email and WhatsApp, so the title, summary and flyer are what the link preview shows.
// A post that is switched back to draft stops opening at once (within a minute).
export const revalidate = 60;
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getPost((await params).slug);
  if (!post) return { title: "QuizBox", robots: { index: false, follow: true } };
  const url = postUrl(SITE_URL, post.slug), image = flyerUrl(post.flyer_path);
  return {
    title: `${post.title} | QuizBox`,
    description: post.summary,
    alternates: { canonical: url },
    openGraph: { type: "article", siteName: "QuizBox", url, title: post.title, description: post.summary, ...(image ? { images: [{ url: image, alt: post.flyer_alt || post.title }] } : {}) },
    twitter: { card: image ? "summary_large_image" : "summary", title: post.title, description: post.summary, ...(image ? { images: [image] } : {}) },
  };
}

export default async function PostPage({ params }: Props) {
  const post = await getPost((await params).slug);
  if (!post) notFound();
  return <PublicShell><PublicPost post={post} /></PublicShell>;
}
