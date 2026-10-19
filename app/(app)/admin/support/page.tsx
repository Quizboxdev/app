"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { getOperationsHealth, listSupportTickets } from "@/lib/api/admin";
import { enquiryCounts, getClientErrors, type ClientErrorSummary } from "@/lib/api/intake";
import Link from "next/link";

export default function AdminSupportPage() {
  const [health, setHealth] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [crashes, setCrashes] = useState<ClientErrorSummary | null>(null);
  const [newEnquiries, setNewEnquiries] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([getOperationsHealth(), listSupportTickets()])
      .then(([h, t]) => {
        setHealth(h);
        setTickets(t);
      })
      .catch((e) => setError(e.message));
  }, []);
  // Browser crashes and new enquiries are optional panels: they load on their own and never block the page.
  useEffect(() => { getClientErrors(24).then(setCrashes).catch(() => setCrashes(null)); enquiryCounts().then((c) => setNewEnquiries(c.new)).catch(() => setNewEnquiries(null)); }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!health) return <div>Loading support operations…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Support & Operations</h1>
          <p>Service health, ticket pressure and operational exceptions.</p>
        </div>
      </div>

      <div className="qb-grid cols-4">
        <StatCard value={health.support?.open_tickets ?? 0} label="Open tickets" />
        <StatCard value={health.support?.sla_at_risk ?? 0} label="SLA at risk" />
        <StatCard value={health.notifications?.failed ?? 0} label="Failed notifications" />
        <StatCard value={health.system_events?.errors_24h ?? 0} label="Errors in 24h" />
      </div>

      <div className="qb-grid cols-3" style={{ marginTop: 16 }}>
        <StatCard value={newEnquiries ?? "-"} label="New enquiries" />
        <StatCard value={crashes?.last_hour ?? "-"} label="Browser crashes, last hour" />
        <StatCard value={crashes?.total ?? "-"} label="Browser crashes, 24 hours" />
      </div>
      {newEnquiries ? <p style={{ marginTop: 8 }}><Link href="/admin/inbox">Open the enquiry inbox</Link></p> : null}
      {(crashes?.last_hour ?? 0) >= 20 && <div className="qb-card qb-error" role="alert" style={{ marginTop: 12 }}>{crashes?.last_hour} browser crashes in the last hour. Open the runbook (docs/ops/INCIDENT_RUNBOOK.md), section 2, Crash spike.</div>}
      {crashes && crashes.groups.length > 0 && <div className="qb-card qb-table-wrap" style={{ marginTop: 16 }}>
        <h2>Browser crashes (grouped)</h2>
        <table className="qb-table"><thead><tr><th>Page</th><th>Kind</th><th>Message</th><th>Times</th><th>Last seen</th></tr></thead><tbody>
          {crashes.groups.map((g) => <tr key={`${g.route}${g.kind}${g.digest}`}><td>{g.route}</td><td>{g.kind}</td><td>{g.message}</td><td>{g.count}</td><td>{new Date(g.last_seen).toLocaleString()}</td></tr>)}
        </tbody></table>
      </div>}

      <div style={{ height: 18 }} />

      <div className="qb-card qb-table-wrap">
        <h2>Support tickets</h2>
        <table className="qb-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((row) => (
              <tr key={row.id}>
                <td>{row.category ?? row.subject ?? "Support"}</td>
                <td>{row.priority ?? "NORMAL"}</td>
                <td>{row.status ?? (row.resolved_at ? "RESOLVED" : "OPEN")}</td>
                <td>{row.created_at ? new Date(row.created_at).toLocaleString() : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
