"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { confirmReturn } from "@/lib/api/payments";
import { cedis, getFamilyOrder, type FamilyOrder } from "@/lib/api/family";

// Where a parent lands after paying. The page does not trust the browser: it asks the server to check with Paystack, and shows what each child received once the order is confirmed.
function Return() {
  const reference = useSearchParams().get("reference") ?? "";
  const [state, setState] = useState<"checking" | "confirmed" | "pending" | "failed" | "unknown">("checking"), [order, setOrder] = useState<FamilyOrder | null>(null);
  useEffect(() => {
    if (!/^QBF-[A-Za-z0-9]{8,64}$/.test(reference)) { setState("unknown"); return; }
    let live = true, tries = 0;
    const run = async () => {
      const s = await confirmReturn(reference);
      let o: FamilyOrder | null = null; try { o = await getFamilyOrder(reference); } catch { /* not ours */ }
      if (!live) return; setOrder(o);
      if (s === "confirmed" || (o && (o.status === "paid" || o.status === "fulfilled"))) { setState("confirmed"); return; }
      if (s === "failed") { setState("failed"); return; }
      if (++tries < 6) setTimeout(() => void run(), 2500); else setState("pending");
    };
    void run();
    return () => { live = false; };
  }, [reference]);

  return (
    <section className="qb-card" style={{ display: "grid", gap: 10, maxWidth: 640 }} role="status" aria-live="polite">
      {state === "checking" && <><h1 style={{ margin: 0 }}>Checking your payment…</h1><p className="qb-muted" style={{ margin: 0 }}>This takes a few seconds. Please do not close the page.</p></>}
      {state === "confirmed" && <><h1 style={{ margin: 0 }}>Payment received</h1>
        {order && <><p style={{ margin: 0 }}>{cedis(order.total_minor)} paid. Here is what each child received:</p>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>{order.items.map((i) => <li key={i.student_id}><strong>{i.name}</strong>: {order.kind === "coins" ? `${i.coins} Coins` : "a new subscription"}</li>)}</ul></>}</>}
      {state === "pending" && <><h1 style={{ margin: 0 }}>We are still waiting for the payment</h1><p className="qb-muted" style={{ margin: 0 }}>If you have paid, it can take a few minutes to show. Nothing is lost: the Coins or subscriptions appear as soon as it is confirmed, and you will see them under your purchases.</p></>}
      {state === "failed" && <><h1 style={{ margin: 0 }}>The payment did not go through</h1><p className="qb-muted" style={{ margin: 0 }}>You have not been charged, and no child received anything. You can try again.</p></>}
      {state === "unknown" && <><h1 style={{ margin: 0 }}>We could not find that payment</h1><p className="qb-muted" style={{ margin: 0 }}>Go back to your family and check your purchases.</p></>}
      {state !== "checking" && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="qb-btn" href="/family/wallet">Coins and wallet</Link><Link className="qb-btn secondary" href="/family/subscriptions">Subscriptions</Link><Link className="qb-btn secondary" href="/family">My family</Link></div>}
    </section>
  );
}
export default function FamilyPayReturnPage() { return <Suspense fallback={<div className="qb-card qb-skeleton" style={{ minHeight: 120 }} aria-busy="true" />}><Return /></Suspense>; }
