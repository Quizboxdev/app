import Link from "next/link";
import { PUBLIC_LINKS } from "./links";

// Parents use their own accent so the home page does not reuse the schools colour.
export const PARENT_COLOR = "#a2246b";

export const FAMILY_FEATURES = [
  { title: "One workspace for every child", text: "Add a child, or link a child who already has a QuizBox account. Each child keeps their own account and school class." },
  { title: "Follow their progress", text: "See each child's completed work, their monthly average and what is still to do." },
  { title: "Give practice and challenges", text: "Set approved practice, share question sets you have bought and invite children to challenges you choose." },
  { title: "Pay once for the family", text: "Buy Coins or a subscription for one child or several children in a single checkout. Each child gets their own." },
];

export const FAMILY_STEPS = [
  { title: "1 · Sign up as a parent", text: "Choose Parent or guardian under \"I am a\". Your Family workspace opens from the menu." },
  { title: "2 · Add or link children", text: "Create an account for a child, or ask a student who already has one to link with you." },
  { title: "3 · Learn together", text: "Give work, follow progress, and buy Coins or subscriptions for your children." },
];

export default function ParentsSection() {
  return (
    <section id="parents" className="qbp-sec" aria-labelledby="qbp-parents-title" data-qb-section="parents" data-qb-source="static">
      <div className="qbp-wrap" style={{ display: "grid", gap: 28 }}>
        <div className="qbp-split" style={{ alignItems: "center" }}>
          <div style={{ display: "grid", gap: 12 }}>
            <p className="qbp-eyebrow" style={{ color: PARENT_COLOR }}>For parents &amp; guardians</p>
            <h2 id="qbp-parents-title" className="qbp-h2">One family space for your children&apos;s learning</h2>
            <p className="qbp-body">Bring your children&apos;s QuizBox learning together. Follow their progress, give them practice and challenges, and buy Coins or subscriptions for the whole family in one checkout.</p>
            <div className="qbp-actions">
              <Link className="qbp-btn" href={PUBLIC_LINKS.registerParent} prefetch>Sign up as a parent or guardian</Link>
              <Link className="qbp-btn2" href="/parents">See the parents page</Link>
              <Link className="qbp-btn2" href="/help/parents-and-family-workspace">How to create your family</Link>
            </div>
          </div>
          <ul className="qbp-grid" style={{ gridTemplateColumns: "1fr", listStyle: "none", margin: 0, padding: 0 }}>
            {FAMILY_FEATURES.map((feature) => (
              <li key={feature.title} className="qbp-card" style={{ borderLeft: `3px solid ${PARENT_COLOR}` }}>
                <h3 className="qbp-h3">{feature.title}</h3>
                <p className="qbp-meta" style={{ fontSize: 14 }}>{feature.text}</p>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <h3 className="qbp-h3">How it works</h3>
          <div className="qbp-grid">
            {FAMILY_STEPS.map((step) => (
              <div key={step.title} className="qbp-card">
                <span className="qbp-step" style={{ color: PARENT_COLOR }}>{step.title}</span>
                <p className="qbp-meta">{step.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="qbp-split">
          <div className="qbp-card">
            <h3 className="qbp-h3">Private by design</h3>
            <ul className="qbp-list">
              <li>You only see the children linked to your family.</li>
              <li>Removing a child ends your link only. Their account, school and results stay the same.</li>
              <li>Children under 13 have extra protection, and they do not pay online.</li>
            </ul>
          </div>
          <div className="qbp-card" style={{ background: "#fdf2f8", borderColor: "#f5c2dc" }}>
            <span className="qbp-badge" style={{ background: "#fff", color: PARENT_COLOR }}>Example · Two children, one family</span>
            <p className="qbp-body" style={{ fontSize: 14, color: "#33415c" }}>A parent adds a Primary child and a JHS child, links an older student who already has an account, and gives all three the same Mathematics practice set bought from the Marketplace. One checkout covers Coins for each child.</p>
          </div>
        </div>

      </div>
    </section>
  );
}
