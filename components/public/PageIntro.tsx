import Link from "next/link";

export default function PageIntro({ eyebrow, title, lead, crumb }: { eyebrow?: string; title: string; lead?: string; crumb: string }) {
  return (
    <div className="qbp-wrap qbp-page-head">
      <nav aria-label="Breadcrumb" className="qbp-crumb"><Link href="/">Home</Link> <span aria-hidden="true">/</span> <span aria-current="page">{crumb}</span></nav>
      {eyebrow && <p className="qbp-eyebrow">{eyebrow}</p>}
      <h1 className="qbp-h2" style={{ fontSize: "clamp(26px, 3vw, 32px)" }}>{title}</h1>
      {lead && <p className="qbp-lead">{lead}</p>}
    </div>
  );
}
