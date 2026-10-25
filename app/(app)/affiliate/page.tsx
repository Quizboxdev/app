"use client";

import { useCallback, useEffect, useState } from "react";
import { cedis, when } from "@/lib/api/marketplace";
import { ACCRUAL_STATUS, AFFILIATE_STATUS, TIER_LABEL, affiliateApply, affiliateMe, affiliatePayoutSave, affiliateSummary, shareLink, type AffiliateMe, type AffiliateSummary } from "@/lib/api/affiliates";

// Refer and earn: an adult applies, staff approve, the affiliate shares a link, and a commission is held and then approved when a referred customer's first subscription is paid. Buyers are never named here.
// The terms below are a DRAFT until a lawyer has reviewed them (docs/quizbox-transformation/13_OPEN_DECISIONS_AND_RISKS.md, L-2).
const NETWORKS = ["MTN", "Vodafone (Telecel)", "AirtelTigo", "GCB Bank", "Ecobank", "Fidelity Bank", "Absa", "Stanbic", "Zenith Bank", "CalBank", "Access Bank", "Other bank"];

export default function AffiliatePage() {
  const [me, setMe] = useState<AffiliateMe | null>(null), [sum, setSum] = useState<AffiliateSummary | null>(null), [error, setError] = useState(""), [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    try {
      const m = await affiliateMe(); setMe(m);
      if (m.applied && (m.status === "approved" || m.status === "suspended")) setSum(await affiliateSummary());
    } catch (e: any) { setError(e.message); setMe({ enabled: false, applied: false }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!me) return <div className="qb-card qb-muted">Loading…</div>;
  const link = me.referral_code ? shareLink(window.location.origin, me.referral_code) : "";
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError("Copy did not work. Select the link and copy it by hand."); } };

  return (
    <>
      <div className="qb-page-head"><div><h1>Refer and earn</h1><p>Share QuizBox with parents and schools. When someone you referred pays for their first subscription, you earn a commission.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {!me.enabled && <div className="qb-card" role="status">The affiliate programme is not open yet. Please check back soon.</div>}

      {me.enabled && !me.applied && <ApplyForm onDone={load} />}

      {me.enabled && me.applied && (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="qb-card" role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`qb-pill ${me.status === "approved" ? "success" : me.status === "applied" ? "warning" : "danger"}`}>{AFFILIATE_STATUS[me.status ?? "applied"]}</span>
            <span>{me.status === "applied" ? "We are checking your application and your payout details. We will tell you as soon as you are approved." : me.status === "approved" ? `You are a ${TIER_LABEL[me.tier ?? "registered"]}.` :
              me.status === "suspended" ? "Your affiliate account is paused. Your earnings are safe. Please contact support." : me.status === "rejected" ? "Your application was not approved." : "Your affiliate account has ended."}</span>
            {me.decision_note && <span className="qb-muted qb-small">{me.decision_note}</span>}
          </div>

          {me.status === "approved" && me.referral_code && (
            <section className="qb-card" style={{ display: "grid", gap: 10 }}>
              <h3 style={{ margin: 0 }}>Your link</h3>
              <p className="qb-muted qb-small" style={{ margin: 0 }}>Anyone who opens this link and then signs up is yours for 30 days. Only a real, paid first subscription earns a commission. You do not earn on yourself or on people who joined before.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input readOnly aria-label="Your referral link" value={link} onFocus={(e) => e.currentTarget.select()} style={{ flex: "1 1 280px" }} />
                <button className="qb-btn" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
              </div>
              <p className="qb-small qb-muted" style={{ margin: 0 }}>Your code: <strong>{me.referral_code}</strong></p>
            </section>
          )}

          {sum && (
            <>
              <div className="qb-grid cols-4">
                <div className="qb-card"><div className="qb-muted qb-small">Held until checked{sum.policy ? ` (${sum.policy.hold_days} days)` : ""}</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(sum.balances.pending)}</div></div>
                <div className="qb-card"><div className="qb-muted qb-small">Approved</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(sum.balances.available)}</div></div>
                <div className="qb-card"><div className="qb-muted qb-small">In a payout</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(sum.balances.reserved)}</div></div>
                <div className="qb-card"><div className="qb-muted qb-small">Paid to you</div><div style={{ fontSize: 24, fontWeight: 700 }}>{cedis(sum.balances.paid)}</div></div>
              </div>
              <section className="qb-card" style={{ display: "grid", gap: 6 }}>
                <h3 style={{ margin: 0 }}>Your progress</h3>
                <p style={{ margin: 0 }}>{sum.referrals.signed_up} {sum.referrals.signed_up === 1 ? "person has" : "people have"} joined through your link and {sum.referrals.paid} {sum.referrals.paid === 1 ? "has" : "have"} paid.</p>
                {sum.policy ? (
                  <p className="qb-small qb-muted" style={{ margin: 0 }}>
                    Your rate: {sum.policy.rates[sum.tier]}% ({TIER_LABEL[sum.tier]}). {sum.referrals.in_window} paid in the last {sum.referrals.window_days} days.
                    {sum.referrals.growth_at ? ` Growth Partner (${sum.policy.rates.growth}%) at ${sum.referrals.growth_at} paid; Ambassador (${sum.policy.rates.ambassador}%) at ${sum.referrals.ambassador_at}.` : ""}
                    {sum.policy.pilot ? " These are pilot rates and can change for new sales." : ""}
                  </p>
                ) : <p className="qb-small qb-muted" style={{ margin: 0 }}>Commission rates are confirmed when the programme starts. Nothing is earned until then.</p>}
                {sum.policy && <p className="qb-small qb-muted" style={{ margin: 0 }}>A commission becomes approved {sum.policy.hold_days} days after the payment. If the payment is refunded, the commission is taken back. The smallest payout is {cedis(sum.policy.min_payout_minor)}.</p>}
              </section>
              {!!sum.recent.length && (
                <section className="qb-card"><h3>Recent commissions</h3>
                  <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>When</th><th>Commission</th><th>Rate</th><th>Status</th><th>Approved on</th></tr></thead><tbody>
                    {sum.recent.map((r, n) => <tr key={n}><td>{when(r.created_at)}</td><td>{cedis(r.amount_minor)}</td><td>{r.rate_percent}%</td><td><span className={`qb-pill ${r.status === "reversed" ? "danger" : r.status === "pending" ? "warning" : "success"}`}>{ACCRUAL_STATUS[r.status]}</span></td><td>{r.status === "pending" ? when(r.release_at) : ""}</td></tr>)}
                  </tbody></table></div>
                </section>
              )}
            </>
          )}

          {(me.status === "applied" || me.status === "approved") && <PayoutForm me={me} onSaved={load} />}
        </div>
      )}
    </>
  );
}

function ApplyForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", adult: false, terms: false }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try { await affiliateApply({ display_name: f.name, phone: f.phone, adult: f.adult, accept_terms: f.terms }); onDone(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  return (
    <div className="qb-card qb-form" style={{ display: "grid", gap: 12 }}>
      <h3 style={{ margin: 0 }}>Become an affiliate</h3>
      <div className="qb-grid cols-2">
        <label className="qb-field">Your name<input value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Ama Mensah" /></label>
        <label className="qb-field">Phone number<input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[^0-9+ ]/g, "") })} placeholder="0244 000 000" /></label>
      </div>
      <fieldset className="qb-card" style={{ margin: 0, display: "grid", gap: 6 }}>
        <legend className="qb-small"><strong>How it works (draft terms, being reviewed by our lawyer)</strong></legend>
        <ul className="qb-list qb-small" style={{ margin: 0 }}>
          <li>Only adults aged 18 or over can be affiliates. Children and school-managed learners cannot.</li>
          <li>It costs nothing to join. You never pay to be an affiliate and you never earn for recruiting other affiliates.</li>
          <li>You earn a commission only on the <strong>first paid subscription</strong> of a person who joined through your link. Not on renewals, and not on yourself.</li>
          <li>A commission is held for a checking period. If the payment is refunded, the commission is taken back.</li>
          <li>QuizBox checks every application and your payout details before you are approved, and may pause an account that breaks these rules.</li>
          <li>Commissions are paid by hand, from the smallest payout amount, to the account you give us.</li>
        </ul>
        <label className="qb-check"><input type="checkbox" checked={f.adult} onChange={(e) => setF({ ...f, adult: e.target.checked })} /> I am 18 or older.</label>
        <label className="qb-check"><input type="checkbox" checked={f.terms} onChange={(e) => setF({ ...f, terms: e.target.checked })} /> I have read and accept these terms.</label>
      </fieldset>
      {error && <p className="qb-error" role="alert">{error}</p>}
      <button className="qb-btn" disabled={busy || !f.adult || !f.terms} onClick={() => void submit()} style={{ justifySelf: "start" }}>{busy ? "Sending…" : "Apply"}</button>
    </div>
  );
}

function PayoutForm({ me, onSaved }: { me: AffiliateMe; onSaved: () => void }) {
  const [f, setF] = useState({ method: (me.payout?.method ?? "mobile_money") as "mobile_money" | "bank", network: me.payout?.network ?? "MTN", account: "", account_name: me.payout?.account_name ?? "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  async function save() {
    setBusy(true); setError(""); setSaved(false);
    try { await affiliatePayoutSave(f); setSaved(true); setF((x) => ({ ...x, account: "" })); onSaved(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  return (
    <details className="qb-card" open={!me.payout}>
      <summary><strong>Where we pay you</strong>{me.payout ? <span className="qb-muted qb-small"> · {me.payout.network} {me.payout.account_masked}{me.payout.verified ? " · checked" : " · waiting to be checked"}</span> : <span className="qb-muted qb-small"> · needed before approval</span>}</summary>
      <div className="qb-form" style={{ display: "grid", gap: 12, marginTop: 12 }}>
        <div className="qb-grid cols-2">
          <label className="qb-field">Get paid by<select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as "mobile_money" | "bank" })}><option value="mobile_money">Mobile money</option><option value="bank">Bank account</option></select></label>
          <label className="qb-field">{f.method === "bank" ? "Bank" : "Network"}<select value={f.network} onChange={(e) => setF({ ...f, network: e.target.value })}>{NETWORKS.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label className="qb-field">{f.method === "bank" ? "Account number" : "Mobile money number"}<input inputMode="numeric" value={f.account} onChange={(e) => setF({ ...f, account: e.target.value.replace(/\D/g, "") })} /></label>
          <label className="qb-field">Name on the account (must match your own name)<input value={f.account_name} maxLength={80} onChange={(e) => setF({ ...f, account_name: e.target.value })} /></label>
        </div>
        <p className="qb-small qb-muted" style={{ margin: 0 }}>We only ever show the last 4 digits. Changing these details means we check them again before the next payout.</p>
        {error && <p className="qb-error" role="alert">{error}</p>}
        {saved && <p className="qb-ok" role="status">Saved.</p>}
        <button className="qb-btn" disabled={busy || !f.account || !f.account_name} onClick={() => void save()} style={{ justifySelf: "start" }}>{busy ? "Saving…" : "Save payout details"}</button>
      </div>
    </details>
  );
}
