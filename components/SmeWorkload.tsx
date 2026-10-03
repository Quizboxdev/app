"use client";
import { useEffect, useState } from "react";
import { workforce } from "@/lib/api/factory";

type Money = Record<string, string>;
type Mine = { policy: { mode: string; daily_limit: number | null; target_open_queue: number | null; max_open_queue: number; paused: boolean } | null;
  today: { assigned: number; remaining_capacity: number | null; outstanding: number; completed: number; earned: Money };
  month: { completed: number; approved: number; revisions: number; rejected: number; qa_reversals: number; disputes: number; average_review_seconds: number | null; revision_rate: number; qa_reversal_rate: number; payable: Money; paid: Money; pending_qa: Money; compensation_unresolved: number } };
const money = (m: Money) => Object.entries(m ?? {}).map(([c, v]) => `${c} ${Number(v).toFixed(2)}`).join(", ") || "0";

// The reviewer's own workload and quality view. Accuracy indicators sit beside volume so speed alone is never the goal.
export default function SmeWorkload() {
  const [mine, setMine] = useState<Mine | null>(null);
  useEffect(() => { workforce<Mine>("my_dashboard").then(setMine).catch(() => setMine(null)); }, []);
  if (!mine) return null;
  const stats = (items: Array<[string, string | number]>) => <dl className="qb-stat-list">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
  return <section className="qb-card" aria-labelledby="sme-workload-title"><h2 id="sme-workload-title">My review workload</h2>
    {mine.policy?.paused && <p className="qb-muted">New assignments are paused for you. Finish your outstanding reviews; your administrator will resume allocation.</p>}
    <h3>Today</h3>{stats([["Assigned today", mine.today.assigned], ["Remaining today", mine.today.remaining_capacity ?? "-"], ["Queue outstanding", mine.today.outstanding], ["Completed today", mine.today.completed], ["Earned today", money(mine.today.earned)]])}
    <h3>This month</h3>{stats([["Reviews completed", mine.month.completed], ["Approved", mine.month.approved], ["Revisions requested", `${mine.month.revisions} (${mine.month.revision_rate}%)`], ["Rejected", mine.month.rejected],
      ["QA reversals", `${mine.month.qa_reversals} (${mine.month.qa_reversal_rate}%)`], ["Disputes", mine.month.disputes], ["Average review time", mine.month.average_review_seconds == null ? "-" : `${Math.round(mine.month.average_review_seconds / 60)} min`],
      ["Pending QA", money(mine.month.pending_qa)], ["Payable", money(mine.month.payable)], ["Paid", money(mine.month.paid)], ["Compensation unresolved", mine.month.compensation_unresolved]])}
    <p className="qb-small qb-muted">Quality matters more than speed: QA reversals and revision rates are reviewed alongside volume. Assignment does not create earnings; completed eligible reviews do.</p>
  </section>;
}
