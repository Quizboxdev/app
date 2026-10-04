import Link from "next/link";
import { PUBLIC_LINKS } from "./links";

const FEATURES = [
  { title: "Open to the right learners", text: "Competitions are scoped by market, level, subject and audience." },
  { title: "Approved questions only", text: "Every competition question comes from the approved question bank." },
  { title: "Results and recognition", text: "Leaderboards where a competition uses them, and sponsor-defined recognition." },
];

export default function CompetitionSection() {
  return (
    <section id="competitions" className="qbp-sec" aria-labelledby="qbp-comp-title" data-qb-section="competitions" data-qb-source="static">
      <div className="qbp-wrap qbp-split">
        <div style={{ display: "grid", gap: 12 }}>
          <p className="qbp-eyebrow">Competitions</p>
          <h2 id="qbp-comp-title" className="qbp-h2">Every quiz can become a challenge</h2>
          <p className="qbp-body">Learners join competitions open to them, represent their school and follow progress through each round.</p>
          <div className="qbp-actions">
            <Link className="qbp-btn" href={PUBLIC_LINKS.competitions}>Sign in to explore competitions</Link>
            <Link className="qbp-btn2" href={PUBLIC_LINKS.sponsor}>Sponsor a competition</Link>
          </div>
        </div>
        <div className="qbp-grid" style={{ gridTemplateColumns: "1fr" }}>
          {FEATURES.map((f) => <div key={f.title} className="qbp-card"><h3 className="qbp-h3">{f.title}</h3><p className="qbp-meta" style={{ fontSize: 14 }}>{f.text}</p></div>)}
        </div>
      </div>
    </section>
  );
}
