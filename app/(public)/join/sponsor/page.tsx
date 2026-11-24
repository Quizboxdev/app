import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import InterestForm from "@/components/public/InterestForm";
import { PUBLIC_LINKS } from "@/components/public/links";
import { SPONSOR_GROUPS } from "@/components/public/SponsorSection";
import SponsorCompare from "@/components/public/SponsorCompare";
import { SPONSOR_TYPES } from "@/lib/public/intake";

export const metadata: Metadata = { title: "Sponsor with QuizBox", description: "Support curriculum-aligned challenges for the learners you care about. Sponsor onboarding is subject to QuizBox approval." };

export default function SponsorInterestPage() {
  return (
    <PublicShell>
      <PageIntro crumb="Sponsors" eyebrow="Support · Challenge · Recognise" title="Direct, measurable academic impact for your school or community"
        lead="Sponsor curriculum-aligned challenges for the school you came from or a community you care about. Questions are built from approved curriculum material and reviewed by subject experts, and each challenge is approved by QuizBox before it goes live." />
      <section className="qbp-wrap" style={{ paddingTop: 16, paddingBottom: 24, display: "grid", gap: 12 }} data-qb-section="sponsor-compare">
        <h2 className="qbp-h2" style={{ fontSize: 22 }}>Why a QuizBox challenge</h2>
        <SponsorCompare />
        <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.registerSponsor}>Create a sponsor account</Link><a className="qbp-btn2" href="#sponsor-interest-form">Register sponsor interest</a></div>
      </section>
      <section className="qbp-wrap qbp-split" style={{ paddingBottom: 64, paddingTop: 16 }} data-qb-section="sponsor-interest">
        <div style={{ display: "grid", gap: 16 }}>
          <div className="qbp-card">
            <h2 className="qbp-h3">Begin sponsor onboarding</h2>
            <p className="qbp-meta">Register your organization to start onboarding. Registration is not approval: new sponsor accounts remain pending until QuizBox verifies them, and each competition is approved before it goes live.</p>
            <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.registerSponsor}>Begin sponsor onboarding</Link></div>
          </div>
          <div className="qbp-card qbp-card-soft">
            <h2 className="qbp-h3">Who sponsors</h2>
            <ul className="qbp-list">{SPONSOR_GROUPS.map((g) => <li key={g.title}><strong>{g.title}</strong>: {g.text}</li>)}</ul>
          </div>
        </div>
        <div className="qbp-card" id="sponsor-interest-form">
          <h2 className="qbp-h3">Register sponsor interest</h2>
          <p className="qbp-meta">Not ready to begin onboarding? Soon you will be able to tell us what you would like to support.</p>
          <InterestForm
            kind="sponsor"
            submitLabel="Register interest"
            consentLabel="I agree that QuizBox may contact me about this sponsorship interest. Registering interest does not guarantee acceptance."
            fields={[
              { name: "name", label: "Full name", type: "text", required: true, autoComplete: "name" },
              { name: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
              { name: "phone", label: "Phone", type: "tel", autoComplete: "tel" },
              { name: "sponsor_type", label: "Sponsor type", type: "select", options: SPONSOR_TYPES, required: true },
              { name: "organization", label: "Organization", type: "text", autoComplete: "organization" },
              { name: "country", label: "Country", type: "text", required: true, autoComplete: "country-name" },
              { name: "intended_audience", label: "Learners you want to reach", type: "text", full: true },
              { name: "interest_summary", label: "What would you like to support?", type: "textarea", required: true },
            ]}
          />
        </div>
      </section>
    </PublicShell>
  );
}
