import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import InterestForm from "@/components/public/InterestForm";
import { PUBLIC_LINKS } from "@/components/public/links";
import { ENQUIRY_TYPES } from "@/lib/public/intake";

export const metadata: Metadata = { title: "Contact | QuizBox", description: "Contact QuizBox about sponsorship, schools, subject expert applications or general enquiries." };

const ROUTES = [
  { title: "Sponsor enquiry", text: "Support a curriculum-aligned challenge.", href: PUBLIC_LINKS.sponsor, cta: "Sponsor interest" },
  { title: "School / institution", text: "Bring your teachers and classes onto QuizBox.", href: PUBLIC_LINKS.school, cta: "School interest" },
  { title: "Subject expert (SME)", text: "Review content as a qualified educator.", href: PUBLIC_LINKS.sme, cta: "Apply as an SME" },
  { title: "Account support", text: "Trouble signing in? Reset your password.", href: "/auth/forgot-password", cta: "Reset password" },
];

export default function ContactPage() {
  return (
    <PublicShell>
      <PageIntro crumb="Contact" title="Contact QuizBox" lead="Choose the route that fits your enquiry." />
      <section className="qbp-wrap" style={{ paddingBottom: 64, display: "grid", gap: 24 }} data-qb-section="contact">
        <div className="qbp-grid">
          {ROUTES.map((r) => (
            <div key={r.title} className="qbp-card">
              <h2 className="qbp-h3">{r.title}</h2>
              <p className="qbp-meta">{r.text}</p>
              <Link className="qbp-link" href={r.href}>{r.cta}</Link>
            </div>
          ))}
        </div>
        <div className="qbp-card" style={{ maxWidth: 820 }}>
          <h2 className="qbp-h3">General enquiry</h2>
          <InterestForm
            kind="contact"
            submitLabel="Send enquiry"
            consentLabel="I agree that QuizBox may use these details to respond to my enquiry."
            fields={[
              { name: "name", label: "Full name", type: "text", required: true, autoComplete: "name" },
              { name: "email", label: "Email", type: "email", required: true, autoComplete: "email" },
              { name: "enquiry_type", label: "Enquiry type", type: "select", options: ENQUIRY_TYPES, required: true },
              { name: "country", label: "Country", type: "text", required: true, autoComplete: "country-name" },
              { name: "message", label: "Message", type: "textarea", required: true },
            ]}
          />
        </div>
      </section>
    </PublicShell>
  );
}
