"use client";

import { useCallback, useEffect, useState } from "react";
import { cedis, when } from "@/lib/api/marketplace";
import {
  ACCRUAL_STATUS, AFFILIATE_STATUS, TIER_LABEL, adminAccruals, affiliateSwitch, adminAffiliates, adminDecide, adminReverse, adminSummary, policies, policyApprove, policySave,
  type AdminAccrual, type AdminAffiliate, type AdminSummary, type Policy,
} from "@/lib/api/affiliates";

// Finance view of the affiliate programme: applications, every commission, and the versioned policy. Owner, super admin and finance admin only (the database checks each call).
// Nothing accrues until a policy version is approved AND flags.affiliates is switched on (Admin, Access & Subscriptions).
type Tab = "applications" | "commissions" | "policy";

export default function AdminAffiliatesPage() {
  const [tab, setTab] = useState<Tab>("applications"), [error, setError] = useState(""), [sum, setSum] = useState<AdminSummary | null>(null);
  const loadSummary = useCallback(async () => { try { setSum(await adminSummary()); setError(""); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  const count = (k: string) => sum?.affiliates?.[k] ?? 0;
  return (
    <>
      <div className="qb-page-head"><div><h1>Affiliates</h1><p>Applications, commissions and the commission policy. Customers are never shown here, only payments and amounts.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {sum && <ProgrammeSwitch enabled={sum.enabled} hasPolicy={!!sum.policy} onChange={loadSummary} />}
      {sum && !sum.policy && <div className="qb-card" role="status">No commission policy is approved yet, so <strong>nothing can accrue</strong>. Review the pilot draft on the Policy tab.</div>}
      {sum && (
        <div className="qb-grid cols-4" style={{ marginBottom: 16 }}>
          <div className="qb-card"><div className="qb-muted qb-small">Waiting for review</div><div style={{ fontSize: 24, fontWeight: 700 }}>{count("applied")}</div></div>
          <div className="qb-card"><div className="qb-muted qb-small">Approved affiliates</div><div style={{ fontSize: 24, fontWeight: 700 }}>{count("approved")}</div></div>
          <div className="qb-card"><div className="qb-muted qb-small">Owed (held + approved)</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(Number(sum.balances.pending ?? 0) + Number(sum.balances.available ?? 0))}</div></div>
          <div className="qb-card"><div className="qb-muted qb-small">Paid out</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(Number(sum.balances.paid ?? 0))}</div></div>
        </div>
      )}
      <div role="tablist" aria-label="Affiliate sections" style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {(["applications", "commissions", "policy"] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "qb-btn" : "qb-btn secondary"} onClick={() => setTab(t)}>{t === "applications" ? "Applications" : t === "commissions" ? "Commissions" : "Policy"}</button>)}
      </div>
      {tab === "applications" && <Applications onChange={loadSummary} />}
      {tab === "commissions" && <Commissions sum={sum} onChange={loadSummary} />}
      {tab === "policy" && <PolicyTab onChange={loadSummary} />}
    </>
  );
}

// Owner and super admin only. Off: applications and links stop and nothing accrues, but refunds still reverse commissions and every record stays.
function ProgrammeSwitch({ enabled, hasPolicy, onChange }: { enabled: boolean; hasPolicy: boolean; onChange: () => void }) {
  const [sure, setSure] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function flip(on: boolean) { setBusy(true); setError(""); try { await affiliateSwitch(on); setSure(false); onChange(); } catch (e: any) { setError(e.message); } setBusy(false); }
  return (
    <div className="qb-card" role="status" style={{ display: "grid", gap: 8, marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`qb-pill ${enabled ? "success" : "neutral"}`}>{enabled ? "Programme is ON" : "Programme is OFF"}</span>
        <span className="qb-small">{enabled ? "Affiliates can apply and links work. Commission accrues once a policy is in force." : "Applications and referral links do not work, and no commission accrues."}</span>
      </div>
      {!enabled && (
        <>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>Before switching on: a policy version is in force{hasPolicy ? " (yes)" : " (not yet)"}, a Paystack test payment has produced one commission and a refund has reversed it, the affiliate terms have been reviewed by a lawyer, and the tax treatment is confirmed (see the deployment plan).</p>
          <label className="qb-check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I have checked these and want the programme open.</label>
          <button className="qb-btn" style={{ justifySelf: "start" }} disabled={busy || !sure || !hasPolicy} onClick={() => void flip(true)}>Switch the programme on</button>
        </>
      )}
      {enabled && <button className="qb-btn secondary" style={{ justifySelf: "start" }} disabled={busy} onClick={() => void flip(false)}>Switch the programme off</button>}
      {error && <p className="qb-error" role="alert">{error}</p>}
    </div>
  );
}

function Applications({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState("applied"), [rows, setRows] = useState<AdminAffiliate[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [ident, setIdent] = useState<Record<string, boolean>>({}), [note, setNote] = useState<Record<string, string>>({});
  const load = useCallback(async () => { try { setRows(await adminAffiliates(status)); setError(""); } catch (e: any) { setError(e.message); } }, [status]);
  useEffect(() => { void load(); }, [load]);
  async function act(a: AdminAffiliate, action: "approve" | "reject" | "suspend" | "reinstate" | "terminate") {
    setBusy(a.id); setError("");
    try { await adminDecide(a.id, action, note[a.id] ?? "", !!ident[a.id]); await load(); onChange(); } catch (e: any) { setError(e.message); }
    setBusy("");
  }
  return (
    <section className="qb-card" style={{ display: "grid", gap: 12 }}>
      <label className="qb-field" style={{ maxWidth: 260 }}>Show<select value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(AFFILIATE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {error && <p className="qb-error" role="alert">{error}</p>}
      {!rows.length ? <p className="qb-muted">Nothing here.</p> : rows.map((a) => (
        <div key={a.id} className="qb-card" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div><strong>{a.name}</strong> <span className="qb-muted qb-small">{a.email} · {a.phone}</span></div>
            <div className="qb-small qb-muted">Applied {when(a.applied_at)} · Code {a.code} · {TIER_LABEL[a.tier]} · {a.referrals} joined, {a.paid_referrals} paid</div>
          </div>
          <div className="qb-small">{a.has_payout_details ? (a.payout_verified ? "Payout details on file and checked." : "Payout details on file, not yet checked.") : "No payout details yet. They are needed before approval."}</div>
          {a.status === "applied" && (
            <label className="qb-check"><input type="checkbox" checked={!!ident[a.id]} onChange={(e) => setIdent({ ...ident, [a.id]: e.target.checked })} /> I checked this person&apos;s identity (a valid ID) and they are 18 or older.</label>
          )}
          <input aria-label={`Reason for ${a.name}`} placeholder="Reason (needed to reject, pause or end)" value={note[a.id] ?? ""} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {a.status === "applied" && <><button className="qb-btn" disabled={busy === a.id} onClick={() => void act(a, "approve")}>Approve</button><button className="qb-btn secondary" disabled={busy === a.id} onClick={() => void act(a, "reject")}>Not approved</button></>}
            {a.status === "approved" && <><button className="qb-btn secondary" disabled={busy === a.id} onClick={() => void act(a, "suspend")}>Pause</button><button className="qb-btn secondary" disabled={busy === a.id} onClick={() => void act(a, "terminate")}>End</button></>}
            {a.status === "suspended" && <><button className="qb-btn" disabled={busy === a.id} onClick={() => void act(a, "reinstate")}>Restore</button><button className="qb-btn secondary" disabled={busy === a.id} onClick={() => void act(a, "terminate")}>End</button></>}
          </div>
        </div>
      ))}
    </section>
  );
}

function Commissions({ sum, onChange }: { sum: AdminSummary | null; onChange: () => void }) {
  const [status, setStatus] = useState(""), [rows, setRows] = useState<AdminAccrual[]>([]), [error, setError] = useState(""), [ref, setRef] = useState(""), [why, setWhy] = useState(""), [done, setDone] = useState("");
  const load = useCallback(async () => { try { setRows(await adminAccruals(status || null, 100)); setError(""); } catch (e: any) { setError(e.message); } }, [status]);
  useEffect(() => { void load(); }, [load]);
  async function reverse() {
    setError(""); setDone("");
    try { const r = await adminReverse(ref.trim(), why); setDone(r.reversed ? `Reversed ${r.reversed} commission${r.reversed === 1 ? "" : "s"}.` : "Nothing to reverse."); setRef(""); setWhy(""); await load(); onChange(); } catch (e: any) { setError(e.message); }
  }
  return (
    <section style={{ display: "grid", gap: 16 }}>
      {sum && (
        <div className="qb-card" style={{ display: "grid", gap: 4 }}>
          <h3 style={{ margin: 0 }}>Ledger</h3>
          <p className="qb-small" style={{ margin: 0 }}>Held {cedis(Number(sum.balances.pending ?? 0))} · Approved {cedis(Number(sum.balances.available ?? 0))} · In a payout {cedis(Number(sum.balances.reserved ?? 0))} · Paid {cedis(Number(sum.balances.paid ?? 0))}. Total of all ledger rows: {cedis(sum.ledger_total_minor)}.</p>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>Held back by the {sum.policy?.cap_percent ?? 15}% cap so far: {cedis(sum.cap_clipped_minor)}. A negative &quot;Approved&quot; figure means refunds after approval that later earnings will offset.</p>
        </div>
      )}
      <div className="qb-card" style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Reverse a commission</h3>
        <p className="qb-small qb-muted" style={{ margin: 0 }}>Refunds reported by Paystack reverse automatically. Use this only for a refund you made outside Paystack. Enter the payment reference (starts with QB-).</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input aria-label="Payment reference" placeholder="QB-…" value={ref} onChange={(e) => setRef(e.target.value)} style={{ flex: "1 1 200px" }} />
          <input aria-label="Reason" placeholder="Reason" value={why} onChange={(e) => setWhy(e.target.value)} style={{ flex: "2 1 260px" }} />
          <button className="qb-btn" disabled={!ref.trim() || why.trim().length < 5} onClick={() => void reverse()}>Reverse</button>
        </div>
        {done && <p className="qb-ok" role="status">{done}</p>}
      </div>
      {error && <p className="qb-error" role="alert">{error}</p>}
      <div className="qb-card">
        <label className="qb-field" style={{ maxWidth: 260 }}>Show<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{Object.entries(ACCRUAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {!rows.length ? <p className="qb-muted">No commissions yet.</p> : (
          <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>When</th><th>Affiliate</th><th>Payment</th><th>Net revenue</th><th>Rate</th><th>Commission</th><th>Status</th></tr></thead><tbody>
            {rows.map((r) => <tr key={r.id}><td>{when(r.created_at)}</td><td>{r.affiliate}<div className="qb-small qb-muted">{TIER_LABEL[r.tier]} · policy v{r.policy_version}</div></td><td className="qb-small">{r.reference}<div className="qb-muted">Gross {cedis(r.gross_minor)}, tax {cedis(r.tax_minor)}</div></td>
              <td>{cedis(r.net_minor)}</td><td>{r.rate_percent}%{r.cap_clipped_minor ? <div className="qb-small qb-muted">cap held back {cedis(r.cap_clipped_minor)}</div> : null}</td><td>{cedis(r.amount_minor)}</td>
              <td><span className={`qb-pill ${r.status === "reversed" ? "danger" : r.status === "pending" ? "warning" : "success"}`}>{ACCRUAL_STATUS[r.status]}</span>{r.status === "pending" && <div className="qb-small qb-muted">until {when(r.release_at)}</div>}</td></tr>)}
          </tbody></table></div>
        )}
      </div>
    </section>
  );
}

const blank = { name: "", rates: { registered: 10, growth: 12.5, ambassador: 15 }, growth: 10, ambassador: 30, tierWindow: 90, cap: 15, hold: 30, window: 30, minPayoutMinor: 5000, tax: 0, purposes: ["subscription"], pilot: true, note: "" };

function PolicyTab({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<Policy[]>([]), [error, setError] = useState(""), [f, setF] = useState(blank), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { try { setRows(await policies()); setError(""); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  const num = (v: string) => (v === "" ? 0 : Number(v));
  async function run(fn: () => Promise<unknown>) { setBusy(true); setError(""); try { await fn(); await load(); onChange(); } catch (e: any) { setError(e.message); } setBusy(false); }
  return (
    <section style={{ display: "grid", gap: 16 }}>
      <div className="qb-card" style={{ display: "grid", gap: 6 }}>
        <p style={{ margin: 0 }}>A policy version is never edited. To change a rate, save a new version and approve it; sales already recorded keep the version they were made under. A different person must approve it (the owner may approve their own, and that is recorded).</p>
        <p className="qb-small qb-muted" style={{ margin: 0 }}>Renewal commissions are not available: they stay off until they have been independently reviewed. The combined affiliate + manager share of one sale can never exceed the cap below.</p>
      </div>
      {error && <p className="qb-error" role="alert">{error}</p>}
      {rows.map((p) => (
        <div key={p.id} className="qb-card" style={{ display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>Version {p.version}: {p.name}</strong>
            <span className={`qb-pill ${p.status === "approved" ? "success" : p.status === "draft" ? "warning" : "neutral"}`}>{p.status === "approved" ? "In force" : p.status === "draft" ? "Draft" : "Retired"}</span>
            {p.is_pilot && <span className="qb-pill neutral">Pilot values</span>}
          </div>
          <div className="qb-small">Rates: Registered {p.tier_rates.registered}% · Growth {p.tier_rates.growth}% (from {p.growth_min_referrals} paid) · Ambassador {p.tier_rates.ambassador}% (from {p.ambassador_min_referrals} paid) in {p.tier_window_days} days.</div>
          <div className="qb-small">Combined cap {p.acquisition_cap_percent}% · hold {p.hold_days} days · link valid {p.attribution_window_days} days · smallest payout {cedis(p.min_payout_minor)} · tax share removed first {p.tax_percent}% · applies to: {p.eligible_purposes.join(", ")}.</div>
          {p.note && <div className="qb-small qb-muted">{p.note}</div>}
          {p.status === "draft" && <button className="qb-btn" style={{ justifySelf: "start" }} disabled={busy} onClick={() => void run(() => policyApprove(p.id))}>Approve and make this the policy in force</button>}
        </div>
      ))}
      <details className="qb-card">
        <summary><strong>Save a new draft version</strong></summary>
        <div className="qb-form" style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div className="qb-grid cols-2">
            <label className="qb-field" style={{ gridColumn: "1 / -1" }}>Name<input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Pilot policy v2" /></label>
            <label className="qb-field">Registered Affiliate %<input inputMode="decimal" value={f.rates.registered} onChange={(e) => setF({ ...f, rates: { ...f.rates, registered: num(e.target.value) } })} /></label>
            <label className="qb-field">Growth Partner %<input inputMode="decimal" value={f.rates.growth} onChange={(e) => setF({ ...f, rates: { ...f.rates, growth: num(e.target.value) } })} /></label>
            <label className="qb-field">QuizBox Ambassador %<input inputMode="decimal" value={f.rates.ambassador} onChange={(e) => setF({ ...f, rates: { ...f.rates, ambassador: num(e.target.value) } })} /></label>
            <label className="qb-field">Combined cap %<input inputMode="decimal" value={f.cap} onChange={(e) => setF({ ...f, cap: num(e.target.value) })} /></label>
            <label className="qb-field">Growth after (paid referrals)<input inputMode="numeric" value={f.growth} onChange={(e) => setF({ ...f, growth: num(e.target.value) })} /></label>
            <label className="qb-field">Ambassador after (paid referrals)<input inputMode="numeric" value={f.ambassador} onChange={(e) => setF({ ...f, ambassador: num(e.target.value) })} /></label>
            <label className="qb-field">Counted over (days)<input inputMode="numeric" value={f.tierWindow} onChange={(e) => setF({ ...f, tierWindow: num(e.target.value) })} /></label>
            <label className="qb-field">Hold before approval (days)<input inputMode="numeric" value={f.hold} onChange={(e) => setF({ ...f, hold: num(e.target.value) })} /></label>
            <label className="qb-field">Link valid for (days)<input inputMode="numeric" value={f.window} onChange={(e) => setF({ ...f, window: num(e.target.value) })} /></label>
            <label className="qb-field">Smallest payout (pesewas, 5000 = GHS 50)<input inputMode="numeric" value={f.minPayoutMinor} onChange={(e) => setF({ ...f, minPayoutMinor: num(e.target.value) })} /></label>
            <label className="qb-field">Tax share inside the price %<input inputMode="decimal" value={f.tax} onChange={(e) => setF({ ...f, tax: num(e.target.value) })} /></label>
            <label className="qb-field" style={{ gridColumn: "1 / -1" }}>Note<input value={f.note} maxLength={500} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
          </div>
          <label className="qb-check"><input type="checkbox" checked={f.pilot} onChange={(e) => setF({ ...f, pilot: e.target.checked })} /> These are pilot values, not final policy.</label>
          <button className="qb-btn" style={{ justifySelf: "start" }} disabled={busy || f.name.trim().length < 3} onClick={() => void run(() => policySave(f))}>Save draft</button>
        </div>
      </details>
    </section>
  );
}
