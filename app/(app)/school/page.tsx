"use client";
import { useMemo } from "react";
import Link from "next/link";
import { BookOpen, CalendarPlus, CheckCircle2, ClipboardList, GraduationCap, TrendingUp, Users } from "lucide-react";
import DashboardHero from "@/components/DashboardHero";
import StatCard from "@/components/StatCard";
import StatusBadge from "@/components/StatusBadge";
import AttentionList from "@/components/AttentionList";
import SchoolScoreCards from "@/components/SchoolScoreCards";
import { useSchool } from "@/components/SchoolProvider";
import { formatDate } from "@/lib/format";
import { classScoreRows, gradeScoreRows, isActiveClass, isTeachingStaff, noGradeLabel, performanceAttention, schoolAttention, summarizeSchool, teacherLoad, weakest } from "@/lib/school/insights";

const pct = (value: number | null | undefined) => value == null ? null : `${Math.round(value)}%`;

// School Home: results first when the performance contract is available, structure and staffing always.
export default function SchoolHomePage() {
  const { overview, history, performance } = useSchool();
  const summary = useMemo(() => summarizeSchool(overview, history), [overview, history]);
  const attention = useMemo(() => [...schoolAttention(overview), ...performanceAttention(performance)].sort((a, b) => ["danger", "warning", "info"].indexOf(a.tone) - ["danger", "warning", "info"].indexOf(b.tone)).slice(0, 6), [overview, performance]);
  const staff = useMemo(() => teacherLoad(overview).filter(isTeachingStaff), [overview]);
  const classes = useMemo(() => overview.classes.filter(isActiveClass).sort((a, b) => b.students - a.students), [overview]);
  const gradeRows = useMemo(() => performance ? gradeScoreRows(performance) : [], [performance]);
  const classRows = useMemo(() => performance ? classScoreRows(overview, performance) : [], [overview, performance]);
  const weakGrade = weakest(gradeRows.map((g) => ({ ...g, assessed_count: g.assessed, average_score: g.average })));
  const weakClass = weakest(classRows.map((c) => ({ ...c, assessed_count: c.assessed, average_score: c.average })));
  const p = performance?.summary;

  return <>
    <h1 className="qb-sr-only">School overview</h1>
    <DashboardHero eyebrow="School workspace" title={overview.institution}
      description={`Workspace for ${overview.institution} · ${summary.activeClasses} active class${summary.activeClasses === 1 ? "" : "es"}${summary.archivedClasses ? ` · ${summary.archivedClasses} archived` : ""}`}
      stats={[summary.uniqueLearners != null ? { label: "Learners", value: summary.uniqueLearners } : { label: "Enrolments", value: summary.enrolments }, { label: "Teachers", value: summary.teachingStaff }, { label: "Classes", value: summary.activeClasses }]}
      primary={{ label: "Manage classes", href: "/school/classes" }} secondary={{ label: "View performance", href: "/school/performance" }} />

    {p ? <div className="qb-grid cols-4">
      <StatCard label="Assessed learners" value={p.assessed_learner_count} hint={`of ${p.learner_count} learner${p.learner_count === 1 ? "" : "s"}`} icon={GraduationCap} />
      <StatCard label="Average performance" value={pct(p.average_score)} hint="Latest result per learner" icon={TrendingUp} />
      <StatCard label="Assignment completion" value={pct(p.assignment_completion_rate)} hint={p.due_target_count ? `${p.due_target_count} tasks past due` : "No assignments past due yet"} icon={CheckCircle2} />
      <StatCard label="Active assignments" value={p.active_assignment_count} hint="Published and open" icon={ClipboardList} />
    </div> : <div className="qb-grid cols-4">
      <StatCard label="Active enrolments" value={summary.enrolments} hint="Includes learners in more than one class" icon={GraduationCap} />
      <StatCard label="Active classes" value={summary.activeClasses} hint={summary.avgClassSize != null ? `Average ${summary.avgClassSize} learners per class` : undefined} icon={BookOpen} />
      <StatCard label="Teaching staff" value={summary.teachingStaff} icon={Users} />
      <StatCard label="Joined in 30 days" value={summary.joinedLast30Days} hint={summary.joinedLast30Days == null ? "Recent history is too long to count reliably" : "New class memberships"} icon={CalendarPlus} />
    </div>}

    <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="sh-attention">
      <h2 id="sh-attention">Needs attention</h2>
      <AttentionList items={attention} empty={{ title: "Nothing urgent", detail: "Low results, missing teachers, empty classes and idle teachers appear here." }} />
    </section>

    <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="sh-performance">
      <div className="qb-page-head"><h2 id="sh-performance">Academic performance</h2><Link className="qb-link" href="/school/performance">Details</Link></div>
      {performance ? <>
        {(weakGrade || weakClass) && <p className="qb-level-legend">{weakGrade && <span>Weakest grade: <strong>{weakGrade.name} ({pct(weakGrade.average)})</strong></span>}{weakClass && <span>Weakest class: <strong>{weakClass.name} ({pct(weakClass.average)})</strong></span>}</p>}
        {gradeRows.length ? <SchoolScoreCards rows={gradeRows} href="/school/performance" action="Details" /> : <div className="qb-empty"><strong>No class rosters yet</strong>Results by grade appear once learners join active classes.</div>}
      </> : <div className="qb-empty"><strong>Results are not available yet</strong>Averages, completion and weak areas appear here once school-level results are enabled for your account.</div>}
    </section>

    <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="sh-classes">
      <div className="qb-page-head"><h2 id="sh-classes">Classes</h2><Link className="qb-link" href="/school/classes">All classes</Link></div>
      {performance && classRows.length ? <SchoolScoreCards rows={classRows.slice(0, 6)} href="/school/classes" action="Manage" />
        : classes.length ? <div className="qb-subject-list">{classes.slice(0, 6).map((c) => <article key={c.id} className="qb-subject">
          <div className="qb-subject-head"><h3>{c.name}</h3>{c.teacher ? <StatusBadge status="active" label={`${c.students} learner${c.students === 1 ? "" : "s"}`} /> : <StatusBadge status="danger" tone="danger" label="No teacher" />}</div>
          <div className="qb-subject-foot"><span className="qb-muted qb-small">{noGradeLabel(c.grade)} · {c.teacher ?? "Unassigned"}</span><Link className="qb-link" href="/school/classes">Manage</Link></div>
        </article>)}</div> : <div className="qb-empty"><strong>No active classes</strong>Classes created by your teachers appear here.</div>}
    </section>

    <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="sh-teachers">
      <div className="qb-page-head"><h2 id="sh-teachers">Teachers</h2><Link className="qb-link" href="/school/teachers">All teachers</Link></div>
      {staff.length ? <ul className="qb-task-list">{staff.slice(0, 6).map((t) => <li key={t.userId}>
        <div className="qb-row-main"><strong>{t.name}</strong><span>{t.classes.length ? t.classes.map((c) => c.name).join(", ") : "No active class"}</span></div>
        <span className="qb-muted qb-small">{t.classes.length} class{t.classes.length === 1 ? "" : "es"} · {t.learners} enrolment{t.learners === 1 ? "" : "s"}</span>
      </li>)}</ul> : <div className="qb-empty"><strong>No teachers yet</strong>Teachers added to your school appear here.</div>}
    </section>

    <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="sh-activity">
      <div className="qb-page-head"><h2 id="sh-activity">Recent membership activity</h2><Link className="qb-link" href="/school/learners">Learners</Link></div>
      {summary.joinedLast30Days != null && <p className="qb-muted qb-small">{summary.joinedLast30Days} new class membership{summary.joinedLast30Days === 1 ? "" : "s"} in the last 30 days</p>}
      {history.length ? <ul className="qb-task-list">{history.slice(0, 6).map((h, i) => <li key={i}>
        <div className="qb-row-main"><strong>{h.student}</strong><span>{h.class} · {h.left_at ? `left ${formatDate(h.left_at)}` : `joined ${formatDate(h.joined_at)}`}</span></div>
        <StatusBadge status={h.status} />
      </li>)}</ul> : <div className="qb-empty"><strong>No activity yet</strong>Joins, leaves and transfers appear here.</div>}
    </section>
  </>;
}
