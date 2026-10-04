import type { Metadata } from "next";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import InterestForm from "@/components/public/InterestForm";
import { getPublicMarkets } from "@/lib/public/signup-markets";

export const metadata: Metadata = { title: "Register country interest | QuizBox", description: "QuizBox opens country by country, each with its own approved curriculum. Register interest for your country." };

export default async function CountryInterestPage() {
  const markets = await getPublicMarkets();
  const available = markets?.available.map((m) => m.country) ?? [];
  return (
    <PublicShell>
      <PageIntro crumb="Countries" eyebrow="Global ready" title="Register interest for your country"
        lead="Each market runs on its own approved curriculum sources, question banks and market rules." />
      <section className="qbp-wrap qbp-split" style={{ paddingBottom: 64, paddingTop: 16 }} data-qb-section="country-interest" data-qb-source={markets ? "platform.markets" : "static"}>
        <div className="qbp-card qbp-card-soft">
          <h2 className="qbp-h3">Available now</h2>
          {available.length ? <div className="qbp-chips">{available.map((c) => <span key={c} className="qbp-tag">{c}</span>)}</div> : <p className="qbp-meta">Ghana</p>}
          {markets && markets.upcomingCountries.length > 0 && <>
            <h2 className="qbp-h3">Not yet available</h2>
            <p className="qbp-meta">{markets.upcomingCountries.join(" · ")}</p>
          </>}
        </div>
        <div className="qbp-card">
          <h2 className="qbp-h3">Register interest</h2>
          <InterestForm
            kind="country"
            submitLabel="Register interest"
            consentLabel="I agree that QuizBox may use these details to understand demand in my country."
            fields={[
              { name: "name", label: "Full name", type: "text", required: true, autoComplete: "name" },
              { name: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
              { name: "country", label: "Country", type: "text", required: true, autoComplete: "country-name" },
              { name: "role", label: "I am a", type: "select", options: ["Student", "Parent", "Teacher", "School / institution", "Sponsor", "Other"], required: true },
              { name: "curriculum", label: "Curriculum or education level", type: "text", full: true },
            ]}
          />
        </div>
      </section>
    </PublicShell>
  );
}
