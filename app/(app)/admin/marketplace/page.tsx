"use client";

import { useCallback, useEffect, useState } from "react";
import ExportLink from "@/components/admin/ExportLink";
import {
  adminItem, adminItems, adminPayoutSet, adminPayouts, adminReverse, adminReview, adminSellerSet, adminSellers, adminSummary, cedis, ITEM_STATUS, marketplaceOpen, marketplaceSwitch, sourceLine, when,
  type AdminItem, type AdminItemDetail, type AdminPayout, type AdminSeller, type AdminSummary,
} from "@/lib/api/marketplace";

// Marketplace governance. Review each question set (automatic checks are shown: question count, duplicates of other sellers' wording), verify sellers, pay out teachers by hand within 24 hours on working
// days, and see the merchant account. Finance actions need the finance role; the database enforces who may do what.
type Tab = "review" | "sellers" | "payouts" | "account";
const TABS: [Tab, string][] = [["review", "Sets to review"], ["sellers", "Sellers"], ["payouts", "Payouts"], ["account", "Merchant account"]];

function Review({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<AdminItem[] | null>(null), [open, setOpen] = useState<AdminItemDetail | null>(null), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [status, setStatus] = useState("submitted");
  const load = useCallback(() => adminItems(status).then(setRows).catch((e) => { onError(e.message); setRows([]); }), [status, onError]);
  useEffect(() => { void load(); }, [load]);
  async function view(id: string) { setNote(""); try { setOpen(await adminItem(id)); } catch (e: any) { onError(e.message); } }
  async function decide(decision: "approve" | "reject") {
    if (!open) return; setBusy(true); onError("");
    try { await adminReview(open.id, decision, note); setOpen(null); await load(); } catch (e: any) { onError(e.message); }
    setBusy(false);
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label className="qb-field" style={{ maxWidth: 260 }}>Show<select value={status} onChange={(e) => { setStatus(e.target.value); setOpen(null); }}>{[["submitted", "Waiting for review"], ["approved", "On sale"], ["rejected", "Sent back"], ["unlisted", "Off sale"], ["", "Everything"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {rows === null ? <p className="qb-muted">Loading…</p> : !rows.length ? <p className="qb-muted">Nothing here.</p> :
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Set</th><th>Seller</th><th>Price</th><th>Checks</th><th /></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td><strong>{r.title}</strong><div className="qb-small qb-muted">{sourceLine(r)}</div></td><td>{r.seller}<div className="qb-small qb-muted">{r.seller_status}</div></td><td>{cedis(r.price_minor)}</td>
            <td className="qb-small">{r.questions} questions{r.duplicates > 0 ? <strong className="qb-error"> · {r.duplicates} match other sellers</strong> : " · no matches"}<div className="qb-muted">{ITEM_STATUS[r.status]}{r.purchases ? ` · ${r.purchases} sold` : ""}</div></td>
            <td><button className="qb-btn secondary" onClick={() => void view(r.id)}>Open</button></td></tr>)}
        </tbody></table></div>}
      {open && <div className="qb-card" style={{ display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>{open.title}</h3>
        <p className="qb-small qb-muted" style={{ margin: 0 }}>{sourceLine({ subject: open.subject, school_name: open.school_name, grade: open.grade, term: open.term })} · {cedis(open.price_minor)} · by {open.seller.name} ({open.seller.school}, {open.seller.status})</p>
        {open.description && <p style={{ margin: 0 }}>{open.description}</p>}
        <ol style={{ margin: 0, display: "grid", gap: 8, maxHeight: 420, overflow: "auto" }}>
          {open.questions.map((q, i) => <li key={i}><span>{q.question_text}</span>{q.duplicate && <span className="qb-pill danger" style={{ marginLeft: 6 }}>matches another seller</span>}
            <div className="qb-small">{q.options.map((o, n) => <span key={n} style={{ marginRight: 12, fontWeight: n === q.correct_index ? 700 : 400 }}>{String.fromCharCode(65 + n)}. {o}{n === q.correct_index ? " ✓" : ""}</span>)}</div>
            {q.explanation && <div className="qb-small qb-muted">{q.explanation}</div>}</li>)}
        </ol>
        {open.status === "submitted" ? <>
          <label className="qb-field">Note to the teacher (needed to send back)<textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Question 4 has two correct answers." /></label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="qb-btn" disabled={busy || open.seller.status !== "verified"} onClick={() => void decide("approve")}>Approve and put on sale</button><button className="qb-btn secondary" disabled={busy} onClick={() => void decide("reject")}>Send back with a reason</button><button className="qb-btn secondary" onClick={() => setOpen(null)}>Close</button></div>
          {open.seller.status !== "verified" && <p className="qb-small qb-error" style={{ margin: 0 }}>Verify the seller first.</p>}
        </> : <button className="qb-btn secondary" style={{ justifySelf: "start" }} onClick={() => setOpen(null)}>Close</button>}
      </div>}
    </div>
  );
}

function Sellers({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<AdminSeller[] | null>(null), [filter, setFilter] = useState("pending"), [note, setNote] = useState<Record<string, string>>({}), [busy, setBusy] = useState("");
  const load = useCallback(() => adminSellers(filter).then(setRows).catch((e) => { onError(e.message); setRows([]); }), [filter, onError]);
  useEffect(() => { void load(); }, [load]);
  async function set(id: string, status: "pending" | "verified" | "suspended") { setBusy(id); onError(""); try { await adminSellerSet(id, status, note[id] ?? ""); await load(); } catch (e: any) { onError(e.message); } setBusy(""); }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label className="qb-field" style={{ maxWidth: 260 }}>Show<select value={filter} onChange={(e) => setFilter(e.target.value)}>{[["pending", "Waiting to be verified"], ["verified", "Verified"], ["suspended", "Paused"], ["", "Everyone"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {rows === null ? <p className="qb-muted">Loading…</p> : !rows.length ? <p className="qb-muted">Nobody here.</p> :
        rows.map((s) => <div key={s.id} className="qb-card" style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{s.display_name}</strong><span className={`qb-pill ${s.status === "verified" ? "success" : s.status === "suspended" ? "danger" : "warning"}`}>{s.status}</span></div>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>{s.school} · {s.email} · {s.phone} · {s.items} set{s.items === 1 ? "" : "s"}</p>
          <p className="qb-small" style={{ margin: 0 }}>Payout to: {s.network} ({s.method.replace("_", " ")}) {s.account_masked} · name on account: <strong>{s.account_name}</strong></p>
          {s.review_note && <p className="qb-small qb-muted" style={{ margin: 0 }}>Note: {s.review_note}</p>}
          <input aria-label="Note" value={note[s.id] ?? ""} maxLength={500} onChange={(e) => setNote((n) => ({ ...n, [s.id]: e.target.value }))} placeholder="Note (needed to pause or send back to pending)" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {s.status !== "verified" && <button className="qb-btn" disabled={busy === s.id} onClick={() => void set(s.id, "verified")}>Verify</button>}
            {s.status !== "suspended" && <button className="qb-btn secondary" disabled={busy === s.id} onClick={() => void set(s.id, "suspended")}>Pause (takes sets off sale)</button>}
            {s.status === "verified" && <button className="qb-btn secondary" disabled={busy === s.id} onClick={() => void set(s.id, "pending")}>Send back to pending</button>}
          </div>
        </div>)}
    </div>
  );
}

function Payouts({ onError }: { onError: (m: string) => void }) {
  const [rows, setRows] = useState<AdminPayout[] | null>(null), [filter, setFilter] = useState("requested"), [ref, setRef] = useState<Record<string, string>>({}), [note, setNote] = useState<Record<string, string>>({}), [busy, setBusy] = useState(""), [done, setDone] = useState("");
  const load = useCallback(() => adminPayouts(filter).then(setRows).catch((e) => { onError(e.message); setRows([]); }), [filter, onError]);
  useEffect(() => { void load(); }, [load]);
  async function act(id: string, action: "paid" | "reject") {
    setBusy(id); onError(""); setDone("");
    try { await adminPayoutSet(id, action, ref[id] ?? "", note[id] ?? ""); setDone(action === "paid" ? "Marked as paid. The teacher has been told." : "Sent back. The money is in the teacher's balance again."); await load(); } catch (e: any) { onError(e.message); }
    setBusy("");
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p className="qb-small qb-muted" style={{ margin: 0 }}>Pay each request from your mobile money or bank account to the details below, within 24 hours on working days. Then enter the transfer reference and mark it paid. Account numbers are shown only here.</p>
      <label className="qb-field" style={{ maxWidth: 260 }}>Show<select value={filter} onChange={(e) => setFilter(e.target.value)}>{[["requested", "Waiting to be paid"], ["paid", "Paid"], ["rejected", "Not paid"], ["cancelled", "Cancelled"], ["", "Everything"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {done && <p className="qb-ok" role="status">{done}</p>}
      {rows === null ? <p className="qb-muted">Loading…</p> : !rows.length ? <p className="qb-muted">Nothing here.</p> :
        rows.map((p) => <div key={p.id} className="qb-card" style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{p.seller} · {cedis(p.amount_minor)}</strong>{p.overdue ? <span className="qb-pill danger">Overdue (due {when(p.due_at)})</span> : p.status === "requested" ? <span className="qb-pill warning">Due {when(p.due_at)}</span> : <span className="qb-pill neutral">{p.status}</span>}</div>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>{p.school} · {p.email} · asked {when(p.requested_at)} · {p.sales_count} sale{p.sales_count === 1 ? "" : "s"}: {cedis(p.gross_minor)} less QuizBox {cedis(p.platform_fee_minor)}{p.refunds_minor ? ` less refunds ${cedis(p.refunds_minor)}` : ""}</p>
          <p style={{ margin: 0 }}><strong>Send to:</strong> {p.destination.network} ({p.destination.method.replace("_", " ")}) <strong>{p.destination.account}</strong> · {p.destination.name} · phone {p.destination.phone}</p>
          {p.status === "requested" ? <>
            <div className="qb-grid cols-2"><input aria-label="Transfer reference" value={ref[p.id] ?? ""} onChange={(e) => setRef((r) => ({ ...r, [p.id]: e.target.value }))} placeholder="Transfer reference (to mark paid)" /><input aria-label="Note" value={note[p.id] ?? ""} onChange={(e) => setNote((r) => ({ ...r, [p.id]: e.target.value }))} placeholder="Note (a reason is needed to send back)" /></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="qb-btn" disabled={busy === p.id} onClick={() => void act(p.id, "paid")}>Mark as paid</button><button className="qb-btn secondary" disabled={busy === p.id} onClick={() => void act(p.id, "reject")}>Do not pay (return the money)</button></div>
          </> : <p className="qb-small qb-muted" style={{ margin: 0 }}>{p.paid_at ? `Paid ${when(p.paid_at)} · ref ${p.transfer_ref ?? ""}` : ""} {p.note}</p>}
        </div>)}
    </div>
  );
}

function Account({ onError }: { onError: (m: string) => void }) {
  const [s, setS] = useState<AdminSummary | null>(null), [open, setOpen] = useState<boolean | null>(null), [ref, setRef] = useState(""), [reason, setReason] = useState(""), [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(() => { adminSummary().then(setS).catch((e) => onError(e.message)); marketplaceOpen().then(setOpen); }, [onError]);
  useEffect(() => { load(); }, [load]);
  async function toggle(on: boolean) { setBusy(true); onError(""); try { await marketplaceSwitch(on); load(); } catch (e: any) { onError(e.message); } setBusy(false); }
  async function reverse() { setBusy(true); onError(""); setMsg(""); try { const r = await adminReverse(ref.trim(), reason); setMsg(r.outcome === "reversed" ? "Sale reversed: the buyer's access ended and the teacher's share was taken back." : "That sale was already reversed."); setRef(""); setReason(""); load(); } catch (e: any) { onError(e.message); } setBusy(false); }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="qb-card" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Marketplace switch</h3>
        <p className="qb-muted" style={{ margin: 0 }}>The Marketplace is {open === null ? "…" : open ? "OPEN to buyers" : "CLOSED to buyers"}. Teachers can set up accounts and prepare sets while it is closed. Open it only after Online payments work and you have approved a few sets.</p>
        <div style={{ display: "flex", gap: 8 }}><button className="qb-btn" disabled={busy || open !== false} onClick={() => void toggle(true)}>Open the Marketplace</button><button className="qb-btn secondary" disabled={busy || open !== true} onClick={() => void toggle(false)}>Close it</button></div>
      </section>
      {s && <section className="qb-card" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Merchant account</h3>
        <div className="qb-grid cols-4">
          <div><div className="qb-muted qb-small">Paid in by buyers ({s.sales_count} sales)</div><strong style={{ fontSize: 20 }}>{cedis(s.gross_minor)}</strong></div>
          <div><div className="qb-muted qb-small">QuizBox&apos;s 40%</div><strong style={{ fontSize: 20 }}>{cedis(s.platform_fee_minor)}</strong></div>
          <div><div className="qb-muted qb-small">Teachers&apos; 60%</div><strong style={{ fontSize: 20 }}>{cedis(s.seller_share_minor)}</strong></div>
          <div><div className="qb-muted qb-small">Refunded ({s.refunded_count})</div><strong style={{ fontSize: 20 }}>{cedis(s.refunded_minor)}</strong></div>
          <div><div className="qb-muted qb-small">Still owed to teachers</div><strong style={{ fontSize: 20 }}>{cedis(s.owed_to_sellers_minor)}</strong></div>
          <div><div className="qb-muted qb-small">Payouts waiting ({s.payouts_requested_count})</div><strong style={{ fontSize: 20 }}>{cedis(s.payouts_requested_minor)}</strong></div>
          <div><div className="qb-muted qb-small">Overdue payouts</div><strong style={{ fontSize: 20 }} className={s.payouts_overdue_count ? "qb-error" : ""}>{s.payouts_overdue_count}</strong></div>
          <div><div className="qb-muted qb-small">Paid out to teachers</div><strong style={{ fontSize: 20 }}>{cedis(s.paid_out_minor)}</strong></div>
        </div>
        <p className="qb-small qb-muted" style={{ margin: 0 }}>Sets: {Object.entries(s.items).map(([k, v]) => `${v} ${k}`).join(", ") || "none"} · Sellers: {Object.entries(s.sellers).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}. Gateway fees are paid from QuizBox&apos;s 40%.</p>
      </section>}
      <section className="qb-card qb-form" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Reverse a sale after a refund</h3>
        <p className="qb-muted qb-small" style={{ margin: 0 }}>When you refund a Marketplace purchase on the Paystack dashboard, the system reverses it by itself. Use this only if that did not happen. Enter the payment reference (starts with QB-). The buyer loses the set and the teacher&apos;s share is taken back.</p>
        <div className="qb-grid cols-2"><input aria-label="Payment reference" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="QB-…" /><input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the audit log)" /></div>
        {msg && <p className="qb-ok" role="status">{msg}</p>}
        <button className="qb-btn secondary" style={{ justifySelf: "start" }} disabled={busy || ref.trim().length < 4 || reason.trim().length < 5} onClick={() => void reverse()}>Reverse this sale</button>
      </section>
    </div>
  );
}

export default function AdminMarketplace() {
  const [tab, setTab] = useState<Tab>("review"), [error, setError] = useState("");
  const onError = useCallback((m: string) => setError(m), []);
  return (
    <>
      <div className="qb-page-head"><div><h1>Marketplace</h1><p>Review question sets, verify teachers, pay them out, and watch the merchant account.</p></div></div>
      <div role="tablist" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`qb-btn ${tab === k ? "" : "secondary"}`} onClick={() => { setTab(k); setError(""); }}>{l}</button>)}
      </div>
      <p style={{ margin: "0 0 12px" }}><ExportLink dataset={{ review: "mk_items", sellers: "mk_sellers", payouts: "mk_payouts", account: "mk_sales" }[tab]} label="Export this data" /></p>
      {error && <div className="qb-card qb-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {tab === "review" && <Review onError={onError} />}
      {tab === "sellers" && <Sellers onError={onError} />}
      {tab === "payouts" && <Payouts onError={onError} />}
      {tab === "account" && <Account onError={onError} />}
    </>
  );
}
