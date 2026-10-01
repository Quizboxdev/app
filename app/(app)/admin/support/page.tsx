"use client";

import { useEffect, useState } from "react";
import StatCard from "@/components/StatCard";
import { getOperationsHealth, listSupportTickets } from "@/lib/api/admin";

export default function AdminSupportPage() {
  const [health, setHealth] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getOperationsHealth(), listSupportTickets()])
      .then(([h, t]) => {
        setHealth(h);
        setTickets(t);
      })
      .catch((e) => setError(e.message));
  }, []);

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
