import type { Metadata } from "next";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import InterestForm from "@/components/public/InterestForm";
import { INSTITUTION_TYPES } from "@/lib/public/intake";

export const metadata: Metadata = { title: "Schools and institutions | QuizBox", description: "Register your school or institution's interest in QuizBox." };

export default function SchoolInterestPage() {
  return (
    <PublicShell>
      <PageIntro crumb="Schools" eyebrow="Organize · Support · Measure" title="Bring QuizBox to your school"
        lead="Teachers and classes on one platform, with reviewed, curriculum-linked content and participation across classes. Institutional access is set up by QuizBox after review." />
      <section className="qbp-wrap qbp-split" style={{ paddingBottom: 64, paddingTop: 16 }} data-qb-section="school-interest">
        <div className="qbp-card qbp-card-soft">
          <h2 className="qbp-h3">What schools get</h2>
          <ul className="qbp-list">
            <li>Teachers and classes under one school profile</li>
            <li>Reviewed, curriculum-linked content for every class</li>
            <li>Participation and performance across classes</li>
            <li>School teams in eligible competitions</li>
          </ul>
          <p className="qbp-meta">Teachers can already create their own account and run classes while your school&apos;s interest is reviewed.</p>
        </div>
        <div className="qbp-card">
          <h2 className="qbp-h3">Register school interest</h2>
          <InterestForm
            kind="school"
            submitLabel="Register interest"
            consentLabel="I agree that QuizBox may contact me about this interest. Registering interest does not create an institutional account."
            fields={[
              { name: "institution_name", label: "Institution name", type: "text", required: true, autoComplete: "organization", full: true },
              { name: "contact_person", label: "Contact person", type: "text", required: true, autoComplete: "name" },
              { name: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
              { name: "country", label: "Country", type: "text", required: true, autoComplete: "country-name" },
              { name: "institution_type", label: "Institution type", type: "select", options: INSTITUTION_TYPES, required: true },
              { name: "estimated_learners", label: "Estimated learners", type: "number" },
              { name: "message", label: "Message", type: "textarea" },
            ]}
          />
        </div>
      </section>
    </PublicShell>
  );
}
