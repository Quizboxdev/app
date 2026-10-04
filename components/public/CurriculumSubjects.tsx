import Link from "next/link";
import type { PublicMarkets } from "@/lib/public/signup-markets";
import { PUBLIC_LINKS } from "./links";

// Live when the public signup market list is reachable; otherwise static descriptive copy with
// no counts. Only display labels are rendered.
export default function CurriculumSubjects({ markets }: { markets: PublicMarkets | null }) {
  const live = Boolean(markets && markets.available.length);
  return (
    <section id="curriculum" className="qbp-sec qbp-alt" aria-labelledby="qbp-curr-title" data-qb-section="curriculum" data-qb-source={live ? "curriculum.subjects" : "static"}>
      <div className="qbp-wrap qbp-split">
        <div style={{ display: "grid", gap: 12 }}>
          <p className="qbp-eyebrow">Curriculum &amp; subjects</p>
          <h2 id="qbp-curr-title" className="qbp-h2">Starting in Ghana. Built for multiple curricula.</h2>
          <p className="qbp-body">Each market runs on its own approved curriculum sources, question banks and market rules.</p>
          <p className="qbp-meta">Not in an available country yet? <Link className="qbp-link" href={PUBLIC_LINKS.country}>Register interest</Link>.</p>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {live ? markets!.available.map((market) => (
            <div key={market.country} className="qbp-card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <h3 className="qbp-h3">{market.country}</h3>
                <span className="qbp-tag" style={{ background: "var(--color-success-bg)", color: "#0f6b2a", borderColor: "transparent" }}>Available</span>
              </div>
              {market.market !== market.country && <p className="qbp-meta">{market.market}</p>}
              {market.educationLevels.length > 0 && <p className="qbp-meta"><strong>Levels:</strong> {market.educationLevels.join(" · ")}</p>}
              {market.subjects.length > 0 && <div className="qbp-chips" aria-label={`Subjects in ${market.country}`}>{market.subjects.map((s) => <span key={s} className="qbp-tag">{s}</span>)}</div>}
            </div>
          )) : (
            <div className="qbp-card">
              <h3 className="qbp-h3">Ghana</h3>
              <p className="qbp-meta">Junior High School learning aligned to the national curriculum, with subjects configured for each market.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
