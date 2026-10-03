
"use client";

import { useEffect, useState } from "react";
import { workforce } from "@/lib/api/factory";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import StatCard from "@/components/StatCard";
import MasteryRing from "@/components/charts/MasteryRing";
import MasteryBar from "@/components/charts/MasteryBar";

type Money = Record<string, string>;
type Mine = { 
  policy: { mode: string; daily_limit: number | null; target_open_queue: number | null; max_open_queue: number; paused: boolean } | null;
  today: { assigned: number; remaining_capacity: number | null; outstanding: number; completed: number; earned: Money };
  month: { completed: number; approved: number; revisions: number; rejected: number; qa_reversals: number; disputes: number; average_review_seconds: number | null; revision_rate: number; qa_reversal_rate: number; payable: Money; paid: Money; pending_qa: Money; compensation_unresolved: number };
};

const money = (m: Money) => Object.entries(m ?? {}).map(([c, v]) => `${c} ${Number(v).toFixed(2)}`).join(", ") || "0";

export default function SmeWorkload() {
  const [mine, setMine] = useState<Mine | null>(null);
  const [busy, setBusy] = useState(true);
  
  useEffect(() => { 
    workforce<Mine>("my_dashboard")
      .then(setMine)
      .catch(() => setMine(null))
      .finally(() => setBusy(false));
  }, []);
  
  if (busy) return (
    <div className="qb-home" aria-busy="true">
      <div className="qb-home-grid">
        {[1, 2].map((i) => (
          <div key={i} className="qb-card" style={{ minHeight: "150px", background: "var(--qb-surface)", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ width: "40%", height: "20px", background: "var(--qb-surface-muted)", borderRadius: "4px" }} />
            <div style={{ width: "100%", height: "60px", background: "var(--qb-surface-muted)", borderRadius: "8px" }} />
          </div>
        ))}
      </div>
    </div>
  );
  
  if (!mine) return null;

  // Chart Data preparation
  const totalDecisions = mine.month.approved + mine.month.revisions + mine.month.rejected;
  const decisionData = totalDecisions > 0 ? [
    { name: "Approved", value: mine.month.approved, color: "var(--qb-success)" },
    { name: "Revisions", value: mine.month.revisions, color: "var(--qb-warning)" },
    { name: "Rejected", value: mine.month.rejected, color: "var(--qb-danger)" }
  ] : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {mine.policy?.paused && (
        <div className="qb-card" style={{ backgroundColor: "var(--qb-warning-bg)", color: "var(--qb-warning)", border: "1px solid var(--qb-warning)" }}>
          <strong>Reviews Paused:</strong> New assignments are paused for you. Finish your outstanding reviews; your administrator will resume allocation.
        </div>
      )}

      {/* Top Level: Workload & Output */}
      <div className="qb-grid cols-4">
        <StatCard value={mine.today.completed} label="Completed Today" />
        <StatCard value={mine.today.outstanding} label="Pending Reviews" />
        <StatCard value={mine.today.assigned} label="Assigned Today" />
        <StatCard value={mine.month.completed} label="Completed This Month" />
      </div>

      <div className="qb-grid cols-2">
        {/* Quality & Decisions */}
        <section className="qb-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2>Quality & Decisions (This Month)</h2>
          {decisionData.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
              <div style={{ width: "120px", height: "120px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={decisionData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={50}>
                      {decisionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "var(--qb-surface)", borderRadius: "8px", border: "1px solid var(--qb-border)" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                <MasteryBar label={`Approved (${mine.month.approved})`} percentage={Math.round((mine.month.approved / totalDecisions) * 100)} color="var(--qb-success)" />
                <MasteryBar label={`Revisions (${mine.month.revisions})`} percentage={Math.round((mine.month.revisions / totalDecisions) * 100)} color="var(--qb-warning)" />
                <MasteryBar label={`Rejected (${mine.month.rejected})`} percentage={Math.round((mine.month.rejected / totalDecisions) * 100)} color="var(--qb-danger)" />
              </div>
            </div>
          ) : (
            <div className="qb-muted">Not enough data to calculate decision rates.</div>
          )}
          
          <div style={{ marginTop: "16px", borderTop: "1px solid var(--qb-border)", paddingTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div>
              <div style={{ fontSize: "0.875rem", color: "var(--qb-text-secondary)" }}>QA Reversal Rate</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700, color: mine.month.qa_reversals > 0 ? "var(--qb-danger)" : "var(--qb-text-primary)" }}>
                {mine.month.qa_reversal_rate}% <span style={{ fontSize: "0.875rem", fontWeight: 400 }}>({mine.month.qa_reversals} reversals)</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.875rem", color: "var(--qb-text-secondary)" }}>Avg Review Time</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                {mine.month.average_review_seconds == null ? "-" : `${Math.round(mine.month.average_review_seconds / 60)} min`}
              </div>
            </div>
          </div>
        </section>

        {/* Earnings & Compensation */}
        <section className="qb-card" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <h2>Earnings & Compensation</h2>
          <div className="qb-grid cols-2" style={{ gap: "12px" }}>
            <div style={{ padding: "16px", backgroundColor: "var(--qb-success-bg)", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--qb-success)", fontWeight: 600 }}>Earned Today</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--qb-success)", marginTop: "4px" }}>{money(mine.today.earned)}</div>
            </div>
            <div style={{ padding: "16px", backgroundColor: "var(--qb-surface-muted)", borderRadius: "8px" }}>
              <div style={{ fontSize: "0.875rem", color: "var(--qb-text-secondary)", fontWeight: 600 }}>Paid (Month)</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "4px" }}>{money(mine.month.paid)}</div>
            </div>
          </div>
          
          <dl className="qb-stat-list" style={{ marginTop: "8px" }}>
            <div><dt>Payable (Cleared)</dt><dd>{money(mine.month.payable)}</dd></div>
            <div><dt>Pending QA</dt><dd>{money(mine.month.pending_qa)}</dd></div>
            <div>
              <dt>Unresolved Compensation</dt>
              <dd style={{ color: mine.month.compensation_unresolved > 0 ? "var(--qb-danger)" : "inherit" }}>
                {mine.month.compensation_unresolved}
              </dd>
            </div>
          </dl>
          
          <p className="qb-small qb-muted" style={{ marginTop: "auto" }}>Quality matters more than speed: QA reversals and revision rates are heavily factored. Assignment does not create earnings; completed eligible reviews do.</p>
        </section>
      </div>
    </div>
  );
}
