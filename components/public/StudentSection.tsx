import Link from "next/link";
import { PUBLIC_LINKS } from "./links";

const FEATURES = [
  { title: "One learning dashboard", text: "Assessments, classroom work and challenges together." },
  { title: "Progress you can act on", text: "See progress by subject and topic, and what to practise next." },
  { title: "Competitions", text: "Join challenges open to your school, level or area." },
];

export default function StudentSection() {
  return (
    <section id="students" className="qbp-sec" aria-labelledby="qbp-students-title" data-qb-section="student" data-qb-source="static">
      <div className="qbp-wrap qbp-split">
        <div style={{ display: "grid", gap: 12 }}>
          <p className="qbp-eyebrow">For students</p>
          <h2 id="qbp-students-title" className="qbp-h2">Practise, get feedback, take on a challenge</h2>
          <p className="qbp-body">Practise curriculum-aligned questions, get feedback and see which topics to work on next.</p>
          <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.registerStudent}>Create student account</Link></div>
        </div>
        <div className="qbp-grid" style={{ gridTemplateColumns: "1fr" }}>
          {FEATURES.map((f) => <div key={f.title} className="qbp-card"><h3 className="qbp-h3">{f.title}</h3><p className="qbp-meta" style={{ fontSize: 14 }}>{f.text}</p></div>)}
        </div>
      </div>
    </section>
  );
}
