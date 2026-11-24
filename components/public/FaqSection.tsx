import Disclosure from "./Disclosure";
import { faqJsonLd, faqsFor, type FaqPlace } from "@/lib/public/faq";

// Common questions as an accordion. `where` picks the list for the home page or an audience page.
export default function FaqSection({ where = "home", id = "faq" }: { where?: FaqPlace; id?: string }) {
  const items = faqsFor(where);
  return (
    <section id={id} className="qbp-sec qbp-alt" aria-labelledby={`${id}-title`} data-qb-section="faq">
      <div className="qbp-wrap" style={{ display: "grid", gap: 20, maxWidth: 860 }}>
        <div className="qbp-head" style={{ marginBottom: 0 }}>
          <p className="qbp-eyebrow">Questions</p>
          <h2 id={`${id}-title`} className="qbp-h2">Before you sign up</h2>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((f) => <Disclosure key={f.id} title={f.q}><p className="qbp-body" style={{ color: "#33415c" }}>{f.a}</p></Disclosure>)}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(items)).replace(/</g, "\\u003c") }} />
    </section>
  );
}
