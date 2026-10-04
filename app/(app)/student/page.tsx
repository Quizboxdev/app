"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { bootstrapUser } from "@/lib/auth";
import { getStudentDashboard, getStudentCompetitionAnalytics, getStudentAchievements } from "@/lib/api/student";
import { startAttempt } from "@/lib/api/assessment";
import MasteryRing from "@/components/charts/MasteryRing";
import TrendChart from "@/components/charts/TrendChart";
import { Calendar, CheckCircle, Trophy, FileText, ArrowRight } from 'lucide-react';
import StatCard from "@/components/StatCard";
import { formatDate, isUuid } from "@/lib/format";
import AchievementBadge from "@/components/achievements/AchievementBadge";

function sanitizeLabel(label: string): string {
  if (!label) return "";
  const clean = label.replace(/DEV_FACTORY_PILOT|snapshot|dev_|test_|fixture_/gi, '').trim();
  if (clean.length === 0) return "General Assessment";
  const subjectMap: Record<string, string> = { 'MATH': 'Mathematics', 'SCI': 'Science', 'ENG': 'English', 'COMP': 'Computing' };
  return subjectMap[clean.toUpperCase()] || clean;
}

function subjectLabel(code: unknown): string {
  return !code || isUuid(code) ? "General" : sanitizeLabel(String(code));
}

export default function StudentDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [compData, setCompData] = useState<any>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [studentName, setStudentName] = useState("");

  useEffect(() => {
    bootstrapUser().then(async (ctx) => {
      const studentId = String((ctx.studentProfile as any)?.id ?? "");
      if (!studentId) throw new Error("Student profile not found.");
      setStudentName(String((ctx.profile as any)?.full_name ?? "Student").split(" ")[0]);
      const [dash, comp, ach] = await Promise.all([
        getStudentDashboard(studentId),
        getStudentCompetitionAnalytics(studentId).catch(() => null),
        getStudentAchievements(studentId).catch(() => [])
      ]);
      setData(dash); setCompData(comp); setAchievements(ach);
    }).catch((e) => setError(e.message)).finally(() => setBusy(false));
  }, []);

  if (error) return <div className="qb-card qb-error" role="alert">{error}</div>;
  if (busy) return <div className="qb-grid cols-4" aria-busy="true">{[1, 2, 3, 4].map((i) => <div key={i} className="qb-card qb-skeleton" style={{ minHeight: 96 }} />)}</div>;

  const subjects: Record<string, { total: number; count: number }> = {};
  (data.results ?? []).forEach((row: any) => {
    const code = isUuid(row.subject_code) ? "Unlabelled subject" : sanitizeLabel(row.subject_code ?? "General");
    if (!subjects[code]) subjects[code] = { total: 0, count: 0 };
    subjects[code].total += Number(row.percentage ?? 0);
    subjects[code].count += 1;
  });
  const subjectMastery = Object.entries(subjects).map(([name, val]) => ({
    name, percentage: Math.round(val.total / val.count)
  }));

  const trendData = [...(data.results ?? [])].reverse().map((r: any, idx) => ({
    name: r.submitted_at ? new Date(r.submitted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `Attempt ${idx + 1}`,
    score: Math.round(Number(r.percentage ?? 0))
  }));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const assignments: any[] = data.assignments ?? [];
  const next = assignments[0];
  const rank = compData?.current_rank;
  const start = async (row: any) => {
    const attempt: any = await startAttempt({ assessmentId: row.assignments.assessment_id, assignmentId: row.assignment_id, classId: row.class_id });
    router.push(`/student/attempt/${attempt.attempt_id}`);
  };

  return (
    <>
      <section className="qb-welcome" aria-labelledby="welcome-heading">
        <div>
          <p className="qb-welcome-eyebrow">{greeting}{studentName ? `, ${studentName}` : ""}</p>
          <h1 id="welcome-heading">Your learning dashboard</h1>
          <p>{assignments.length ? `You have ${assignments.length} assignment${assignments.length === 1 ? "" : "s"} waiting. Keep the momentum going.` : "You are all caught up. Practise or join a competition to keep growing."}</p>
        </div>
        <div className="qb-welcome-next">
          {next ? <>
            <span className="qb-pill"><Calendar size={13} aria-hidden="true" />Next assignment</span>
            <strong>{sanitizeLabel(next.assignments?.title ?? "Assignment")}</strong>
            <span className="qb-muted qb-small">{subjectLabel(next.assignments?.subject_code)}{next.assignments?.due_at ? ` · Due ${formatDate(next.assignments.due_at)}` : " · No due date"}</span>
            <button className="qb-btn" onClick={() => void start(next)}>Start now <ArrowRight size={16} aria-hidden="true" /></button>
          </> : <>
            <span className="qb-pill success"><CheckCircle size={13} aria-hidden="true" />All caught up</span>
            <strong>Try a competition</strong>
            <span className="qb-muted qb-small">Challenge other learners on what you have practised.</span>
            <Link className="qb-btn" href="/competition">Explore competitions <ArrowRight size={16} aria-hidden="true" /></Link>
          </>}
        </div>
      </section>

      <div className="qb-grid cols-4">
        <StatCard label="Assessments completed" value={data.stats.completed} />
        <StatCard label="Average score" value={data.stats.completed > 0 ? `${Math.round(data.stats.average)}%` : null} />
        <StatCard label="Assignments to do" value={assignments.length} />
        <StatCard label="Competition rank" value={rank ? `#${rank}` : null} hint={rank ? undefined : "Join a ranked competition"} />
      </div>

      <div className="qb-grid cols-3">
        <section className="qb-card qb-dash-card">
          <div className="qb-page-head"><h2>Upcoming assignments</h2><Link className="qb-link" href="/student/assessments">View all</Link></div>
          {assignments.length ? (
            <ul className="qb-task-list">
              {assignments.slice(0, 4).map((row: any) => (
                <li key={row.id}>
                  <span className="qb-task-icon" aria-hidden="true"><FileText size={16} /></span>
                  <div className="qb-row-main">
                    <strong>{sanitizeLabel(row.assignments?.title ?? "Assignment")}</strong>
                    <span>{subjectLabel(row.assignments?.subject_code)}{row.assignments?.due_at ? ` · Due ${formatDate(row.assignments.due_at)}` : " · No due date"}</span>
                  </div>
                  <button type="button" aria-label={`Start ${sanitizeLabel(row.assignments?.title ?? "assignment")}`} onClick={() => void start(row)}><ArrowRight size={16} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          ) : <div className="qb-empty"><strong>No assignments yet</strong>Work from your teachers appears here.</div>}
        </section>

        <section className="qb-card qb-dash-card">
          <div className="qb-page-head"><h2>Subject performance</h2><Link className="qb-link" href="/student/results">View progress</Link></div>
          {subjectMastery.length > 0 ? (
            <ul className="qb-dist">
              {subjectMastery.slice(0, 5).map((sub) => (
                <li key={sub.name}>
                  <span className="qb-dist-name">{sub.name}</span>
                  <span className="qb-dist-track" aria-hidden="true"><span className="qb-dist-fill" style={{ width: `${Math.max(4, sub.percentage)}%` }} /></span>
                  <span className="qb-dist-value">{sub.percentage}%</span>
                </li>
              ))}
            </ul>
          ) : <div className="qb-empty"><strong>No results yet</strong>Complete an assessment to see subject mastery.</div>}
        </section>

        <section className="qb-card qb-dash-card">
          <div className="qb-page-head"><h2>Overall mastery</h2></div>
          {data.stats.completed > 0 ? (
            <div className="qb-center"><MasteryRing percentage={Math.round(data.stats.average)} label="Average score" size={132} color="var(--color-primary)" /></div>
          ) : <div className="qb-empty"><strong>No mastery yet</strong>Your average appears after your first assessment.</div>}
        </section>

        <section className="qb-card qb-dash-card">
          <div className="qb-page-head"><h2>Performance trend</h2></div>
          {trendData.length > 1 ? <TrendChart data={trendData} height={180} yAxisLabel="Score %" />
            : <div className="qb-empty"><strong>Not enough attempts</strong>Complete at least two assessments to see your trend.</div>}
        </section>

        <section className="qb-card qb-dash-card">
          <div className="qb-page-head"><h2>Competition leaderboard</h2><Link className="qb-link" href="/competition">Competitions</Link></div>
          {compData?.leaderboard && compData.leaderboard.length > 0 ? (
            <ol className="qb-leaderboard">
              {compData.leaderboard.slice(0, 5).map((player: any, index: number) => (
                <li key={player.id || index} className={index < 3 ? `top-${index + 1}` : undefined}>
                  <span className="qb-leader-rank">{index + 1}</span>
                  <span className="qb-leader-avatar" aria-hidden="true">{player.name?.[0] || "?"}</span>
                  <span className="qb-leader-name">{sanitizeLabel(player.name || "Unknown")}</span>
                  <strong>{player.score || 0}</strong>
                </li>
              ))}
            </ol>
          ) : <div className="qb-empty"><Trophy size={24} aria-hidden="true" /><strong>No rankings yet</strong>Complete a ranked challenge to appear here.</div>}
        </section>

        <section className="qb-card qb-dash-card">
          <div className="qb-page-head"><h2>Achievements</h2></div>
          {achievements.length > 0 ? (
            <div className="qb-badges">
              {achievements.slice(0, 4).map((ach) => (
                <div key={ach.id} className="qb-badge-item">
                  <AchievementBadge type={ach.type.toLowerCase() === 'championship' ? 'championship' : 'mastery'} tier={ach.tier?.toLowerCase() || 'standard'} size="md" label="" />
                  <strong>{sanitizeLabel(ach.title)}</strong>
                </div>
              ))}
            </div>
          ) : <div className="qb-empty"><strong>No achievements yet</strong>Badges unlock as you master topics and compete.</div>}
        </section>
      </div>
    </>
  );
}
