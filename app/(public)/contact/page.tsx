import type { Metadata } from "next";
import Link from "next/link";
import PublicShell from "@/components/public/PublicShell";
import PageIntro from "@/components/public/PageIntro";
import ContactFormWithType from "@/components/public/ContactFormWithType";
import { PUBLIC_LINKS } from "@/components/public/links";

export const metadata: Metadata = { title: "Contact | QuizBox", description: "Contact QuizBox about sponsorship, schools, subject expert applications or general enquiries." };

const ROUTES = [
  { title: "Sponsor enquiry", text: "Support a curriculum-aligned challenge.", href: PUBLIC_LINKS.sponsor, cta: "Sponsor interest" },
  { title: "School / institution", text: "Bring your teachers and classes onto QuizBox.", href: PUBLIC_LINKS.school, cta: "School interest" },
  { title: "Subject expert (SME)", text: "Review content as a qualified educator.", href: PUBLIC_LINKS.sme, cta: "Apply as an SME" },
  { title: "Account support", text: "Trouble signing in? Reset your password.", href: "/auth/forgot-password", cta: "Reset password" },
];

export const revalidate = 3600;

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
          <h2 className="qbp-h3">Send us a message</h2>
          <p className="qbp-meta">For general questions, account help, and payments or refunds. You can attach screenshots or a PDF. Sponsors, schools and subject experts: please use the forms above.</p>
          <ContactFormWithType />
        </div>
      </section>
    </PublicShell>
  );
}
