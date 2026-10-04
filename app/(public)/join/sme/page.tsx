import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import InterestForm from "@/components/public/InterestForm";
import { PUBLIC_LINKS } from "@/components/public/links";
import { SME_COMPENSATION } from "@/components/public/SmeSection";

export const metadata: Metadata = { title: "Apply to become a QuizBox SME", description: "Qualified educators review QuizBox content before it reaches learners. Applications are evaluated against subject, market, curriculum and quality requirements." };

export default function SmeApplicationPage() {
  return (
    <PublicShell>
      <PageIntro crumb="Subject experts" eyebrow="Review · Verify · Improve" title="Apply to become a QuizBox SME"
        lead="Technology helps QuizBox scale content workflows. Qualified educators provide professional educational judgment before approved questions enter learning workflows." />
      <section className="qbp-wrap qbp-split" style={{ paddingBottom: 64, paddingTop: 16 }} data-qb-section="sme-application">
        <div style={{ display: "grid", gap: 16 }}>
          <div className="qbp-card">
            <h2 className="qbp-h3">Teachers: apply during account setup</h2>
            <p className="qbp-meta">Create a teacher account, then choose &ldquo;Apply to review content as a subject-matter expert&rdquo; during setup. Your application is recorded for review; no review access is granted until it is approved.</p>
            <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.registerSme}>Start a teacher SME application</Link></div>
          </div>
          <div className="qbp-card qbp-card-soft">
            <h2 className="qbp-h3">Who may apply</h2>
            <p className="qbp-meta">Teachers · retired teachers · examiners · curriculum specialists · lecturers · subject experts · qualified education professionals</p>
            <p className="qbp-meta">Applicants are evaluated against QuizBox subject, market, curriculum and quality requirements.</p>
            <h2 className="qbp-h3">Compensation</h2>
            <p className="qbp-meta">{SME_COMPENSATION} Being assigned an item does not by itself make it payable.</p>
          </div>
        </div>
        <div className="qbp-card">
          <h2 className="qbp-h3">Other education professionals</h2>
          <p className="qbp-meta">Examiners, lecturers, retired teachers and specialists who are not registering as teachers will be able to apply here soon.</p>
          <InterestForm
            kind="sme"
            submitLabel="Submit application"
            consentLabel="I agree that QuizBox may review these details and contact me about my application. Applying does not guarantee approval."
            fields={[
              { name: "full_name", label: "Full name", type: "text", required: true, autoComplete: "name" },
              { name: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
              { name: "country", label: "Country", type: "text", required: true, autoComplete: "country-name" },
              { name: "subjects", label: "Subject expertise", type: "text", required: true },
              { name: "education_levels", label: "Education levels", type: "text", required: true },
              { name: "professional_role", label: "Current or professional role", type: "text", required: true },
              { name: "years_experience", label: "Years of relevant experience", type: "number" },
              { name: "qualification_summary", label: "Short qualification summary", type: "textarea", required: true },
            ]}
          />
        </div>
      </section>
    </PublicShell>
  );
}
