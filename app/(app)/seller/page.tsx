"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PayoutPanel from "@/components/marketplace/PayoutPanel";
import SellerForm from "@/components/marketplace/SellerForm";
import HelpLink from "@/components/help/HelpLink";
import { cedis, ITEM_STATUS, mySales, myItems, sellerGet, sellerSummary, sourceLine, when, type MyItem, type Sale, type Seller, type SellerSummary } from "@/lib/api/marketplace";

// The merchant view for a teacher: what has sold (per question set, with counts), what is theirs (60%), what is held, what can be paid out, and the payout flow.
const STATUS_TEXT: Record<string, string> = { pending: "Waiting for QuizBox to check your details. We will tell you as soon as you can sell.", verified: "Verified. You can send question sets for review.", suspended: "Your seller account is paused." };

export default function SellerPage() {
  const [seller, setSeller] = useState<Seller | null | undefined>(undefined), [sum, setSum] = useState<SellerSummary | null>(null), [items, setItems] = useState<MyItem[]>([]), [sales, setSales] = useState<Sale[]>([]), [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const s = await sellerGet(); setSeller(s);
      if (s) { const [a, b, c] = await Promise.all([sellerSummary(), myItems(), mySales(20)]); setSum(a); setItems(b); setSales(c); }
    } catch (e: any) { setError(e.message); setSeller(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (seller === undefined) return <div className="qb-card qb-muted">Loading…</div>;
  return (
    <>
      <div className="qb-page-head">
        <div><h1>Sell question sets</h1><p>Post your end-of-term questions with your school&apos;s name, set a price, and earn 60% of every sale.</p></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}><HelpLink slug="sell-question-sets" label="How selling works" />{seller?.status === "verified" && <Link className="qb-btn" href="/seller/items/new">Add a question set</Link>}</div>
      </div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {seller && seller.enabled === false && <div className="qb-card" role="status">The Marketplace is not open to buyers yet. You can set up your account and prepare your sets now.</div>}

      {!seller ? <SellerForm seller={null} onSaved={(s) => { setSeller(s); void load(); }} /> : (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="qb-card" role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`qb-pill ${seller.status === "verified" ? "success" : seller.status === "suspended" ? "danger" : "warning"}`}>{seller.status === "verified" ? "Verified" : seller.status === "suspended" ? "Paused" : "Pending"}</span>
            <span>{STATUS_TEXT[seller.status]}</span>{seller.review_note && <span className="qb-muted qb-small">{seller.review_note}</span>}
          </div>

          {sum && <div className="qb-grid cols-4">
            <div className="qb-card"><div className="qb-muted qb-small">Available to request</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(Math.max(0, sum.available_minor))}</div></div>
            <div className="qb-card"><div className="qb-muted qb-small">Held for {sum.hold_days} days</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(sum.in_hold_minor)}</div></div>
            <div className="qb-card"><div className="qb-muted qb-small">Waiting to be paid</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(sum.requested_minor)}</div></div>
            <div className="qb-card"><div className="qb-muted qb-small">Paid to you</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(sum.paid_minor)}</div></div>
          </div>}

          <PayoutPanel holdDays={sum?.hold_days ?? 7} verified={seller.status === "verified"} onChange={() => void load()} />

          <section className="qb-card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <h3 style={{ margin: 0 }}>Your question sets</h3><Link className="qb-link" href="/seller/items">Manage sets</Link>
            </div>
            {!items.length ? <p className="qb-muted">No question sets yet.{seller.status === "verified" ? " Add your first one." : " You can add sets once you are verified."}</p> :
              <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Set</th><th>Status</th><th>Price</th><th>Sold</th><th>Sales</th><th>Your 60%</th></tr></thead><tbody>
                {items.map((i) => <tr key={i.id}><td><Link className="qb-link" href={`/seller/items/${i.id}`}>{i.title}</Link><div className="qb-small qb-muted">{sourceLine(i)}</div></td>
                  <td><span className={`qb-pill ${i.status === "approved" ? "success" : i.status === "rejected" ? "danger" : i.status === "submitted" ? "warning" : "neutral"}`}>{ITEM_STATUS[i.status]}</span></td>
                  <td>{cedis(i.price_minor)}</td><td>{i.sales}</td><td>{cedis(i.gross_minor)}</td><td>{cedis(i.share_minor)}</td></tr>)}
              </tbody></table></div>}
            {sum && sum.sales > 0 && <p className="qb-small qb-muted" style={{ margin: 0 }}>In total: {sum.sales} sale{sum.sales === 1 ? "" : "s"}, {cedis(sum.gross_minor)} paid by buyers. Your {sum.share_percent}% is {cedis(sum.share_minor)}; QuizBox&apos;s share is {cedis(sum.fee_minor)}.</p>}
          </section>

          {!!sales.length && <section className="qb-card"><h3>Recent sales</h3>
            <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>When</th><th>Set</th><th>Price</th><th>Your share</th><th /></tr></thead><tbody>
              {sales.map((s, n) => <tr key={n}><td>{when(s.purchased_at)}</td><td>{s.item}<div className="qb-small qb-muted">{s.subject} · {s.school}</div></td><td>{cedis(s.price_minor)}</td><td>{s.status === "reversed" ? <s>{cedis(s.share_minor)}</s> : cedis(s.share_minor)}</td><td>{s.status === "reversed" && <span className="qb-pill danger">Refunded</span>}</td></tr>)}
            </tbody></table></div></section>}

          <details className="qb-card"><summary><strong>Your details and payout account</strong></summary><div style={{ marginTop: 12 }}><SellerForm seller={seller} onSaved={(s) => { setSeller(s); void load(); }} /></div></details>
        </div>
      )}
    </>
  );
}
