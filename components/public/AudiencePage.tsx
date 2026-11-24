import Link from "next/link";
import PublicShell from "./PublicShell";
import FaqSection from "./FaqSection";
import type { FaqPlace } from "@/lib/public/faq";

export type AudienceCta = { label: string; href: string };
export type AudiencePageProps = {
  eyebrow: string; color: string; id: string; title: React.ReactNode; lead: string; primary: AudienceCta; secondary?: AudienceCta; note?: React.ReactNode;
  benefitsTitle: string; benefits: { title: string; text: string }[];
  stepsTitle: string; steps: { title: string; text: string }[];
  faq?: FaqPlace; closing: { title: string; text: string }; children?: React.ReactNode;
};

// One landing page for one audience (teachers, schools, sponsors): a hero, what you get, how it starts, optional extra sections, the questions that audience asks, and a closing call to action.
// Wording on these pages follows the same rule as the home page: only what the product and its sources support. No figures, no plan names, no promises about results.
export default function AudiencePage(p: AudiencePageProps) {
  return (
    <PublicShell>
      <section className="qbp-wrap qbp-hero" aria-labelledby={`${p.id}-hero`} data-qb-section={`${p.id}-hero`} style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div className="qbp-hero-copy">
          <p className="qbp-eyebrow" style={{ color: p.color }}>{p.eyebrow}</p>
          <h1 id={`${p.id}-hero`} className="qbp-h1">{p.title}</h1>
          <p className="qbp-lead">{p.lead}</p>
          <div className="qbp-actions">
            <Link className="qbp-btn" href={p.primary.href} prefetch>{p.primary.label}</Link>
            {p.secondary && <Link className="qbp-btn2" href={p.secondary.href}>{p.secondary.label}</Link>}
          </div>
          {p.note && <p className="qbp-meta">{p.note}</p>}
        </div>
      </section>

      <section className="qbp-sec qbp-alt" aria-labelledby={`${p.id}-benefits`} data-qb-section={`${p.id}-benefits`}>
        <div className="qbp-wrap" style={{ display: "grid", gap: 16 }}>
          <h2 id={`${p.id}-benefits`} className="qbp-h2">{p.benefitsTitle}</h2>
          <ul className="qbp-grid" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {p.benefits.map((b) => <li key={b.title} className="qbp-card" style={{ borderTop: `3px solid ${p.color}` }}><h3 className="qbp-h3">{b.title}</h3><p className="qbp-meta" style={{ fontSize: 14 }}>{b.text}</p></li>)}
          </ul>
        </div>
      </section>

      <section className="qbp-sec" aria-labelledby={`${p.id}-steps`} data-qb-section={`${p.id}-steps`}>
        <div className="qbp-wrap" style={{ display: "grid", gap: 16 }}>
          <h2 id={`${p.id}-steps`} className="qbp-h2">{p.stepsTitle}</h2>
          <ol className="qbp-stages" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {p.steps.map((s) => <li key={s.title} className="qbp-card"><span className="qbp-step" style={{ color: p.color }}>{s.title}</span><p className="qbp-meta" style={{ fontSize: 14 }}>{s.text}</p></li>)}
          </ol>
        </div>
      </section>

      {p.children}

      {p.faq && <FaqSection where={p.faq} id={`${p.id}-faq`} />}

      <section className="qbp-sec" aria-labelledby={`${p.id}-cta`} data-qb-section={`${p.id}-cta`}>
        <div className="qbp-wrap" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
          <div style={{ display: "grid", gap: 6, flex: "1 1 420px", minWidth: 0 }}>
            <h2 id={`${p.id}-cta`} className="qbp-h2">{p.closing.title}</h2>
            <p className="qbp-body">{p.closing.text}</p>
          </div>
          <div className="qbp-actions">
            <Link className="qbp-btn" href={p.primary.href} prefetch>{p.primary.label}</Link>
            {p.secondary && <Link className="qbp-btn2" href={p.secondary.href}>{p.secondary.label}</Link>}
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
