"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cedis, learnerPlans, listFamilyOrders, listFamilyWallets, startFamilyOrder, unitPriceMinor, type FamilyOrder, type FamilyWallet, type LearnerPlan } from "@/lib/api/family";
import ChildChoiceTable, { type Picks } from "@/components/family/ChildChoiceTable";

// Subscriptions: what each child has now, and buy a plan for the children you tick. Each ticked child gets their own plan (weekly, monthly, term or yearly, whatever is on sale), so one child can have
// a different plan from another; "Same for everyone" is a shortcut for a bigger bundle. Each child gets their own subscription from one payment, so one can later be changed without touching the others.
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");
const days = (n: number) => (n === 7 ? "weekly" : n === 30 || n === 31 ? "monthly" : n >= 85 && n <= 95 ? "term" : n >= 360 ? "yearly" : `${n} days`);

export default function FamilySubscriptionsPage() {
  const [wallets, setWallets] = useState<FamilyWallet[] | null>(null), [plans, setPlans] = useState<LearnerPlan[]>([]), [orders, setOrders] = useState<FamilyOrder[]>([]), [unit, setUnit] = useState(0);
  const [picks, setPicks] = useState<Picks>({}), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    listFamilyWallets().then(setWallets).catch((e: Error) => { setWallets([]); setError(e.message); });
    learnerPlans().then(setPlans).catch(() => setPlans([]));
    listFamilyOrders().then((o) => setOrders(o.filter((x) => x.kind === "subscription"))).catch(() => undefined);
    unitPriceMinor().then(setUnit).catch(() => setUnit(0));
  }, []);

  const buyable = (wallets ?? []).filter((w) => w.can_buy_subscription);
  const lines = useMemo(() => buyable.filter((w) => picks[w.student_id] !== undefined).map((w) => ({ w, plan: plans.find((p) => p.code === picks[w.student_id]) })).filter((l): l is { w: FamilyWallet; plan: LearnerPlan } => !!l.plan), [buyable, picks, plans]);
  const total = lines.reduce((n, l) => n + l.plan.coins * unit, 0);

  async function pay() {
    setBusy(true); setError("");
    try { const r = await startFamilyOrder("subscription", lines.map((l) => ({ studentId: l.w.student_id, planId: l.plan.code }))); window.location.assign(r.url); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  if (wallets === null) return <div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" aria-label="Loading" />;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}><Link className="qb-link" href="/family">&larr; My family</Link></p>
      <header><h1 style={{ margin: 0 }}>Subscriptions</h1><p className="qb-muted" style={{ margin: "4px 0 0" }}>Choose a plan for each child. Children can be on different plans.</p></header>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}

      <section aria-labelledby="s-now"><h2 id="s-now" style={{ margin: "0 0 8px" }}>Right now</h2>
        {!wallets.length ? <div className="qb-card qb-empty"><strong>No children yet</strong>Add a child first.</div>
          : <div className="qb-card" style={{ overflowX: "auto" }}><table className="qb-table"><thead><tr><th>Child</th><th>Plan</th><th>Ends</th></tr></thead><tbody>
            {wallets.map((w) => <tr key={w.student_id}><td>{w.name}</td><td>{w.plan ? w.plan.replace(/^plan_/, "") : "Free"}</td><td>{w.valid_until ? when(w.valid_until) : "—"}</td></tr>)}</tbody></table></div>}
      </section>

      {buyable.length > 0 && <section className="qb-card" aria-labelledby="s-buy" style={{ display: "grid", gap: 12 }}>
        <h2 id="s-buy" style={{ margin: 0 }}>Buy a subscription</h2>
        {(!unit || !plans.length) && <p className="qb-muted" role="status">{!plans.length ? "No plans are on sale yet." : "Online payment is not open yet. Please check back soon."}</p>}
        {plans.length > 0 && <ChildChoiceTable legend="Who is it for, and which plan?" rows={buyable.map((w) => ({ id: w.student_id, name: w.name, note: w.plan ? `Now on ${w.plan.replace(/^plan_/, "")} until ${when(w.valid_until)}. A new plan is added on top.` : undefined }))}
          picks={picks} onChange={setPicks} choiceLabel="Plan" bulkLabel="Same plan for everyone"
          choices={plans.map((p) => ({ value: p.code, label: `${p.name} (${days(p.days)})`, cost: unit ? cedis(p.coins * unit) : undefined }))} />}
        {lines.length > 0 && <div className="qb-card" style={{ display: "grid", gap: 4 }} role="status" aria-label="Payment summary">
          {lines.map((l) => <div key={l.w.student_id} style={{ display: "flex", justifyContent: "space-between" }}><span>{l.w.name} · {l.plan.name}</span><span>{unit ? cedis(l.plan.coins * unit) : ""}</span></div>)}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line, #e2e8f0)", paddingTop: 6, fontWeight: 700 }}><span>Total</span><span>{unit ? cedis(total) : ""}</span></div>
        </div>}
        <button className="qb-btn" style={{ justifySelf: "start" }} disabled={busy || !lines.length || !unit} onClick={() => void pay()}>{busy ? "Opening payment…" : lines.length ? `Pay ${unit ? cedis(total) : ""} for ${lines.length} ${lines.length === 1 ? "child" : "children"}` : "Pay"}</button>
        <p className="qb-muted qb-small" style={{ margin: 0 }}>You pay once. Each child&apos;s subscription starts after the payment is confirmed, and each can be managed on its own.</p>
      </section>}

      <section aria-labelledby="s-hist"><h2 id="s-hist" style={{ margin: "0 0 8px" }}>Your subscription purchases</h2>
        {!orders.length ? <div className="qb-card qb-empty"><strong>Nothing yet</strong>Purchases appear here with what each child received.</div>
          : <div style={{ display: "grid", gap: 8 }}>{orders.map((o) => <div key={o.reference} className="qb-card" style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}><strong>{cedis(o.total_minor)}</strong><span className="qb-muted qb-small">{new Date(o.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {o.status === "fulfilled" || o.status === "paid" ? "Paid" : o.status === "initiated" ? "Waiting for payment" : o.status === "failed" ? "Not paid" : o.status}</span></div>
            <span className="qb-muted qb-small">{o.items.map((i) => i.name).join(" · ")}</span></div>)}</div>}
      </section>
    </div>
  );
}
