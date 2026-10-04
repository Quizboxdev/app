import Disclosure from "./Disclosure";

const PILLARS = [
  { title: "Market governance", text: "Each country runs under its own market rules and availability." },
  { title: "Curriculum governance", text: "Content is organized by the curriculum, level, grade and subject of each market." },
  { title: "Approved source control", text: "Questions trace back to approved curriculum sources." },
  { title: "SME and QA oversight", text: "Qualified reviewers and quality checks approve content before use." },
  { title: "Competition governance", text: "Sponsors and competitions are approved before they go live." },
  { title: "Auditability", text: "Review decisions and content changes are recorded." },
];

const CONTROLS = [
  { title: "Sponsor defines", items: ["Purpose", "Target audience", "Competition", "Approved rewards and recognition"], color: "var(--orange)" },
  { title: "Content system controls", items: ["Curriculum context", "Source provenance", "Question workflow"], color: "var(--blue)" },
  { title: "SME / QA controls", items: ["Educational review", "Accuracy", "Suitability", "Quality approval"], color: "var(--purple)" },
  { title: "QuizBox governance controls", items: ["Market rules", "Competition activation", "Platform integrity"], color: "var(--ink)" },
];

export default function GovernanceSection() {
  return (
    <section id="governance" className="qbp-sec qbp-alt" aria-labelledby="qbp-gov-title" data-qb-section="governance" data-qb-source="static">
      <div className="qbp-wrap">
        <div className="qbp-head">
          <p className="qbp-eyebrow">Governed by QuizBox</p>
          <h2 id="qbp-gov-title" className="qbp-h2">One governed platform underneath every role</h2>
          <p className="qbp-lead">QuizBox is the platform layer that keeps content, markets and competitions trustworthy.</p>
        </div>
        <div className="qbp-grid-3">
          {PILLARS.map((p) => <div key={p.title} className="qbp-card"><h3 className="qbp-h3">{p.title}</h3><p className="qbp-meta" style={{ fontSize: 14 }}>{p.text}</p></div>)}
        </div>
        <div style={{ marginTop: 16 }}>
          <Disclosure title="Who controls what">
            <div className="qbp-grid">
              {CONTROLS.map((c) => (
                <div key={c.title} className="qbp-card" style={{ borderTop: `3px solid ${c.color}` }}>
                  <h3 className="qbp-h3">{c.title}</h3>
                  <ul className="qbp-list">{c.items.map((i) => <li key={i}>{i}</li>)}</ul>
                </div>
              ))}
            </div>
          </Disclosure>
        </div>
      </div>
    </section>
  );
}
