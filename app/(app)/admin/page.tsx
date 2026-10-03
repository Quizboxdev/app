
"use client";

import { useEffect, useState } from "react";
import {
  getPlatformOverview,
  getContentHealth,
  getCompetitionMetrics,
  getOperationsHealth,
} from "@/lib/api/admin";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export default function AdminHomePage() {
  const [overview, setOverview] = useState<any>(null);
  const [content, setContent] = useState<any>(null);
  const [competition, setCompetition] = useState<any>(null);
  const [ops, setOps] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      getPlatformOverview().catch(() => null),
      getContentHealth().catch(() => null),
      getCompetitionMetrics().catch(() => null),
      getOperationsHealth().catch(() => null),
    ])
      .then(([o, c, comp, op]) => {
        setOverview(o);
        setContent(c);
        setCompetition(comp);
        setOps(op);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (busy) return (
    <div className="qb-home" aria-busy="true">
      <div className="qb-page-head">
        <div style={{ width: "120px", height: "24px", background: "var(--qb-surface-muted)", borderRadius: "4px" }} />
      </div>
      <div className="qb-home-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="qb-card" style={{ minHeight: "150px", background: "var(--qb-surface)", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ width: "40%", height: "20px", background: "var(--qb-surface-muted)", borderRadius: "4px" }} />
            <div style={{ width: "100%", height: "60px", background: "var(--qb-surface-muted)", borderRadius: "8px" }} />
          </div>
        ))}
      </div>
    </div>
  );

  // Normalize data for charts
  const usersByRole = overview?.users?.by_role ? Object.entries(overview.users.by_role).map(([name, value]) => ({ name, value })) : [];
  const usersByMarket = overview?.users?.by_market ? Object.entries(overview.users.by_market).map(([name, value]) => ({ name, value })) : [];
  const colors = ["#0b5fff", "#167a45", "#b42318", "#8a5d00", "#6b778c", "#8b5cf6"];

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Global Platform Operations</h1>
          <p>Real-time analytics across markets, users, and content pipelines.</p>
        </div>
      </div>

      <div className="qb-grid cols-4" style={{ marginBottom: "24px" }}>
        <div className="qb-card">
          <div className="qb-stat-label">Total Users</div>
          <div className="qb-stat-value">{overview?.users?.total ?? "Not enough data"}</div>
        </div>
        <div className="qb-card">
          <div className="qb-stat-label">Active Markets</div>
          <div className="qb-stat-value">{overview?.markets?.active ?? "Not enough data"}</div>
        </div>
        <div className="qb-card">
          <div className="qb-stat-label">Approved Questions</div>
          <div className="qb-stat-value">{content?.approved_questions ?? overview?.content?.questions ?? "Not enough data"}</div>
        </div>
        <div className="qb-card">
          <div className="qb-stat-label">Total Competitions</div>
          <div className="qb-stat-value">{competition?.total_competitions ?? overview?.competitions?.competitions ?? "Not enough data"}</div>
        </div>
      </div>

      <div className="qb-grid cols-2">
        {/* Users by Role */}
        <section className="qb-card">
          <h2>Users by Role</h2>
          {usersByRole.length > 0 ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={usersByRole} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                    {usersByRole.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ backgroundColor: "var(--qb-surface)", borderRadius: "8px", border: "1px solid var(--qb-border)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ height: 250, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--qb-text-secondary)" }}>
              Not enough data (users_by_role)
            </div>
          )}
        </section>

        {/* Users by Market */}
        <section className="qb-card">
          <h2>Users by Market</h2>
          {usersByMarket.length > 0 ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usersByMarket} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--qb-border)" />
                  <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "var(--qb-text-secondary)" }} />
                  <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "var(--qb-text-secondary)" }} />
                  <Tooltip cursor={{ fill: "var(--qb-surface-hover)" }} contentStyle={{ backgroundColor: "var(--qb-surface)", borderRadius: "8px" }} />
                  <Bar dataKey="value" fill="var(--qb-primary)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ height: 250, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--qb-text-secondary)" }}>
              Not enough data (users_by_market)
            </div>
          )}
        </section>
        
        {/* Content & Operations Pipeline */}
        <section className="qb-card">
          <h2>Factory & Content Throughput</h2>
          <dl className="qb-stat-list">
            <div><dt>Generation Throughput</dt><dd>{content?.generation_throughput ?? "Not enough data"}</dd></div>
            <div><dt>SME Review Throughput</dt><dd>{content?.sme_review_throughput ?? "Not enough data"}</dd></div>
            <div><dt>Source Coverage</dt><dd>{content?.source_coverage ? `${content.source_coverage}%` : "Not enough data"}</dd></div>
          </dl>
        </section>

        {/* Operations Health */}
        <section className="qb-card">
          <h2>Operations Health</h2>
          <dl className="qb-stat-list">
            <div><dt>Configuring Markets</dt><dd>{overview?.markets?.configuring ?? "Not enough data"}</dd></div>
            <div>
              <dt>Unresolved Source Issues</dt>
              <dd style={{ color: (ops?.unresolved_source_issues ?? 0) > 0 ? "var(--qb-danger)" : "var(--qb-success)" }}>
                {ops?.unresolved_source_issues ?? "Not enough data"}
              </dd>
            </div>
            <div>
              <dt>Unresolved Compensation</dt>
              <dd style={{ color: (ops?.unresolved_compensation ?? 0) > 0 ? "var(--qb-danger)" : "var(--qb-success)" }}>
                {ops?.unresolved_compensation ?? "Not enough data"}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}
