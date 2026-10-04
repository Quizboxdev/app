import Link from "next/link";
import { PUBLIC_LINKS } from "./links";

export default function FinalCta() {
  return (
    <section className="qbp-sec" aria-labelledby="qbp-cta-title" data-qb-section="final-cta">
      <div className="qbp-wrap" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
        <div style={{ display: "grid", gap: 6, flex: "1 1 420px", minWidth: 0 }}>
          <h2 id="qbp-cta-title" className="qbp-h2">Ready to play, learn and win?</h2>
          <p className="qbp-body">Choose your country to get started. Sponsors, schools and subject experts can register interest or apply.</p>
        </div>
        <div className="qbp-actions">
          <Link className="qbp-btn" href={PUBLIC_LINKS.register}>Get started</Link>
          <Link className="qbp-btn2" href={PUBLIC_LINKS.login}>Sign in</Link>
        </div>
      </div>
    </section>
  );
}
