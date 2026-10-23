"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cedis, day, myPurchases, sourceLine, type Purchase } from "@/lib/api/marketplace";
import { confirmReturn } from "@/lib/api/payments";

// The question sets a person has bought. A set stays here for 90 days; the days left are shown. Paystack sends the buyer back to this page after paying, and the sale is recorded
// a moment later, so the page checks a few times before saying it is taking longer than usual.
function Mine() {
  const reference = useSearchParams().get("reference");
  const [rows, setRows] = useState<Purchase[] | null>(null), [error, setError] = useState(""), [waiting, setWaiting] = useState(!!reference), [slow, setSlow] = useState(false);
  const tries = useRef(0), before = useRef<number | null>(null);

  const load = useCallback(() => myPurchases().then((r) => { setRows(r); return r; }).catch((e) => { setError(e.message); return null; }), []);
  // Back from paying: ask Paystack directly (in case the webhook is slow). If it says the payment is confirmed, the sale is recorded and there is nothing left to wait for.
  useEffect(() => { void (reference ? confirmReturn(reference).then((state) => { if (state === "confirmed") setWaiting(false); return load(); }) : load()); }, [load, reference]);
  useEffect(() => {
    if (!waiting || rows === null) return;
    if (before.current === null) before.current = rows.filter((r) => r.active).length;
    if (rows.filter((r) => r.active).length > before.current) { setWaiting(false); return; }
    if (tries.current >= 12) { setWaiting(false); setSlow(true); return; }
    const t = setTimeout(() => { tries.current += 1; void load(); }, 2500);
    return () => clearTimeout(t);
  }, [waiting, rows, load]);

  const active = (rows ?? []).filter((r) => r.active), past = (rows ?? []).filter((r) => !r.active);
  return (
    <>
      <div className="qb-page-head"><div><h1>My question sets</h1><p>Sets you have bought stay here for 90 days.</p></div><Link className="qb-btn" href="/marketplace">Browse the Marketplace</Link></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {waiting && <div className="qb-card" role="status"><strong>Confirming your payment…</strong><p className="qb-muted" style={{ margin: 0 }}>This usually takes a few seconds. Your set will appear below.</p></div>}
      {slow && <div className="qb-card" role="status"><strong>Your payment is taking longer than usual to confirm.</strong><p className="qb-muted" style={{ margin: 0 }}>If you were charged, your set will appear here shortly. If it does not within an hour, <Link className="qb-link" href="/support/new">send us a request</Link> with your payment reference{reference ? ` (${reference})` : ""}.</p></div>}
      {rows === null ? <div className="qb-card qb-muted">Loading…</div> :
        !active.length && !waiting ? <div className="qb-card qb-muted">You have no question sets yet. <Link className="qb-link" href="/marketplace">Browse the Marketplace</Link>.</div> :
        <div className="qb-grid cols-3">
          {active.map((p) => (
            <div key={p.item_id} className="qb-card" style={{ display: "grid", gap: 8, alignContent: "start" }}>
              <span className="qb-pill teal" style={{ justifySelf: "start" }}>{sourceLine(p)}</span>
              <h3 style={{ margin: 0 }}>{p.title}</h3>
              <p className="qb-small qb-muted" style={{ margin: 0 }}>Bought {day(p.purchased_at)} · {cedis(p.price_minor)}</p>
              <p className={p.days_left <= 7 ? "qb-error" : "qb-ok"} style={{ margin: 0 }}>{p.days_left} {p.days_left === 1 ? "day" : "days"} left (until {day(p.expires_at)})</p>
              <Link className="qb-btn" href={`/marketplace/mine/${p.item_id}`}>Practise this set</Link>
            </div>
          ))}
        </div>}
      {!!past.length && <section className="qb-card" style={{ marginTop: 16 }}>
        <h3>Ended</h3>
        <ul className="qb-list">{past.map((p) => <li key={p.item_id + p.purchased_at}>{p.title} · {sourceLine(p)} · {p.status === "reversed" ? "refunded" : `ended ${day(p.expires_at)}`}{p.slug && p.status !== "reversed" ? <> · <Link className="qb-link" href={`/marketplace/${p.slug}`}>Buy again</Link></> : null}</li>)}</ul>
      </section>}
    </>
  );
}
export default function MinePage() { return <Suspense fallback={<div className="qb-card qb-muted">Loading…</div>}><Mine /></Suspense>; }
