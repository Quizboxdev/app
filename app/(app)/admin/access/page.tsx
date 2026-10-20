"use client";

import { useEffect, useState } from "react";
import { getAccessOverview, grantSubscription, revokeSubscription, setFreeAllowance, type AccessOverview, type Subscription } from "@/lib/api/owner";
import { formatDate, humanize } from "@/lib/format";
import { getCatalog, listPayments, setCoinUnitPrice, setPaymentsOpen, type Catalog, type PaymentRow } from "@/lib/api/payments";
import plansFile from "../../../../config/subscription-plans.json";

// Owner screen for the free allowance and subscriptions. Until online payment is live, the owner grants a subscription here after a payment is
// received (mobile money, cash, bank). Payments will later write the same records automatically.
export default function AccessPage() {
  const [data, setData] = useState<AccessOverview | null>(null);
  const [limit, setLimit] = useState("");
  const [email, setEmail] = useState(""), [days, setDays] = useState("30"), [plan, setPlan] = useState(plansFile.plans[0]?.id ?? "learner"), [note, setNote] = useState("");
  const [catalog, setCatalog] = useState<Catalog | null>(null), [payments, setPayments] = useState<PaymentRow[]>([]), [unit, setUnit] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const load = () => getAccessOverview().then((d) => { setData(d); setLimit(d.free_limit === null ? "" : String(d.free_limit)); }).catch((e) => setError(e.message));
  const loadPayments = () => { void getCatalog().then((c) => { setCatalog(c); setUnit(c?.unit_price_minor ? String(c.unit_price_minor / 100) : ""); }); listPayments(20).then(setPayments).catch(() => setPayments([])); };
  useEffect(() => { void load(); loadPayments(); }, []);
  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(""); setDone("");
    try { await fn(); setDone(message); await load(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  };
  const revoke = (s: Subscription) => { const why = window.prompt(`Revoke ${s.email}'s ${s.plan}? Reason:`); if (why) void act(() => revokeSubscription(s.id, why), "Subscription revoked."); };

  return (
    <>
      <div className="qb-page-head"><div><h1>Access and subscriptions</h1><p>Set how many free practice sessions a new learner gets, and grant subscriptions after payment.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status">{done}</div>}
      {!data ? <div className="qb-card qb-skeleton" style={{ minHeight: 120 }} aria-busy="true" /> : <>
        <div className="qb-grid cols-3">
          <div className="qb-card"><div className="qb-muted qb-small">Free sessions per learner</div><strong style={{ fontSize: 26 }}>{data.free_limit ?? "Off"}</strong></div>
          <div className="qb-card"><div className="qb-muted qb-small">Learners</div><strong style={{ fontSize: 26 }}>{data.learners}</strong></div>
          <div className="qb-card"><div className="qb-muted qb-small">Subscribed now</div><strong style={{ fontSize: 26 }}>{data.subscribed_now}</strong></div>
        </div>

        <section className="qb-card" style={{ marginTop: 16 }}>
          <h2>Free allowance</h2>
          <p className="qb-muted">When a learner has built this many practice sessions, the next attempt takes them to the Subscribe page. Teachers and admins are never limited.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <label>Sessions<input className="qb-input" type="number" min={0} max={10000} value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 120 }} /></label>
            <button className="qb-btn" disabled={busy || limit === ""} onClick={() => void act(() => setFreeAllowance(Number(limit)), `Free allowance set to ${limit} sessions.`)}>Save</button>
            <button className="qb-btn secondary" disabled={busy || data.free_limit === null} onClick={() => void act(() => setFreeAllowance(null), "Free allowance switched off: practice is unlimited.")}>Switch off</button>
          </div>
        </section>

        <section className="qb-card" style={{ marginTop: 16 }}>
          <h2>Grant a subscription</h2>
          <p className="qb-muted">Use after you receive a payment. A second grant extends the first, so paid days are never lost.</p>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end" }}>
            <label>Learner&apos;s email<input className="qb-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Plan<select className="qb-input" value={plan} onChange={(e) => setPlan(e.target.value)}>{plansFile.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Days<select className="qb-input" value={days} onChange={(e) => setDays(e.target.value)}>{[["30", "30 days"], ["90", "One term (90 days)"], ["365", "One year"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label>Payment reference<input className="qb-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="MoMo ref, receipt no." /></label>
          </div>
          <button className="qb-btn" style={{ marginTop: 10 }} disabled={busy || !email.includes("@") || note.trim().length < 5}
            onClick={() => void act(() => grantSubscription(email.trim(), Number(days), plan, note.trim()), `Subscription granted to ${email.trim()}.`)}>Grant</button>
        </section>


        <section className="qb-card" style={{ marginTop: 16 }}>
          <h2>Online payments</h2>
          <p className="qb-muted">Learners pay with mobile money or card (Paystack). Payments are {catalog?.payments_enabled ? "ON" : "OFF"}. The price of a plan is its Coins times the price of one Coin.
            Before switching on: add the Paystack secret key in Vercel as PAYSTACK_SECRET_KEY, and set the callback address in Paystack to https://www.quizbox.io/api/payments/webhook/paystack.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <label>Price of one Coin (cedis)<input className="qb-input" type="number" min={0.1} step={0.1} value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 140 }} /></label>
            <button className="qb-btn secondary" disabled={busy || !(Number(unit) > 0)} onClick={() => void act(async () => { await setCoinUnitPrice(Math.round(Number(unit) * 100)); loadPayments(); }, `Coin price set to GHS ${Number(unit).toFixed(2)}.`)}>Save price</button>
            <button className="qb-btn" disabled={busy || !catalog?.unit_price_minor || !!catalog?.payments_enabled} onClick={() => void act(async () => { await setPaymentsOpen(true); loadPayments(); }, "Online payments switched ON.")}>Switch payments on</button>
            <button className="qb-btn secondary" disabled={busy || !catalog?.payments_enabled} onClick={() => void act(async () => { await setPaymentsOpen(false); loadPayments(); }, "Online payments switched OFF.")}>Switch off</button>
          </div>
          {payments.length > 0 && <div className="qb-table-wrap" style={{ marginTop: 12 }}><table className="qb-table"><thead><tr><th>When</th><th>Learner</th><th>Plan</th><th>Amount</th><th>Status</th><th>Check</th></tr></thead><tbody>
            {payments.map((p) => <tr key={p.reference}><td>{formatDate(p.created_at)}</td><td>{p.learner}</td><td>{p.plan ?? "Coins"}</td><td>{p.currency} {(p.amount_minor / 100).toFixed(2)}</td><td>{humanize(p.status)}</td><td>{p.reconciliation}</td></tr>)}
          </tbody></table></div>}
        </section>
        <section className="qb-card" style={{ marginTop: 16 }}>
          <h2>Recent subscriptions</h2>
          {!data.subscriptions.length ? <p className="qb-muted">None yet.</p> :
            <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Learner</th><th>Plan</th><th>Valid</th><th>Status</th><th>Reference</th><th /></tr></thead><tbody>
              {data.subscriptions.map((s) => <tr key={s.id}><td>{s.name}<div className="qb-small qb-muted">{s.email}</div></td><td>{s.plan}</td>
                <td>{formatDate(s.valid_from)} to {formatDate(s.valid_until)}</td><td>{humanize(s.status)}</td><td className="qb-small">{s.note}</td>
                <td>{s.status === "active" && <button className="qb-btn secondary" disabled={busy} onClick={() => revoke(s)}>Revoke</button>}</td></tr>)}
            </tbody></table></div>}
        </section>
      </>}
    </>
  );
}
