import type { Metadata } from "next";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import HelpHome from "@/components/help/HelpHome";
import { getHelpList } from "@/lib/help/server";
import HelpCentre from "@/components/help/HelpCentre";
import { getHelpCentreArticles, helpCentreEnabled } from "@/lib/help/presentation";

export const metadata: Metadata = { title: "Help | QuizBox", description: "Simple guides for learners, teachers, schools and sponsors: practice, classes, assignments, challenges, competitions, payments and more." };
export const revalidate = 60;

// The public Help centre: search and guides, the same text as inside the app. Managed in Admin, Help.
export default async function HelpPage() {
  if (await helpCentreEnabled()) {
    const state = await getHelpCentreArticles();
    return <PublicShell><HelpCentre {...state} /></PublicShell>;
  }
  const guides = await getHelpList();
  return (
    <PublicShell>
      <PageIntro crumb="Help" title="Help" lead="Simple guides for learners, teachers, schools and sponsors. Search, or choose a topic." />
      <section className="qbp-wrap" style={{ paddingBottom: 64 }} data-qb-section="help">
        <HelpHome guides={guides} base="/help" audience={null} inApp={false} />
      </section>
    </PublicShell>
  );
}
