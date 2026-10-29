import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import PricingCards from "@/components/pricing/PricingCards";
import { PUBLIC_LINKS } from "@/components/public/links";
import { getPrices } from "@/lib/pricing/server";

export const metadata: Metadata = { title: "Pricing | QuizBox", description: "QuizBox plans for learners, teachers, schools, sponsors and companies." };
export const revalidate = 60;

// The cards come from the admin-managed price list. A price that has not been set shows "Price to be announced"; a card with a payment link sends the buyer to the gateway.
export default async function PricingPage() {
  const rows = await getPrices();
  const anyPriced = rows.some((r) => r.price_minor !== null && r.price_minor > 0);
  return (
    <PublicShell>
      <PageIntro crumb="Pricing" title="Pricing" lead="Simple plans for learners, teachers, schools, sponsors and companies. Start free: everyone gets free sessions when they sign up." />
      <section className="qbp-wrap" style={{ paddingBottom: 64, display: "grid", gap: 24 }} data-qb-section="pricing">
        <PricingCards rows={rows} variant="public" registerHref={PUBLIC_LINKS.register} subscribeHref="/subscribe" />
        <p className="qbp-meta">{anyPriced ? "Prices are in Ghana cedis." : "Some prices are still being finalised."} To ask about a school plan, or to run a branded quiz for your company, <Link className="qbp-link" href={PUBLIC_LINKS.contact}>contact QuizBox</Link>.</p>
      </section>
    </PublicShell>
  );
}
