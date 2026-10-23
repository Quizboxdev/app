"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { buy, cedis, day, listing, sourceLine, type ListingDetail } from "@/lib/api/marketplace";

// One question set: where it comes from, what it costs, a few sample questions (never the answers), and the Buy button.
// Buying sends the set's id to the server, which prices it from the database and opens Paystack; the sale is recorded when Paystack confirms the payment.
export default function ListingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [item, setItem] = useState<ListingDetail | null | undefined>(undefined), [error, setError] = useState(""), [busy, setBusy] = useState(false);

  useEffect(() => { listing(slug).then(setItem).catch((e) => { setError(e.message); setItem(null); }); }, [slug]);

  async function pay() {
    if (!item) return;
    setBusy(true); setError("");
    try { const { url } = await buy(item.id); window.location.assign(url); }
    catch (e: any) { setError(e.code ? `${e.message} (code ${e.code})` : e.message); setBusy(false); }
  }

  if (item === undefined) return <div className="qb-card qb-muted">Loading…</div>;
  if (!item) return <div className="qb-card"><h2>This question set is not available</h2><p className="qb-muted">{error || "It may have been taken off sale."}</p><Link className="qb-btn" href="/marketplace">Back to the Marketplace</Link></div>;
  const owned = !!item.owned_until;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <p className="qb-small"><Link className="qb-link" href="/marketplace">← Marketplace</Link></p>
          <h1>{item.title}</h1>
          <p><span className="qb-pill teal">{sourceLine(item)}</span></p>
        </div>
      </div>

      <div className="qb-grid cols-2" style={{ alignItems: "start" }}>
        <div className="qb-card" style={{ display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>About this set</h3>
          {item.description ? <p style={{ margin: 0 }}>{item.description}</p> : <p className="qb-muted" style={{ margin: 0 }}>An end-of-term question set.</p>}
          <ul className="qb-list" style={{ margin: 0 }}>
            <li><strong>Source:</strong> {item.subject}, {item.school}</li>
            <li><strong>Class:</strong> {item.grade}{item.term ? ` · ${item.term}` : ""}</li>
            <li><strong>Questions:</strong> {item.questions}</li>
            <li><strong>Written by:</strong> {item.seller}, a verified teacher</li>
            {item.purchases > 0 && <li><strong>Bought by:</strong> {item.purchases} {item.purchases === 1 ? "learner" : "learners"}</li>}
          </ul>
          {!!item.samples.length && <>
            <h4 style={{ margin: "8px 0 0" }}>A taste of the questions</h4>
            <ol className="qb-list" style={{ margin: 0 }}>{item.samples.map((s, n) => <li key={n}>{s}</li>)}</ol>
            <p className="qb-small qb-muted" style={{ margin: 0 }}>Answers and explanations come with the full set.</p>
          </>}
        </div>

        <div className="qb-card qb-form" style={{ display: "grid", gap: 12 }}>
          <div><span className="qb-muted qb-small">Price</span><div style={{ fontSize: 28, fontWeight: 700 }}>{cedis(item.price_minor)}</div></div>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>Pay once by mobile money or card. The set stays in your account for {item.access_days} days, and you can practise it as often as you like.</p>
          {error && <p className="qb-error" role="alert">{error}</p>}
          {item.mine ? <p className="qb-muted">This is your own set.</p> :
            owned ? <><p className="qb-ok">You have this set until {day(item.owned_until)}.</p><Link className="qb-btn" href="/marketplace/mine">Open my question sets</Link></> :
            <button className="qb-btn" disabled={busy} onClick={() => void pay()}>{busy ? "Opening payment…" : `Buy for ${cedis(item.price_minor)}`}</button>}
          <p className="qb-small qb-muted" style={{ margin: 0 }}>Refunds follow the <Link className="qb-link" href="/refunds">Refund Policy</Link>.</p>
        </div>
      </div>
    </>
  );
}
