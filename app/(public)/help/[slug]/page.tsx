import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import HelpArticleView from "@/components/help/HelpArticleView";
import { getHelpArticle, getHelpList } from "@/lib/help/server";
import { SITE_URL } from "@/lib/site";
import { getPublicHelpArticle, helpCentreEnabled } from "@/lib/help/presentation";
import PublicHelpArticle from "@/components/help/PublicHelpArticle";
import HelpArticleError from "@/components/help/HelpArticleError";

export const revalidate = 60;
type Props = { params: Promise<{ slug: string }> };

// Build every published guide ahead of time so it comes from the edge cache (audit UX-030). A guide published later is built on its first visit.
export async function generateStaticParams() { return (await getHelpList()).map((g) => ({ slug: g.slug })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const d = await getHelpArticle((await params).slug);
  if (!d) return { title: "Help | QuizBox", robots: { index: false, follow: true } };
  return { title: `${d.article.title} | QuizBox Help`, description: d.article.summary, alternates: { canonical: `${SITE_URL}/help/${d.article.slug}` } };
}

export default async function HelpArticlePage({ params }: Props) {
  const slug = (await params).slug;
  if (await helpCentreEnabled()) {
    const state = await getPublicHelpArticle(slug);
    if (state.status === "not-found") notFound();
    return <PublicShell>{state.status === "error" ? <HelpArticleError /> : <PublicHelpArticle detail={state.detail} />}</PublicShell>;
  }
  const d = await getHelpArticle(slug);
  if (!d) notFound();
  return (
    <PublicShell>
      <PageIntro crumb="Help" title={d.article.title} lead={d.article.summary} />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }} data-qb-section="help-article"><HelpArticleView detail={d} inApp={false} /></section>
    </PublicShell>
  );
}
