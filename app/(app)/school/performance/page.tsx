"use client";
import { useMemo } from "react";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import SchoolScoreCards from "@/components/SchoolScoreCards";
import DistributionBars from "@/components/charts/DistributionBars";
import { useSchool } from "@/components/SchoolProvider";
import { classScoreRows, gradeScoreRows, isActiveClass } from "@/lib/school/insights";
import { MIN_PROFICIENT_EVIDENCE } from "@/lib/learning/mastery";
import { GraduationCap, TrendingUp, CheckCircle2, ClipboardList } from "lucide-react";

const pct = (value: number | null | undefined) => value == null ? null : `${Math.round(value)}%`;

// School → Grade → Class (→ Subject, Indicators) from qb_school('performance'). Every average is per assessed learner, with its count shown.
export default function SchoolPerformancePage() {
  const { overview, performance } = useSchool();
  const grades = useMemo(() => performance ? gradeScoreRows(performance) : [], [performance]);
  const classes = useMemo(() => performance ? classScoreRows(overview, performance) : [], [overview, performance]);
  const sizes = useMemo(() => overview.classes.filter(isActiveClass).map((c) => ({ name: c.name, value: c.students })), [overview]);

  if (!performance) return <>
    <div className="qb-page-head"><div><h1>Performance</h1><p>Results by grade, class and subject.</p></div></div>
    <section className="qb-card"><div className="qb-empty"><strong>Results are not available yet</strong>School-level results are not enabled for your account. Enrolment by class is shown below.</div></section>
    <section className="qb-card" style={{ marginTop: 16 }}><h2>Learners per class</h2><DistributionBars rows={sizes} empty="Classes appear here once learners join." /></section>
  </>;

  const p = performance.summary;
  return <>
    <div className="qb-page-head"><div><h1>Performance</h1><p>Latest final result per learner. Groups with fewer than {MIN_PROFICIENT_EVIDENCE} assessed learners are marked as early evidence.</p></div></div>
    <div className="qb-grid cols-4">
      <StatCard label="Assessed learners" value={p.assessed_learner_count} hint={`of ${p.learner_count} learner${p.learner_count === 1 ? "" : "s"}`} icon={GraduationCap} />
      <StatCard label="Average performance" value={pct(p.average_score)} hint="Latest result per learner" icon={TrendingUp} />
      <StatCard label="Assignment completion" value={pct(p.assignment_completion_rate)} hint={p.due_target_count ? `${p.due_target_count} tasks past due` : "No assignments past due yet"} icon={CheckCircle2} />
      <StatCard label="Active assignments" value={p.active_assignment_count} icon={ClipboardList} />
    </div>

    <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="pf-grade">
      <h2 id="pf-grade">By grade</h2>
      {grades.length ? <SchoolScoreCards rows={grades} href="/school/classes" action="Classes" /> : <div className="qb-empty"><strong>No class rosters yet</strong>Grades appear once learners join active classes.</div>}
    </section>

    <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="pf-class">
      <h2 id="pf-class">By class</h2>
      {classes.length ? <SchoolScoreCards rows={classes} href="/school/classes" action="Manage" /> : <div className="qb-empty"><strong>No active classes</strong>Classes appear here once created.</div>}
    </section>

    <div className="qb-grid cols-2" style={{ marginTop: 16 }}>
      <section className="qb-card" aria-labelledby="pf-subject">
        <h2 id="pf-subject">By subject</h2>
        {performance.by_subject.length ? <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Subject</th><th>Assessed learners</th><th>Average</th></tr></thead><tbody>
          {performance.by_subject.map((s) => <tr key={s.subject}><td><strong>{s.subject}</strong></td><td>{s.assessed_count}</td><td>{pct(s.average_score) ?? "—"}{s.assessed_count < MIN_PROFICIENT_EVIDENCE && <div><StatusBadge status="early" tone="neutral" label="Early evidence" /></div>}</td></tr>)}
        </tbody></table></div> : <div className="qb-empty"><strong>No subject results yet</strong>Subjects appear after learners complete graded assignments.</div>}
      </section>

      <section className="qb-card" aria-labelledby="pf-weak">
        <h2 id="pf-weak">Weak areas</h2>
        {performance.weak_indicators.length ? <ul className="qb-task-list">{performance.weak_indicators.map((w) => <li key={w.node_id}>
          <div className="qb-row-main"><strong>{w.label}</strong><span>{w.code} · {w.assessed_count} learner{w.assessed_count === 1 ? "" : "s"} · {w.response_count} responses</span></div>
          <span className="qb-small">{pct(w.average_score)} correct</span>
          {w.low_evidence && <StatusBadge status="early" tone="neutral" label="Early evidence" />}
        </li>)}</ul> : <div className="qb-empty"><strong>No weak areas identified</strong>Indicators appear once they have at least 5 responses.</div>}
      </section>
    </div>
  </>;
}
