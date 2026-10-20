import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import { PUBLIC_LINKS } from "@/components/public/links";
import { PLANS } from "@/lib/payments/plans";

export const metadata: Metadata = { title: "Pricing | QuizBox", description: "QuizBox plans for learners, schools and challenge hosts. Prices will be announced here." };

// Placeholder before the pricing table is connected: names and what each option includes, "Price to be announced" everywhere, and no payment call.
// When the backend pricing table exists this page reads the active rows instead of the plan file (docs/payments/PRICING_TABLE_PLAN.md).
const EXTRA = [
  { id: "challenges", name: "Challenges and campaigns", audience: "Hosts and sponsors", period: "campaign",
    includes: ["Run a public or private challenge", "Rounds, prizes and your own branding", "Results and participation reports"] },
];

export default function PricingPage() {
  const items = [...PLANS.map((p) => ({ id: p.id, name: p.name, audience: p.audience, period: p.period, includes: p.includes })), ...EXTRA];
  return (
    <PublicShell>
      <PageIntro crumb="Pricing" title="Pricing" lead="Simple plans for learners, schools and challenge hosts. We are finalising prices and will publish them here." />
      <section className="qbp-wrap" style={{ paddingBottom: 64, display: "grid", gap: 24 }} data-qb-section="pricing">
        <div className="qbp-grid">
          {items.map((p) => (
            <div key={p.id} className="qbp-card">
              <p className="qbp-meta">{p.audience}</p>
              <h2 className="qbp-h3">{p.name}</h2>
              <p><strong>Price to be announced</strong></p>
              <ul>{p.includes.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className="qbp-meta">Nothing is charged today. To be told when plans open, or to ask for a quote for a school or a challenge, <Link className="qbp-link" href={PUBLIC_LINKS.contact}>contact QuizBox</Link>.</p>
      </section>
    </PublicShell>
  );
}
