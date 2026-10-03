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
  return <>
    <div className="qb-page-head"><div><h1>Account</h1><p>Your country determines your curriculum and content.</p></div></div>
    <div className="qb-card"><dl className="qb-content-filters">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
    <section className="qb-card"><h2>Change country</h2>
      {account.pending_market_change
        ? <p role="status">A request to move to {account.pending_market_change.to_market} is awaiting review.</p>
        : <form className="qb-content-filters" onSubmit={submit}>
            <label>New country<select value={target} onChange={(e) => setTarget(e.target.value)} required><option value="">Select country</option>
              {countries.filter((c) => c.market_id !== account.primary_market?.id).map((c) => <option key={c.country_code} value={c.market_id ?? ""}>{c.country}</option>)}</select></label>
            <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required/></label>
            <button className="qb-btn" disabled={busy}>Request change</button>
          </form>}
      <p className="qb-muted">Changing country moves you to that country&apos;s curriculum. It takes effect after review.</p>
      {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </section>
  </>;
}
