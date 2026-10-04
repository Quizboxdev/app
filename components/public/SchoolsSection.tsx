import Link from "next/link";
import { PUBLIC_LINKS } from "./links";

export default function SchoolsSection() {
  return (
    <section id="schools" className="qbp-sec" aria-labelledby="qbp-schools-title" data-qb-section="schools" data-qb-source="static">
      <div className="qbp-wrap qbp-split" style={{ alignItems: "center" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <p className="qbp-eyebrow" style={{ color: "#00758c" }}>For schools &amp; organizations</p>
          <h2 id="qbp-schools-title" className="qbp-h2">Organize, support and measure across your school</h2>
          <p className="qbp-body">Bring teachers and classes onto one platform with reviewed, curriculum-linked content, and follow participation and performance across classes.</p>
        </div>
        <div className="qbp-card qbp-card-soft">
          <ul className="qbp-list">
            <li>Teachers and classes under one school profile</li>
            <li>Reviewed, curriculum-linked content for every class</li>
            <li>Participation and performance across classes</li>
            <li>School teams in eligible competitions</li>
          </ul>
          <div className="qbp-actions"><Link className="qbp-btn" href={PUBLIC_LINKS.school}>Register school interest</Link></div>
        </div>
      </div>
    </section>
  );
}
