"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LoadError from "@/components/LoadError";
import { getOperationsHealth, listSupportTickets } from "@/lib/api/admin";
import { enquiryCounts, getClientErrors, type ClientErrorSummary } from "@/lib/api/intake";
import { Kpi, Panel, RankedBars, SERIES, SplitBar, num } from "@/components/admin/DataViz";

// Support and operations: service health, ticket pressure and operational exceptions. Browser crashes and new enquiries are optional panels: they load on their own and never block the page.
export default function AdminSupportPage() {
  const [health, setHealth] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [crashes, setCrashes] = useState<ClientErrorSummary | null>(null);
  const [newEnquiries, setNewEnquiries] = useState<number | null>(null);
  const [status, setStatus] = useState(""), [priority, setPriority] = useState("");

  useEffect(() => {
    Promise.all([getOperationsHealth(), listSupportTickets()]).then(([h, t]) => { setHealth(h); setTickets(t); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { getClientErrors(24).then(setCrashes).catch(() => setCrashes(null)); enquiryCounts().then((c) => setNewEnquiries(c.new)).catch(() => setNewEnquiries(null)); }, []);

  const stateOf = (t: any) => String(t.status ?? (t.resolved_at ? "RESOLVED" : "OPEN")).toUpperCase();
  const prioOf = (t: any) => String(t.priority ?? "NORMAL").toUpperCase();
  const shown = useMemo(() => tickets.filter((t) => (!status || stateOf(t) === status) && (!priority || prioOf(t) === priority)), [tickets, status, priority]);
  const statuses = useMemo(() => [...new Set(tickets.map(stateOf))].sort(), [tickets]);
  const split = useMemo(() => { const c = new Map<string, number>(); for (const t of tickets) c.set(stateOf(t), (c.get(stateOf(t)) ?? 0) + 1); return c; }, [tickets]);

  if (error) return <LoadError message={error} onRetry={() => window.location.reload()} />;
  if (!health) return <div className="dx-page"><p className="dx-muted">Loading support operations…</p></div>;

  const crashRows = (crashes?.groups ?? []).slice().sort((a, b) => b.count - a.count).map((g) => ({ key: `${g.route}${g.kind}${g.digest}`, label: g.route, segments: [{ value: g.count, color: SERIES.b, name: g.kind }] }));
  const spike = (crashes?.last_hour ?? 0) >= 20;

  return (
    <div className="dx-page">
      <div className="dx-head"><div><h1>Support and operations</h1><p>Service health, ticket pressure and operational exceptions.</p></div></div>

      <div className="dx-kpis">
        <Kpi label="Open tickets" value={health.support?.open_tickets ?? 0} tone={(health.support?.open_tickets ?? 0) > 0 ? "warn" : "default"} />
        <Kpi label="SLA at risk" value={health.support?.sla_at_risk ?? 0} tone={(health.support?.sla_at_risk ?? 0) > 0 ? "warn" : "default"} />
        <Kpi label="Failed notifications" value={health.notifications?.failed ?? 0} tone={(health.notifications?.failed ?? 0) > 0 ? "warn" : "default"} />
        <Kpi label="Errors, 24 hours" value={health.system_events?.errors_24h ?? 0} tone={(health.system_events?.errors_24h ?? 0) > 0 ? "warn" : "default"} />
        <Link href="/admin/inbox" className="dx-kpi-link"><Kpi label="New enquiries" value={newEnquiries ?? "—"} tone={newEnquiries ? "warn" : "default"} hint={newEnquiries ? "Open the inbox" : undefined} /></Link>
        <Kpi label="Browser crashes, 24 hours" value={crashes?.total ?? "—"} tone={spike ? "warn" : "default"} hint={crashes ? `${num(crashes.last_hour)} in the last hour` : undefined} />
      </div>

      {spike && <div className="dx-alert error" role="alert">{crashes?.last_hour} browser crashes in the last hour. Open the runbook (docs/ops/INCIDENT_RUNBOOK.md), section 2, Crash spike.</div>}

      <div className="dx-grid" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <Panel title="Browser crashes by page" subtitle="Last 24 hours, most crashes first">
          {crashes ? (crashRows.length ? <RankedBars rows={crashRows} unit="crashes" limit={8} /> : <p className="dx-muted dx-note">No crashes in the last 24 hours.</p>) : <p className="dx-muted dx-note">Not available.</p>}
        </Panel>
        <Panel title="Tickets by status" subtitle="Older ticket records">
          {tickets.length ? <SplitBar parts={[...split.entries()].map(([name, value], i) => ({ name: name.charAt(0) + name.slice(1).toLowerCase(), value, color: [SERIES.b, SERIES.a, SERIES.none, SERIES.c][i % 4] }))} /> : <p className="dx-muted dx-note">No tickets.</p>}
        </Panel>
      </div>

      {crashes && crashes.groups.length > 0 && (
        <Panel title="Browser crashes (grouped)">
          <div className="dx-table-wrap" style={{ maxHeight: 320 }}>
            <table className="dx-table">
              <thead><tr><th>Page</th><th>Kind</th><th>Message</th><th className="num">Times</th><th>Last seen</th></tr></thead>
              <tbody>{crashes.groups.map((g) => <tr key={`${g.route}${g.kind}${g.digest}`}><td className="name">{g.route}</td><td>{g.kind}</td><td style={{ whiteSpace: "normal", minWidth: 240 }}>{g.message}</td><td className="num">{g.count}</td><td className="dx-muted">{new Date(g.last_seen).toLocaleString()}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="dx-toolbar">
        <strong style={{ fontSize: 13 }}>Support tickets</strong>
        <select className="dx-select" aria-label="Ticket status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Any status</option>{statuses.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select>
        <select className="dx-select" aria-label="Ticket priority" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Any priority</option><option value="HIGH">High</option><option value="NORMAL">Normal</option><option value="LOW">Low</option></select>
        {(status || priority) && <button className="dx-link" type="button" onClick={() => { setStatus(""); setPriority(""); }}>Clear filters</button>}
        <span className="dx-spacer" /><Link className="dx-btn sm" href="/admin/tickets">Open the support queue</Link>
      </div>
      <div className="dx-table-wrap">
        <table className="dx-table">
          <thead><tr><th>Category</th><th>Priority</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {!shown.length ? <tr><td colSpan={4} className="dx-muted">No tickets match.</td></tr> : shown.map((row) => (
              <tr key={row.id}><td className="name">{row.category ?? row.subject ?? "Support"}</td><td><span className={`dx-pill${prioOf(row) === "HIGH" ? " warn" : ""}`}>{String(row.priority ?? "NORMAL")}</span></td><td>{stateOf(row)}</td><td className="dx-muted">{row.created_at ? new Date(row.created_at).toLocaleString() : ""}</td></tr>))}
          </tbody>
        </table>
      </div>
      <div className="dx-pager"><span>{num(shown.length)} of {num(tickets.length)} tickets</span></div>
    </div>
  );
}
