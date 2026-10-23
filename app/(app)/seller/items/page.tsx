"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cedis, ITEM_STATUS, itemUnlist, myItems, sourceLine, when, type MyItem } from "@/lib/api/marketplace";

// A teacher's question sets: status, review notes, and sales per set.
function SellerItems() {
  const sent = useSearchParams().get("sent"), dups = Number(useSearchParams().get("dups") ?? 0);
  const [items, setItems] = useState<MyItem[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const load = () => myItems().then(setItems).catch((e) => { setError(e.message); setItems([]); });
  useEffect(() => { void load(); }, []);
  async function unlist(id: string) { setBusy(id); setError(""); try { await itemUnlist(id); await load(); } catch (e: any) { setError(e.message); } setBusy(""); }
  return (
    <>
      <div className="qb-page-head"><div><p className="qb-small"><Link className="qb-link" href="/seller">← Sell question sets</Link></p><h1>Your question sets</h1></div><Link className="qb-btn" href="/seller/items/new">Add a question set</Link></div>
      {sent && <div className="qb-card" role="status"><strong>Sent for review.</strong> We check every set before it goes on sale and will tell you the result.{dups > 0 && <> {dups} question{dups === 1 ? " matches" : "s match"} another seller&apos;s wording, so the reviewer will look at it closely.</>}</div>}
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {items === null ? <div className="qb-card qb-muted">Loading…</div> : !items.length ? <div className="qb-card qb-muted">You have not added a question set yet.</div> :
        <div className="qb-grid cols-2">
          {items.map((i) => (
            <div key={i.id} className="qb-card" style={{ display: "grid", gap: 8, alignContent: "start" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span className="qb-pill teal">{sourceLine(i)}</span>
                <span className={`qb-pill ${i.status === "approved" ? "success" : i.status === "rejected" ? "danger" : i.status === "submitted" ? "warning" : "neutral"}`}>{ITEM_STATUS[i.status]}</span>
              </div>
              <h3 style={{ margin: 0 }}>{i.title}</h3>
              <p className="qb-small qb-muted" style={{ margin: 0 }}>{i.question_count} questions · {cedis(i.price_minor)} · updated {when(i.updated_at)}</p>
              {i.status === "rejected" && i.review_note && <p className="qb-error" style={{ margin: 0 }}>Needs changes: {i.review_note}</p>}
              <p style={{ margin: 0 }}><strong>{i.sales}</strong> sold · {cedis(i.gross_minor)} paid by buyers · <strong>{cedis(i.share_minor)}</strong> yours</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link className="qb-btn" href={`/seller/items/${i.id}`}>{["draft", "rejected", "unlisted"].includes(i.status) ? "Edit" : "View"}</Link>
                {["approved", "submitted"].includes(i.status) && <button className="qb-btn secondary" disabled={busy === i.id} onClick={() => void unlist(i.id)}>Take off sale</button>}
                {i.status === "approved" && <Link className="qb-btn secondary" href={`/marketplace/${i.slug}`}>See the listing</Link>}
              </div>
            </div>
          ))}
        </div>}
    </>
  );
}
export default function SellerItemsPage() { return <Suspense fallback={<div className="qb-card qb-muted">Loading…</div>}><SellerItems /></Suspense>; }
