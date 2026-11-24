import type { Metadata } from "next";
import AudiencePage from "@/components/public/AudiencePage";
import SponsorCompare from "@/components/public/SponsorCompare";
import { SPONSOR_GROUPS, SPONSOR_STAGES } from "@/components/public/SponsorSection";
import { PUBLIC_LINKS } from "@/components/public/links";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "For sponsors and alumni | QuizBox",
  description: "Sponsor a curriculum-aligned challenge for your old school or a community, choose who takes part, and follow participation and results.",
  alternates: { canonical: `${SITE_URL}/sponsors` },
  openGraph: { type: "website", siteName: "QuizBox", url: `${SITE_URL}/sponsors`, title: "Sponsor a QuizBox challenge", description: "Support learners with a curriculum-aligned challenge and follow what happens." },
};
export const revalidate = 300;

export default function SponsorsPage() {
  return (
    <AudiencePage id="sponsors" color="#9a5b00" eyebrow="For sponsors, alumni & organisations"
      title={<>Direct, measurable impact for your <span className="qbp-accent">school or community.</span></>}
      lead="Sponsor a curriculum-aligned challenge for the school you came from or a community you care about. Questions are built from approved curriculum material and reviewed by subject experts, and QuizBox approves each challenge before it goes live."
      primary={{ label: "Create a sponsor account", href: PUBLIC_LINKS.registerSponsor }} secondary={{ label: "Register sponsor interest", href: PUBLIC_LINKS.sponsor }}
      note="Registration is not approval: new sponsor accounts stay pending until QuizBox verifies them."
      benefitsTitle="What sponsors can do"
      benefits={[
        { title: "Choose who takes part", text: "Define the market, level, subject and the learners you want to reach." },
        { title: "Set the recognition", text: "Define approved prizes or recognition. Prizes are provided by the sponsor, not guaranteed by QuizBox." },
        { title: "Follow participation", text: "Registrations, completion and score distribution for your challenge." },
        { title: "See question results", text: "Question performance and results, and leaderboards where applicable." },
      ]}
      stepsTitle="Four stages from idea to recognition"
      steps={SPONSOR_STAGES.map((s) => ({ title: s.title, text: s.text }))}
      faq="sponsors"
      closing={{ title: "Support the learners you care about.", text: "Create a sponsor account to begin onboarding, or register your interest and we will contact you." }}>
      <section className="qbp-sec qbp-alt" aria-labelledby="sponsors-compare" data-qb-section="sponsors-compare">
        <div className="qbp-wrap" style={{ display: "grid", gap: 16 }}>
          <h2 id="sponsors-compare" className="qbp-h2">Why a QuizBox challenge</h2>
          <SponsorCompare />
        </div>
      </section>
      <section className="qbp-sec" aria-labelledby="sponsors-who" data-qb-section="sponsors-who">
        <div className="qbp-wrap" style={{ display: "grid", gap: 16 }}>
          <h2 id="sponsors-who" className="qbp-h2">Who can sponsor</h2>
          <p className="qbp-body">Individuals, alumni groups, foundations, NGOs, companies and other approved education partners. You don&apos;t need to be a large institution.</p>
          <div className="qbp-grid">{SPONSOR_GROUPS.map((g) => <div key={g.title} className="qbp-card"><h3 className="qbp-h3" style={{ fontSize: 16 }}>{g.title}</h3><p className="qbp-meta">{g.text}</p></div>)}</div>
        </div>
      </section>
    </AudiencePage>
  );
}
