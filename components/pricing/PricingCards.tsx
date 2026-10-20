import Link from "next/link";
import { Check } from "lucide-react";
import { groupPrices, priceLabel, type PriceRow } from "@/lib/pricing/format";

// The pricing cards. A card with a price and a payment link sends the buyer to the gateway; a free card goes to sign-up; one with no price yet says "Price to be announced".
// `onPay` lets a screen handle a paid card that has no link (the existing learner checkout). Plain markup with no state, so it works on the public page and inside the app.
export default function PricingCards({ rows, variant = "app", onPay, payable, busy, registerHref = "/login" }: {
  rows: PriceRow[]; variant?: "public" | "app"; onPay?: (row: PriceRow) => void; payable?: (row: PriceRow) => boolean; busy?: string; registerHref?: string;
}) {
  const pub = variant === "public";
  const cls = { card: pub ? "qbp-card" : "qb-card", grid: pub ? "qbp-grid" : "qb-grid cols-3", h: pub ? "qbp-h3" : "", meta: pub ? "qbp-meta" : "qb-muted", btn: pub ? "qbp-btn" : "qb-btn" };
  return (
    <div style={{ display: "grid", gap: 32 }}>
      {groupPrices(rows).map((g) => (
        <section key={g.id} aria-labelledby={`price-${g.id}`} data-qb-pricing={g.id}>
          <h2 id={`price-${g.id}`} className={cls.h}>{g.title}</h2>
          <p className={cls.meta} style={{ marginTop: 0 }}>{g.lead}</p>
          <div className={cls.grid}>
            {g.rows.map((r) => {
              const p = priceLabel(r), free = r.price_minor === 0;
              return (
                <article key={r.code} className={cls.card} style={r.highlight ? { outline: "2px solid currentColor" } : undefined} aria-label={r.name}>
                  {r.highlight && <p className={pub ? "qbp-tag" : "qb-pill"} style={{ margin: 0 }}>Best value</p>}
                  <h3 className={cls.h} style={{ marginTop: 8 }}>{r.name}</h3>
                  {r.description && <p className={cls.meta}>{r.description}</p>}
                  <p style={{ fontSize: p.announced ? 16 : 26, fontWeight: 800, margin: "6px 0" }}>{p.amount}{p.per && <span className={cls.meta} style={{ fontSize: 14, fontWeight: 500 }}> {p.per}</span>}</p>
                  <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 12px", display: "grid", gap: 6 }}>
                    {r.includes.map((i) => <li key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}><Check size={14} aria-hidden="true" style={{ marginTop: 4, flex: "0 0 auto" }} /> <span>{i}</span></li>)}
                  </ul>
                  {free ? <Link className={cls.btn} href={registerHref}>Get started</Link>
                    : r.checkout_url ? <a className={cls.btn} href={r.checkout_url} target="_blank" rel="noopener noreferrer">Pay now</a>
                    : onPay && (payable ? payable(r) : !p.announced) ? <button className={cls.btn} disabled={busy === r.code} onClick={() => onPay(r)}>{busy === r.code ? "Opening payment…" : "Pay with mobile money or card"}</button>
                    : <Link className={pub ? "qbp-link" : "qb-link"} href="/contact">{p.announced ? "Ask to be told when it opens" : "Contact us"}</Link>}
                </article>);
            })}
          </div>
        </section>))}
    </div>
  );
}
