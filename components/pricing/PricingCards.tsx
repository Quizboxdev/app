import Link from "next/link";
import "./pricing.css";
import { Check, Sparkles } from "lucide-react";
import { groupPrices, priceLabel, type PriceRow } from "@/lib/pricing/format";

// The pricing cards. Each section has its own colour band; the best-value card is lifted and carries a badge. A card with a price and a payment link sends the buyer to the
// gateway; a free card goes to sign-up; one with no price yet says "Price to be announced". Plain markup, works on the public page and inside the app.
const TONE: Record<string, { band: string; ink: string; soft: string; ring: string }> = {
  learners: { band: "linear-gradient(135deg,#2563eb 0%,#7c3aed 100%)", ink: "#ffffff", soft: "#eef2ff", ring: "#7c3aed" },
  schools: { band: "linear-gradient(135deg,#059669 0%,#0ea5e9 100%)", ink: "#ffffff", soft: "#ecfdf5", ring: "#059669" },
  sponsors: { band: "linear-gradient(135deg,#f59e0b 0%,#ef4444 100%)", ink: "#ffffff", soft: "#fff7ed", ring: "#ea580c" },
};

export default function PricingCards({ rows, onPay, payable, busy, registerHref = "/login" }: {
  rows: PriceRow[]; variant?: "public" | "app"; onPay?: (row: PriceRow) => void; payable?: (row: PriceRow) => boolean; busy?: string; registerHref?: string;
}) {
  const groups = groupPrices(rows);
  return (
    <div className="qbp-pricing" style={{ display: "grid", gap: 40 }}>
      <nav aria-label="Pricing sections" className="qbp-pricing-switch">
        {groups.map((g) => <a key={g.id} href={`#price-${g.id}`} style={{ background: TONE[g.id]?.band ?? "#1e293b" }}>{g.title}</a>)}
      </nav>
      {groups.map((g) => {
        const t = TONE[g.id] ?? TONE.learners;
        return (
          <section key={g.id} id={`price-${g.id}`} aria-labelledby={`price-h-${g.id}`} data-qb-pricing={g.id} className="qbp-pricing-section" style={{ scrollMarginTop: 96 }}>
            <div className="qbp-pricing-band" style={{ background: t.band, color: t.ink }}>
              <h2 id={`price-h-${g.id}`}>{g.title}</h2>
              <p>{g.lead}</p>
            </div>
            <div className="qbp-pricing-grid">
              {g.rows.map((r) => {
                const p = priceLabel(r), free = r.price_minor === 0;
                return (
                  <article key={r.code} aria-label={r.name} className={`qbp-tier${r.highlight ? " is-best" : ""}`} style={{ "--ring": t.ring, "--soft": t.soft } as React.CSSProperties}>
                    {r.highlight && <span className="qbp-tier-badge" style={{ background: t.band, color: t.ink }}><Sparkles size={12} aria-hidden="true" /> Best value</span>}
                    <h3>{r.name}</h3>
                    {r.description && <p className="qbp-tier-desc">{r.description}</p>}
                    <p className={`qbp-tier-price${p.announced ? " is-announced" : ""}`}>
                      {p.amount}{p.per && <span> {p.per}</span>}
                    </p>
                    {r.coins ? <p className="qbp-tier-coins">{r.coins} Coins{r.days ? ` · ${r.days} days` : ""}</p> : null}
                    <ul>
                      {r.includes.map((i) => <li key={i}><Check size={14} aria-hidden="true" /> <span>{i}</span></li>)}
                    </ul>
                    <div className="qbp-tier-action">
                      {free ? <Link className="qbp-pill-btn" style={{ background: t.band, color: t.ink }} href={registerHref}>Get started free</Link>
                        : r.checkout_url ? <a className="qbp-pill-btn" style={{ background: t.band, color: t.ink }} href={r.checkout_url} target="_blank" rel="noopener noreferrer">Pay now</a>
                        : onPay && (payable ? payable(r) : !p.announced) ? <button className="qbp-pill-btn" style={{ background: t.band, color: t.ink }} disabled={busy === r.code} onClick={() => onPay(r)}>{busy === r.code ? "Opening payment…" : "Pay with mobile money or card"}</button>
                        : <Link className="qbp-pill-link" href="/contact">{p.announced ? "Tell me when it opens" : "Talk to us"}</Link>}
                    </div>
                  </article>);
              })}
            </div>
          </section>);
      })}
    </div>
  );
}
