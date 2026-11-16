"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CASE_KINDS, CASE_STATUS, creditDuplicate, findPayments, refundCases, saveRefundCase, type PaymentFacts, type RefundCase } from "@/lib/api/refunds";
import ExportLink from "@/components/admin/ExportLink";
import { Kpi, Panel, num } from "@/components/admin/DataViz";

// Refunds under the published policy (/refunds): 7 days; a duplicate charge comes back as Coins; a cash refund only when none of the purchase's Coins were used.
// Find the payment, read the facts, then either add the Coins or record the outcome. Cash itself is refunded from the Paystack dashboard; this page records it.
const cedis = (minor: number, currency: string) => `${currency} ${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: minor % 100 ? 2 : 0 })}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

function Facts({ p }: { p: PaymentFacts }) {
  const flag = (ok: boolean, yes: string, no: string) => <span className={ok ? "" : "dx-muted"} style={ok ? { color: "var(--green)" } : undefined}>{ok ? yes : no}</span>;
  return (
    <ul className="dx-note" style={{ margin: 0, paddingInlineStart: 18, display: "grid", gap: 4 }}>
      <li>Paid {cedis(p.amount_minor, p.currency)} ({p.coins} Coins) by {p.method.replace("_", " ")} on {when(p.created_at)} · {p.days_since_payment} day{p.days_since_payment === 1 ? "" : "s"} ago · {flag(p.within_window, "inside the 7-day window", "OUTSIDE the 7-day window")}</li>
      <li>Status: <strong>{p.status}</strong> · {flag(p.credited, "Coins were credited", "Coins not credited")} · {flag(p.subscription_granted, `plan granted${p.plan ? ` (${p.plan})` : ""}`, "no plan granted from this payment")}</li>
      <li>Coins spent since this purchase: <strong>{p.coins_spent_after}</strong> · Coins already returned for it: <strong>{p.coins_already_returned}</strong></li>
      <li>{p.same_plan_charges_24h > 0 ? <strong>Possible duplicate: {p.same_plan_charges_24h} other payment{p.same_plan_charges_24h === 1 ? "" : "s"} of the same plan and amount within a day.</strong> : <span className="dx-muted">No other payment of the same plan and amount within a day.</span>}</li>
    </ul>
  );
}

function Actions({ p, onDone, onError }: { p: PaymentFacts; onDone: (m: string) => void; onError: (m: string) => void }) {
  const left = Math.max(0, p.coins - p.coins_already_returned), openCase = p.cases.find((c) => c.status === "open") ?? null;
  const [coins, setCoins] = useState(String(left)), [reason, setReason] = useState(""), [kind, setKind] = useState("unapplied"), [status, setStatus] = useState("cash_refund_due"), [note, setNote] = useState(""), [override, setOverride] = useState(false), [busy, setBusy] = useState("");
  async function credit() {
    setBusy("credit"); onError("");
    try { const r = await creditDuplicate(p.reference, Number(coins), reason, openCase?.id ?? null, override); onDone(r.replayed ? "That case was already credited. Nothing changed." : `${r.coins} Coins added to ${p.learner}'s account.`); setReason(""); }
    catch (e: any) { onError(e.message); }
    setBusy("");
  }
  async function record() {
    setBusy("record"); onError("");
    try { await saveRefundCase(p.reference, kind, status, note, openCase?.id ?? null, override); onDone("Saved."); setNote(""); }
    catch (e: any) { onError(e.message); }
    setBusy("");
  }
  return (
    <div className="dx-grid" style={{ marginTop: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
      <Panel title="Duplicate charge: add Coins">
        <p className="dx-muted dx-note">The extra amount goes back to the buyer as Coins, never as cash. Confirm both charges on the Paystack dashboard first. {left} of {p.coins} Coins can still be returned.</p>
        <label className="dx-muted" style={{ fontSize: 12, display: "grid", gap: 2 }}>Coins to add<input className="dx-input" inputMode="numeric" value={coins} onChange={(e) => setCoins(e.target.value.replace(/\D/g, ""))} /></label>
        <label className="dx-muted" style={{ fontSize: 12, display: "grid", gap: 2 }}>What you checked (kept in the audit log)<textarea className="dx-textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Both receipts and the mobile-money statement show two GHS 10 charges." maxLength={300} /></label>
        <button className="dx-btn primary" disabled={!!busy || left < 1 || !p.credited || p.status !== "successful"} onClick={() => void credit()}>{busy === "credit" ? "Adding…" : "Add Coins to the buyer's account"}</button>
      </Panel>
      <Panel title="Record the outcome">
        <p className="dx-muted dx-note">A cash refund is only allowed when none of the purchase&apos;s Coins were used and the plan was not granted. Refund the cash from the Paystack dashboard, then record it here.</p>
        <div className="dx-form">
          <label>Kind<select className="dx-select" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(CASE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label>Outcome<select className="dx-select" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(CASE_STATUS).filter(([k]) => k !== "credited").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <label className="dx-muted" style={{ fontSize: 12, display: "grid", gap: 2 }}>Note<textarea className="dx-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked and decided" maxLength={500} /></label>
        <button className="dx-btn" disabled={!!busy} onClick={() => void record()}>{busy === "record" ? "Saving…" : "Save outcome"}</button>
      </Panel>
      {!p.within_window && <label className="dx-check" style={{ gridColumn: "1 / -1" }}><span><input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> This payment is older than 7 days. I am deliberately making an exception (recorded in the audit log).</span></label>}
    </div>
  );
}

export default function AdminRefundsPage() {
  const [query, setQuery] = useState(""), [results, setResults] = useState<PaymentFacts[] | null>(null), [cases, setCases] = useState<RefundCase[]>([]), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [sel, setSel] = useState<string>("");
  const loadCases = useCallback(() => { refundCases(50).then(setCases).catch((e) => setError(e.message)); }, []);
  useEffect(() => { loadCases(); }, [loadCases]);
  async function search(q = query) {
    setBusy(true); setError(""); setNotice("");
    try { const r = await findPayments(q); setResults(r); setSel(r.length === 1 ? r[0].reference : ""); } catch (e: any) { setError(e.message); setResults(null); }
    setBusy(false);
  }
  const chosen = results?.find((r) => r.reference === sel) ?? null;
  const n = (s: string) => cases.filter((c) => c.status === s).length;
  const coinsBack = cases.reduce((a, c) => a + (c.coins_credited || 0), 0);
  return (
    <div className="dx-page">
      <div className="dx-head"><div><h1>Refunds</h1><p>Handle refund requests under the <Link className="dx-link" href="/refunds">published policy</Link>: 7 days; duplicate charges come back as Coins; cash only if none of the purchase&apos;s Coins were used.</p></div><div className="dx-actions"><ExportLink dataset="refund_cases" /></div></div>
      <div className="dx-kpis">
        <Kpi label="Cases (latest 50)" value={num(cases.length)} />
        <Kpi label="Open" value={num(n("open"))} tone={n("open") > 0 ? "warn" : "default"} />
        <Kpi label="Cash refund due" value={num(n("cash_refund_due"))} tone={n("cash_refund_due") > 0 ? "warn" : "default"} hint="refund on Paystack, then record" />
        <Kpi label="Credited as Coins" value={num(n("credited"))} hint={`${num(coinsBack)} Coins returned`} />
      </div>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {notice && <div className="dx-alert ok" role="status"><strong>{notice}</strong></div>}
      <form className="dx-toolbar" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <input className="dx-input" style={{ flex: "1 1 320px" }} aria-label="Find a payment" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a payment: QuizBox reference, Paystack reference or buyer email (QB-… or name@example.com)" />
        <button className="dx-btn primary" disabled={busy || query.trim().length < 3}>{busy ? "Searching…" : "Search"}</button>
      </form>
      {results && results.length === 0 && <p className="dx-muted dx-note">No payment matches that. Check the reference or the email the buyer used.</p>}
      {results && results.length > 1 && (
        <Panel title={`${results.length} payments found`}>
          <div className="dx-table-wrap" style={{ maxHeight: 320 }}>
            <table className="dx-table"><thead><tr><th>Paid</th><th className="num">Amount</th><th>Buyer</th><th>Status</th><th aria-label="Open" /></tr></thead><tbody>
              {results.map((r) => <tr key={r.reference}><td className="dx-muted">{when(r.created_at)}</td><td className="num">{cedis(r.amount_minor, r.currency)}</td><td className="name">{r.learner}</td><td>{r.status}{r.same_plan_charges_24h > 0 ? <span className="dx-pill warn" style={{ marginInlineStart: 6 }}>possible duplicate</span> : null}</td><td><button className="dx-btn sm" onClick={() => setSel(r.reference)}>Open</button></td></tr>)}
            </tbody></table>
          </div>
        </Panel>
      )}
      {chosen && (
        <Panel title={chosen.reference} subtitle={chosen.learner}>
          <Facts p={chosen} />
          <Actions key={chosen.reference} p={chosen} onError={setError} onDone={(m) => { setNotice(m); void search(chosen.reference); loadCases(); }} />
        </Panel>
      )}
      <Panel title="Cases" subtitle="Latest 50">
        {cases.length === 0 ? <p className="dx-muted dx-note">No refund cases yet.</p> : (
          <div className="dx-table-wrap" style={{ maxHeight: 420 }}>
            <table className="dx-table"><thead><tr><th>Requested</th><th>Payment</th><th>Buyer</th><th>Kind</th><th>Outcome</th><th className="num">Coins</th><th>Note</th></tr></thead><tbody>
              {cases.map((c) => <tr key={c.id}><td className="dx-muted">{when(c.requested_at)}</td><td>{c.reference}</td><td className="name">{c.learner}</td><td>{CASE_KINDS[c.kind as keyof typeof CASE_KINDS] ?? c.kind}</td><td><span className={`dx-pill ${c.status === "open" || c.status === "cash_refund_due" ? "warn" : c.status === "credited" ? "ok" : ""}`}>{CASE_STATUS[c.status as keyof typeof CASE_STATUS] ?? c.status}</span></td><td className="num">{c.coins_credited || ""}</td><td className="dx-note" style={{ whiteSpace: "normal", minWidth: 200 }}>{c.decision_note || c.contact_note}</td></tr>)}
            </tbody></table>
          </div>
        )}
      </Panel>
    </div>
  );
}
