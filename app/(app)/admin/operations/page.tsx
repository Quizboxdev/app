"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminOps, platformInsights } from "@/lib/api/platform";

type Hit = { kind: "user" | "sponsor"; id: string; name: string; email?: string; role?: string; status: string; primary_market?: string; markets?: string; verification?: string };
type AuditRow = { at: string; action: string; actor: string; entity: string; entity_id: string | null; status: string; details: Record<string, unknown> };

// Super Admin operations. Every call is authorization-checked and written to the audit trail server-side.
export default function AdminOperationsPage() {
  const [query, setQuery] = useState(""), [hits, setHits] = useState<Hit[]>([]), [audit, setAudit] = useState<AuditRow[]>([]), [failures, setFailures] = useState<Array<Record<string, string>>>([]);
  const [insights, setInsights] = useState<Record<string, any> | null>(null), [actionFilter, setActionFilter] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const loadAudit = useCallback(async () => { try { setAudit(await adminOps<AuditRow[]>("audit_trail", { action: actionFilter, limit: 50 })); setFailures(await adminOps("failures")); } catch (cause) { setError((cause as Error).message); } }, [actionFilter]);
  useEffect(() => { void loadAudit(); platformInsights().then(setInsights).catch(() => setInsights(null)); }, [loadAudit]);
  async function lookup(event?: FormEvent) { event?.preventDefault(); setBusy(true); setError(""); try { setHits(await adminOps<Hit[]>("lookup", { query })); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }
  async function setStatus(hit: Hit, status: string) {
    if (!window.confirm(`Set ${hit.name} to ${status}?`)) return;
    setBusy(true); setError(""); setNotice("");
    try { await adminOps(hit.kind === "user" ? "set_user_status" : "set_sponsor_status", { id: hit.id, status }); setNotice(`${hit.name}: ${status}.`); await lookup(); await loadAudit(); }
    catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }
  return <>
    <div className="qb-page-head"><div><h1>Operations</h1><p>Account lookup, suspension, audit trail and failure monitoring.</p></div></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="qb-card"><h2>Other controls</h2><div className="qb-content-filters">
      <Link href="/admin/markets">Market memberships and sources</Link><Link href="/admin/reviewers">SME permissions</Link><Link href="/admin/competitions/assignments">Review assignment</Link>
      <Link href="/admin/compensation">Compensation policy</Link><Link href="/admin/competitions/oversight">Competition oversight</Link><Link href="/admin/quality">Content quality</Link><Link href="/admin/market-setup">Market setup</Link></div></section>
    <section className="qb-card"><h2>Account lookup</h2>
      <form className="qb-content-filters" onSubmit={lookup}><label>Name, email or organization<input value={query} onChange={(e) => setQuery(e.target.value)} minLength={2} required/></label><button className="qb-btn" disabled={busy}>Search</button></form>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Type</th><th>Name</th><th>Role / verification</th><th>Markets</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{hits.map((h) => { const active = ["active", "ACTIVE"].includes(h.status); return <tr key={`${h.kind}-${h.id}`}><td>{h.kind}</td><td>{h.name}{h.email && <div className="qb-small qb-muted">{h.email}</div>}</td><td>{h.role ?? h.verification ?? "-"}</td><td>{h.markets ?? h.primary_market ?? "-"}</td><td>{h.status}</td>
          <td><button className="qb-btn secondary" disabled={busy} onClick={() => void setStatus(h, h.kind === "user" ? (active ? "inactive" : "active") : (active ? "SUSPENDED" : "ACTIVE"))}>{active ? "Suspend" : "Activate"}</button></td></tr>; })}</tbody></table>
        {!hits.length && <p className="qb-muted">No results yet.</p>}</div>
    </section>
    {insights && <section className="qb-card"><h2>Adoption and activity</h2>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Market</th><th>Users</th><th>Active (30 days)</th></tr></thead><tbody>{(insights.adoption ?? []).map((a: any) => <tr key={a.market}><td>{a.market}{a.test ? " (test)" : ""}</td><td>{a.users}</td><td>{a.active_30d}</td></tr>)}</tbody></table></div>
      <dl className="qb-stat-list"><div><dt>Active learners (7 days)</dt><dd>{insights.active_users_7d}</dd></div><div><dt>Source approval backlog</dt><dd>{insights.source_backlog}</dd></div>
        <div><dt>Questions added (8 weeks)</dt><dd>{(insights.content_growth ?? []).reduce((n: number, w: any) => n + Number(w.questions), 0)}</dd></div><div><dt>Reviews (8 weeks)</dt><dd>{(insights.review_throughput ?? []).reduce((n: number, w: any) => n + Number(w.reviews), 0)}</dd></div></dl>
    </section>}
    <section className="qb-card"><div className="qb-page-head"><h2>Audit trail</h2><label>Action contains<input value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}/></label></div>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Entity</th><th>Status</th></tr></thead>
        <tbody>{audit.map((a, i) => <tr key={i}><td>{new Date(a.at).toLocaleString()}</td><td>{a.action}</td><td>{a.actor}</td><td>{a.entity ?? "-"}</td><td>{a.status}</td></tr>)}</tbody></table></div></section>
    <section className="qb-card"><h2>Failures (7 days)</h2>{failures.length ? <ul className="qb-plain-list">{failures.slice(0, 30).map((f, i) => <li key={i}>{new Date(f.at).toLocaleString()} · {f.operation} · {f.code ?? "-"} <span className="qb-muted">({f.source})</span></li>)}</ul> : <p className="qb-muted">No failures recorded.</p>}</section>
  </>;
}
