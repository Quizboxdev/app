"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { cedis, when } from "@/lib/api/marketplace";
import { Kpi, Panel, RankedBars, Segmented, SERIES, SplitBar, num as fmt } from "@/components/admin/DataViz";
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
  const bal = (k: "pending" | "available" | "reserved" | "paid") => Number(sum?.balances?.[k] ?? 0);
  const statusRows = Object.entries(sum?.affiliates ?? {}).map(([k, v]) => ({ key: k, label: AFFILIATE_STATUS[k] ?? k, segments: [{ value: Number(v), color: SERIES.a, name: "Affiliates" }] }));
  const accrualRows = Object.entries(sum?.accruals ?? {}).map(([k, v]) => ({ key: k, label: ACCRUAL_STATUS[k] ?? k, segments: [{ value: Number(v.count), color: SERIES.b, name: "Commissions" }] }));
  return (
    <div className="dx-page">
      <div className="dx-head"><div><h1>Affiliates</h1><p>Applications, commissions and the commission policy. Customers are never shown here, only payments and amounts.</p></div></div>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {sum && <ProgrammeSwitch enabled={sum.enabled} hasPolicy={!!sum.policy} onChange={loadSummary} />}
      {sum && !sum.policy && <div className="dx-alert" role="status">No commission policy is approved yet, so <strong>nothing can accrue</strong>. Review the pilot draft on the Policy tab.</div>}
      <div className="dx-kpis">
        <Kpi label="Waiting for review" value={sum ? count("applied") : "—"} tone={count("applied") > 0 ? "warn" : "default"} />
        <Kpi label="Approved affiliates" value={sum ? count("approved") : "—"} />
        <Kpi label="Owed (held + approved)" value={sum ? cedis(bal("pending") + bal("available")) : "—"} hint={sum ? `held ${cedis(bal("pending"))}` : undefined} />
        <Kpi label="In a payout" value={sum ? cedis(bal("reserved")) : "—"} />
        <Kpi label="Paid out" value={sum ? cedis(bal("paid")) : "—"} />
        <Kpi label="Held back by the cap" value={sum ? cedis(sum.cap_clipped_minor) : "—"} hint={sum?.policy ? `${sum.policy.cap_percent}% cap` : undefined} />
      </div>
      {sum && (
        <div className="dx-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <Panel title="Affiliates by status">{statusRows.length ? <RankedBars rows={statusRows} unit="affiliates" limit={6} /> : <p className="dx-muted dx-note">No affiliates yet.</p>}</Panel>
          <Panel title="Commissions by status">{accrualRows.length ? <RankedBars rows={accrualRows} unit="commissions" limit={6} /> : <p className="dx-muted dx-note">No commissions yet.</p>}</Panel>
          <Panel title="Where the money is" subtitle="Ledger balances"><SplitBar parts={[{ name: "Held", value: Math.max(bal("pending"), 0), color: SERIES.b }, { name: "Approved", value: Math.max(bal("available"), 0), color: SERIES.a }, { name: "In a payout", value: Math.max(bal("reserved"), 0), color: SERIES.c }, { name: "Paid", value: Math.max(bal("paid"), 0), color: SERIES.d }]} /></Panel>
        </div>
      )}
      <div className="dx-toolbar">
        <Segmented<Tab> label="Affiliate sections" value={tab} onChange={setTab} options={[{ value: "applications", label: "Applications", count: sum ? count("applied") : undefined }, { value: "commissions", label: "Commissions" }, { value: "policy", label: "Policy" }]} />
      </div>
      {tab === "applications" && <Applications onChange={loadSummary} />}
      {tab === "commissions" && <Commissions sum={sum} onChange={loadSummary} />}
      {tab === "policy" && <PolicyTab onChange={loadSummary} />}
    </div>
  );
}

// Owner and super admin only. Off: applications and links stop and nothing accrues, but refunds still reverse commissions and every record stays.
function ProgrammeSwitch({ enabled, hasPolicy, onChange }: { enabled: boolean; hasPolicy: boolean; onChange: () => void }) {
  const [sure, setSure] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function flip(on: boolean) { setBusy(true); setError(""); try { await affiliateSwitch(on); setSure(false); onChange(); } catch (e: any) { setError(e.message); } setBusy(false); }
  return (
    <div className="dx-panel" role="status" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`dx-pill ${enabled ? "ok" : ""}`}>{enabled ? "Programme is ON" : "Programme is OFF"}</span>
        <span className="qb-small">{enabled ? "Affiliates can apply and links work. Commission accrues once a policy is in force." : "Applications and referral links do not work, and no commission accrues."}</span>
      </div>
      {!enabled && (
        <>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>Before switching on: a policy version is in force{hasPolicy ? " (yes)" : " (not yet)"}, a Paystack test payment has produced one commission and a refund has reversed it, the affiliate terms have been reviewed by a lawyer, and the tax treatment is confirmed (see the deployment plan).</p>
          <label className="qb-check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} /> I have checked these and want the programme open.</label>
          <button className="dx-btn primary" style={{ justifySelf: "start" }} disabled={busy || !sure || !hasPolicy} onClick={() => void flip(true)}>Switch the programme on</button>
        </>
      )}
      {enabled && <button className="dx-btn" style={{ justifySelf: "start" }} disabled={busy} onClick={() => void flip(false)}>Switch the programme off</button>}
      {error && <p className="qb-error" role="alert">{error}</p>}
    </div>
  );
}

function Applications({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState("applied"), [rows, setRows] = useState<AdminAffiliate[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  const [ident, setIdent] = useState<Record<string, boolean>>({}), [note, setNote] = useState<Record<string, string>>({}), [open, setOpen] = useState(""), [search, setSearch] = useState("");
  const load = useCallback(async () => { try { setRows(await adminAffiliates(status)); setError(""); } catch (e: any) { setError(e.message); setRows([]); } }, [status]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  async function act(a: AdminAffiliate, action: "approve" | "reject" | "suspend" | "reinstate" | "terminate") {
    setBusy(a.id); setError("");
    try { await adminDecide(a.id, action, note[a.id] ?? "", !!ident[a.id]); setOpen(""); await load(); onChange(); } catch (e: any) { setError(e.message); }
    setBusy("");
  }
  const shown = useMemo(() => { const q = search.trim().toLowerCase(); return (rows ?? []).filter((a) => !q || `${a.name} ${a.email} ${a.code}`.toLowerCase().includes(q)); }, [rows, search]);
  return (
    <>
      <div className="dx-toolbar">
        <select className="dx-select" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>{Object.entries(AFFILIATE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input className="dx-input" type="search" placeholder="Search name, email or code" aria-label="Search affiliates" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      <div className="dx-table-wrap">
        <table className="dx-table">
          <thead><tr><th>Affiliate</th><th>Applied</th><th>Code</th><th>Tier</th><th className="num">Joined</th><th className="num">Paid</th><th>Payout details</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={8} className="dx-muted">Loading…</td></tr> : !shown.length ? <tr><td colSpan={8} className="dx-muted">Nothing here.</td></tr> : shown.map((a) => (
              <Fragment key={a.id}>
                <tr>
                  <td className="name">{a.name}<div className="dx-muted" style={{ fontWeight: 400, fontSize: 12 }}>{a.email} · {a.phone}</div></td>
                  <td className="dx-muted">{when(a.applied_at)}</td><td className="dx-muted">{a.code}</td><td>{TIER_LABEL[a.tier]}</td>
                  <td className="num">{fmt(a.referrals)}</td><td className="num">{fmt(a.paid_referrals)}</td>
                  <td>{a.has_payout_details ? <span className={`dx-pill ${a.payout_verified ? "ok" : "warn"}`}>{a.payout_verified ? "checked" : "not checked"}</span> : <span className="dx-pill warn">none yet</span>}</td>
                  <td><button className="dx-btn sm" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? "" : a.id)}>{open === a.id ? "Close" : "Decide"}</button></td>
                </tr>
                {open === a.id && (
                  <tr className="dx-detail"><td colSpan={8}>
                    <div style={{ display: "grid", gap: 8 }}>
                      {!a.has_payout_details && a.status === "applied" && <p className="dx-muted dx-note" style={{ margin: 0 }}>No payout details yet. They are needed before approval.</p>}
                      {a.status === "applied" && <label className="dx-check"><input type="checkbox" checked={!!ident[a.id]} onChange={(e) => setIdent({ ...ident, [a.id]: e.target.checked })} /> I checked this person&apos;s identity (a valid ID) and they are 18 or older.</label>}
                      <input className="dx-input" style={{ width: "100%", maxWidth: 520 }} aria-label={`Reason for ${a.name}`} placeholder="Reason (needed to reject, pause or end)" value={note[a.id] ?? ""} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} />
                      <div className="dx-actions">
                        {a.status === "applied" && <><button className="dx-btn primary" disabled={busy === a.id} onClick={() => void act(a, "approve")}>Approve</button><button className="dx-btn danger" disabled={busy === a.id} onClick={() => void act(a, "reject")}>Not approved</button></>}
                        {a.status === "approved" && <><button className="dx-btn" disabled={busy === a.id} onClick={() => void act(a, "suspend")}>Pause</button><button className="dx-btn danger" disabled={busy === a.id} onClick={() => void act(a, "terminate")}>End</button></>}
                        {a.status === "suspended" && <><button className="dx-btn primary" disabled={busy === a.id} onClick={() => void act(a, "reinstate")}>Restore</button><button className="dx-btn danger" disabled={busy === a.id} onClick={() => void act(a, "terminate")}>End</button></>}
                      </div>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dx-pager"><span>{fmt(shown.length)} affiliates</span></div>
    </>
  );
}

function Commissions({ sum, onChange }: { sum: AdminSummary | null; onChange: () => void }) {
  const [status, setStatus] = useState(""), [rows, setRows] = useState<AdminAccrual[] | null>(null), [error, setError] = useState(""), [ref, setRef] = useState(""), [why, setWhy] = useState(""), [done, setDone] = useState(""), [search, setSearch] = useState("");
  const load = useCallback(async () => { try { setRows(await adminAccruals(status || null, 100)); setError(""); } catch (e: any) { setError(e.message); setRows([]); } }, [status]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  async function reverse() {
    setError(""); setDone("");
    try { const r = await adminReverse(ref.trim(), why); setDone(r.reversed ? `Reversed ${r.reversed} commission${r.reversed === 1 ? "" : "s"}.` : "Nothing to reverse."); setRef(""); setWhy(""); await load(); onChange(); } catch (e: any) { setError(e.message); }
  }
  const shown = useMemo(() => { const q = search.trim().toLowerCase(); return (rows ?? []).filter((r) => !q || `${r.affiliate} ${r.reference}`.toLowerCase().includes(q)); }, [rows, search]);
  return (
    <>
      {sum && <p className="dx-muted dx-note" style={{ margin: 0 }}>Held back by the {sum.policy?.cap_percent ?? 15}% cap so far: {cedis(sum.cap_clipped_minor)}. A negative &quot;Approved&quot; balance means refunds after approval that later earnings will offset.</p>}
      <Panel title="Reverse a commission" subtitle="Refunds reported by Paystack reverse automatically. Use this only for a refund you made outside Paystack. Enter the payment reference (starts with QB-).">
        <div className="dx-actions" style={{ alignItems: "center" }}>
          <input className="dx-input" aria-label="Payment reference" placeholder="QB-…" value={ref} onChange={(e) => setRef(e.target.value)} style={{ flex: "1 1 200px" }} />
          <input className="dx-input" aria-label="Reason" placeholder="Reason" value={why} onChange={(e) => setWhy(e.target.value)} style={{ flex: "2 1 260px", width: "auto" }} />
          <button className="dx-btn danger" disabled={!ref.trim() || why.trim().length < 5} onClick={() => void reverse()}>Reverse</button>
        </div>
        {done && <p className="dx-note" role="status" style={{ color: "var(--green)" }}>{done}</p>}
      </Panel>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      <div className="dx-toolbar">
        <select className="dx-select" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{Object.entries(ACCRUAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input className="dx-input" type="search" placeholder="Search affiliate or payment" aria-label="Search commissions" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="dx-table-wrap">
        <table className="dx-table">
          <thead><tr><th>When</th><th>Affiliate</th><th>Payment</th><th className="num">Net revenue</th><th className="num">Rate</th><th className="num">Commission</th><th>Status</th></tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={7} className="dx-muted">Loading…</td></tr> : !shown.length ? <tr><td colSpan={7} className="dx-muted">No commissions yet.</td></tr> : shown.map((r) => (
              <tr key={r.id}>
                <td className="dx-muted">{when(r.created_at)}</td>
                <td className="name">{r.affiliate}<div className="dx-muted" style={{ fontWeight: 400, fontSize: 12 }}>{TIER_LABEL[r.tier]} · policy v{r.policy_version}</div></td>
                <td className="dx-muted">{r.reference}</td>
                <td className="num">{cedis(r.net_minor)}</td>
                <td className="num">{r.rate_percent}%{r.cap_clipped_minor ? <div className="dx-muted" style={{ fontSize: 12 }}>cap held back {cedis(r.cap_clipped_minor)}</div> : null}</td>
                <td className="num">{cedis(r.amount_minor)}</td>
                <td><span className={`dx-pill ${r.status === "reversed" ? "bad" : r.status === "pending" ? "warn" : "ok"}`}>{ACCRUAL_STATUS[r.status]}</span>{r.status === "pending" && <div className="dx-muted" style={{ fontSize: 12 }}>until {when(r.release_at)}</div>}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
      <div className="dx-pager"><span>{fmt(shown.length)} of the latest 100 commissions</span></div>
    </>
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
