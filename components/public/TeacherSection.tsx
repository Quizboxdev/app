import Link from "next/link";
import { PUBLIC_LINKS } from "./links";

const FEATURES = [
  { title: "Approved question banks", text: "Set assignments from reviewed, curriculum-linked questions." },
  { title: "Class mastery", text: "Classes, assignments and a gradebook in one workspace." },
  { title: "Targeted support", text: "Weak indicators highlighted per class, plus eligible competitions." },
];

export default function TeacherSection() {
  return (
    <section id="teachers" className="qbp-sec qbp-alt" aria-labelledby="qbp-teachers-title" data-qb-section="teacher" data-qb-source="static">
      <div className="qbp-wrap qbp-split">
        <div style={{ display: "grid", gap: 12 }}>
          <p className="qbp-eyebrow">For teachers</p>
          <h2 id="qbp-teachers-title" className="qbp-h2">Assign from approved banks, see who needs support</h2>
          <p className="qbp-body">Set assignments, monitor class mastery and see where learners need support.</p>
          <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.registerTeacher}>Create teacher account</Link></div>
        </div>
        <div className="qbp-grid" style={{ gridTemplateColumns: "1fr" }}>
          {FEATURES.map((f) => <div key={f.title} className="qbp-card"><h3 className="qbp-h3">{f.title}</h3><p className="qbp-meta" style={{ fontSize: 14 }}>{f.text}</p></div>)}
        </div>
      </div>
    </section>
  );
}
