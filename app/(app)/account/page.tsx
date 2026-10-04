"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { getMyAccount, listSignupCountries, requestMarketChange, type Account, type SignupCountry } from "@/lib/api/markets";
import { userFacingError } from "@/lib/errors";

export default function AccountPage() {
  const [account, setAccount] = useState<Account | null>(null), [countries, setCountries] = useState<SignupCountry[]>([]);
  const [target, setTarget] = useState(""), [reason, setReason] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setAccount(await getMyAccount()); setCountries((await listSignupCountries()).filter((c) => c.available)); }, []);
  useEffect(() => { void load().catch((cause) => setError(userFacingError(cause))); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError(""); setNotice("");
    try { await requestMarketChange(target, reason); setNotice("Request sent. A QuizBox administrator will review it; your curriculum stays the same until then."); setReason(""); await load(); }
    catch (cause) { setError(userFacingError(cause)); } finally { setBusy(false); }
  }
  if (!account) return error ? <p className="qb-error" role="alert">{error}</p> : <p>Loading account…</p>;
  const rows: Array<[string, string]> = [
    ["Name", account.full_name], ["Email", account.email], ["Role", account.role], ["Country", account.country ?? "-"],
    ["Primary market", account.primary_market?.name ?? "-"], ["Active market", account.active_market?.name ?? "-"],
    ["Authorized markets", account.authorized_markets.map((m) => m.name + (m.primary ? " (primary)" : "")).join(", ") || "-"],
    ["Language / locale", account.primary_market?.locale ?? "-"], ["School / institution", account.school_name ?? "-"],
    ...(account.student ? [["Grade", account.student.grade_code ?? "-"], ["Education level", account.student.education_level ?? "-"]] as Array<[string, string]> : []),
    ...(account.teacher ? [["Subjects taught", account.teacher.subjects.join(", ") || "-"], ["Grades taught", account.teacher.grade_codes.join(", ") || "-"]] as Array<[string, string]> : []),
  ];
  return (
    <>
      <div className="qb-page-head" style={{ marginBottom: '2rem' }}>
        <div>
          <h1>Account</h1>
          <p>Manage your identity, market access, and teaching profile.</p>
        </div>
      </div>
      
      <div className="qb-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', alignItems: 'start', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="qb-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--qb-border)' }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>Identity</h2>
            <div className="qb-muted qb-small">Personal details and role</div>
          </div>
          <dl className="qb-field" style={{ gap: '0.25rem' }}>
            <dt className="qb-muted qb-small">Name</dt><dd style={{ margin: 0, fontWeight: 500 }}>{account.full_name}</dd>
          </dl>
          <dl className="qb-field" style={{ gap: '0.25rem' }}>
            <dt className="qb-muted qb-small">Email</dt><dd style={{ margin: 0, fontWeight: 500 }}>{account.email}</dd>
          </dl>
          <dl className="qb-field" style={{ gap: '0.25rem' }}>
            <dt className="qb-muted qb-small">Role</dt>
            <dd style={{ margin: 0 }}>
              <span style={{ display: 'inline-block', background: 'var(--qb-surface-muted)', padding: '0.125rem 0.5rem', borderRadius: '1rem', fontSize: '0.75rem', fontWeight: 650, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {account.role}
              </span>
            </dd>
          </dl>
        </div>

        <div className="qb-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--qb-border)' }}>
            <h2 style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>Market</h2>
            <div className="qb-muted qb-small">Regional configuration</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <dl className="qb-field" style={{ gap: '0.25rem' }}>
              <dt className="qb-muted qb-small">Country</dt><dd style={{ margin: 0, fontWeight: 500 }}>{account.country ?? "-"}</dd>
            </dl>
            <dl className="qb-field" style={{ gap: '0.25rem' }}>
              <dt className="qb-muted qb-small">Locale</dt><dd style={{ margin: 0, fontWeight: 500 }}>{account.primary_market?.locale ?? "-"}</dd>
            </dl>
            <dl className="qb-field" style={{ gap: '0.25rem' }}>
              <dt className="qb-muted qb-small">Primary Market</dt><dd style={{ margin: 0, fontWeight: 500 }}>{account.primary_market?.name ?? "-"}</dd>
            </dl>
            <dl className="qb-field" style={{ gap: '0.25rem' }}>
              <dt className="qb-muted qb-small">Active Market</dt><dd style={{ margin: 0, fontWeight: 500 }}>{account.active_market?.name ?? "-"}</dd>
            </dl>
          </div>
          <dl className="qb-field" style={{ gap: '0.25rem' }}>
            <dt className="qb-muted qb-small">Authorized Markets</dt>
            <dd style={{ margin: 0, fontSize: '0.875rem' }}>{account.authorized_markets.map((m) => m.name + (m.primary ? " (primary)" : "")).join(", ") || "-"}</dd>
          </dl>
        </div>

        {(account.student || account.teacher) && (
          <div className="qb-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--qb-border)' }}>
              <h2 style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>{account.teacher ? 'Teaching Profile' : 'Student Profile'}</h2>
              <div className="qb-muted qb-small">Educational alignment</div>
            </div>
            <dl className="qb-field" style={{ gap: '0.25rem' }}>
              <dt className="qb-muted qb-small">Institution</dt><dd style={{ margin: 0, fontWeight: 500 }}>{account.school_name ?? "-"}</dd>
            </dl>
            {account.teacher && (
              <>
                <dl className="qb-field" style={{ gap: '0.25rem' }}>
                  <dt className="qb-muted qb-small">Subjects</dt><dd style={{ margin: 0, fontSize: '0.875rem' }}>{account.teacher.subjects.join(", ") || "-"}</dd>
                </dl>
                <dl className="qb-field" style={{ gap: '0.25rem' }}>
                  <dt className="qb-muted qb-small">Grades Taught</dt><dd style={{ margin: 0, fontSize: '0.875rem' }}>{account.teacher.grade_codes.join(", ") || "-"}</dd>
                </dl>
              </>
            )}
            {account.student && (
              <>
                <dl className="qb-field" style={{ gap: '0.25rem' }}>
                  <dt className="qb-muted qb-small">Education Level</dt><dd style={{ margin: 0, fontSize: '0.875rem' }}>{account.student.education_level ?? "-"}</dd>
                </dl>
                <dl className="qb-field" style={{ gap: '0.25rem' }}>
                  <dt className="qb-muted qb-small">Grade</dt><dd style={{ margin: 0, fontSize: '0.875rem' }}>{account.student.grade_code ?? "-"}</dd>
                </dl>
              </>
            )}
          </div>
        )}
      </div>

      <section className="qb-card" style={{ maxWidth: '40rem' }}>
        <div style={{ paddingBottom: '1rem', borderBottom: '1px solid var(--qb-border)', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>Change country</h2>
          <div className="qb-muted qb-small">Changing country moves you to that country&apos;s curriculum. It takes effect after review.</div>
        </div>
        {account.pending_market_change ? (
          <div style={{ background: 'var(--qb-warning-bg)', padding: '1rem', borderRadius: '0.75rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.25rem' }}>⏳</span>
            <div>
              <div style={{ fontWeight: 650, color: 'var(--qb-warning)', marginBottom: '0.25rem' }}>Pending Review</div>
              <p role="status" style={{ margin: 0, fontSize: '0.875rem', color: 'var(--qb-warning)' }}>A request to move to {account.pending_market_change.to_market} is awaiting review.</p>
            </div>
          </div>
        ) : (
          <form className="qb-form" style={{ gap: '1.25rem', marginTop: 0 }} onSubmit={submit}>
            <div className="qb-field">
              <label htmlFor="account-new-country">New country</label>
              <select id="account-new-country" value={target} onChange={(e) => setTarget(e.target.value)} required>
                <option value="">Select country</option>
                {countries.filter((c) => c.market_id !== account.primary_market?.id).map((c) => (
                  <option key={c.country_code} value={c.market_id ?? ""}>{c.country}</option>
                ))}
              </select>
            </div>
            <div className="qb-field">
              <label htmlFor="account-change-reason">Reason</label>
              <textarea id="account-change-reason" rows={3} placeholder="Please explain why you need to change your market..." value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button className="qb-btn" disabled={busy} style={{ minWidth: '10rem' }}>
                {busy ? "Requesting..." : "Request change"}
              </button>
            </div>
          </form>
        )}
        {error && <p className="qb-error" role="alert" style={{ marginTop: '1rem' }}>{error}</p>}
        {notice && <p role="status" className="qb-success" style={{ marginTop: '1rem' }}>{notice}</p>}
      </section>
    </>
  );
}
