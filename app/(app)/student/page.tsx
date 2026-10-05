"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Dumbbell, FileText, Flag, Trophy } from "lucide-react";
import { bootstrapUser } from "@/lib/auth";
import { getStudentDashboard, getStudentCompetitionAnalytics, getStudentAchievements } from "@/lib/api/student";
import { listAvailableAssessments, startAttempt } from "@/lib/api/assessment";
import TrendChart from "@/components/charts/TrendChart";
import AchievementBadge from "@/components/achievements/AchievementBadge";
import ProgressCard from "@/components/ProgressCard";
import { formatDate, isUuid } from "@/lib/format";
import { practiseHref, sanitizeLabel, subjectLabel } from "@/lib/learning/labels";
import { XP_RULES } from "@/lib/learning/xp";

type Subject = { code: string; name: string; percentage: number; count: number; evidence: number };

export default function StudentHomePage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [comp, setComp] = useState<any>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [practice, setPractice] = useState<any>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    bootstrapUser().then(async (ctx) => {
      const studentId = String((ctx.studentProfile as any)?.id ?? "");
      if (!studentId) throw new Error("Student profile not found.");
      setName(String((ctx.profile as any)?.full_name ?? "").split(" ")[0]);
      const [dash, c, a, available] = await Promise.all([
        getStudentDashboard(studentId),
        getStudentCompetitionAnalytics(studentId).catch(() => null),
        getStudentAchievements(studentId).catch(() => []),
        listAvailableAssessments().catch(() => []),
      ]);
      setData(dash); setComp(c); setAchievements(a);
      setPractice((available as any[]).find((row) => String(row.assessment_type).toUpperCase() === "PRACTICE") ?? null);
    }).catch((e) => setError(e.message));
  }, []);

  if (error && !data) return <div className="qb-card qb-error" role="alert">{error}</div>;
  if (!data) return <div className="qb-sh-grid" aria-busy="true"><div className="qb-card qb-skeleton" /><div className="qb-card qb-skeleton" /><div className="qb-card qb-skeleton" /></div>;

  const results: any[] = data.results ?? [];
  const assignments: any[] = data.assignments ?? [];
  const xp = data.xp ?? { total_xp: 0, level: 1, current_level_xp: 0, next_level_xp: 100 };
  const klass = data.memberships?.[0]?.classes;

  const bySubject = new Map<string, Subject>();
  for (const row of results) {
    const code = isUuid(row.subject_code) ? "" : String(row.subject_code ?? "");
    const key = code || "general";
    const current = bySubject.get(key) ?? { code, name: subjectLabel(code), percentage: 0, count: 0, evidence: 0 };
    current.percentage += Number(row.percentage ?? 0); current.count += 1; current.evidence += Number(row.total_marks ?? 0) || 0; bySubject.set(key, current);
  }
  const subjects = [...bySubject.values()].map((s) => ({ ...s, percentage: Math.round(s.percentage / s.count) })).sort((a, b) => a.percentage - b.percentage);
  const strongest = subjects.length > 1 ? subjects[subjects.length - 1] : null;
  const weakest = subjects[0];
  const trend = [...results].reverse().map((r, i) => ({ name: r.submitted_at ? new Date(r.submitted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : `Attempt ${i + 1}`, score: Math.round(Number(r.percentage ?? 0)) }));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const next = assignments[0];
  const last = results[0];
  const levelPct = xp.next_level_xp ? Math.min(100, Math.round((Number(xp.current_level_xp) / Number(xp.next_level_xp)) * 100)) : 0;
  const rank = comp?.current_rank;

  const begin = async (args: { assessmentId: string; assignmentId?: string; classId?: string }) => {
    setStarting(true); setError("");
    try { router.push(`/student/attempt/${((await startAttempt(args)) as any).attempt_id}`); }
    catch (e: any) { setError(e.message); setStarting(false); }
  };
  const startAssignment = (row: any) => begin({ assessmentId: row.assignments.assessment_id, assignmentId: row.assignment_id, classId: row.class_id });

  return (
    <>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <section className="qb-dashboard-hero qb-sh-hero" aria-labelledby="sh-title">
        <div>
          <p className="qb-eyebrow">{[klass?.grade, klass?.class_name].filter(Boolean).join(" · ") || "Student workspace"}</p>
          <h1 id="sh-title">{greeting}{name ? `, ${name}` : ""}</h1>
          <p>{assignments.length ? `${assignments.length} assignment${assignments.length === 1 ? "" : "s"} waiting for you.` : "You are all caught up. Keep practising to build mastery."}</p>
          <div className="qb-actions">
            {next
              ? <button className="qb-btn" disabled={starting} onClick={() => void startAssignment(next)}>Start {sanitizeLabel(next.assignments?.title ?? "assignment")}<ArrowRight size={16} aria-hidden="true" /></button>
              : <Link className="qb-btn" href="/practise">Start practising<ArrowRight size={16} aria-hidden="true" /></Link>}
            <Link className="qb-btn ghost" href="/learn">Explore Learn</Link>
          </div>
        </div>
        <div className="qb-sh-level" aria-label="Level and experience">
          <span className="qb-sh-level-num">Level {xp.level}</span>
          <div className="qb-progress-track" role="progressbar" aria-valuenow={levelPct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level"><div className="qb-progress-fill" style={{ width: `${levelPct}%` }} /></div>
          <span className="qb-muted qb-small">{Number(xp.total_xp).toLocaleString()} XP · {Number(xp.current_level_xp)} / {Number(xp.next_level_xp)} to level {Number(xp.level) + 1}</span>
        </div>
      </section>

      <div className="qb-sh-grid">
        <div className="qb-sh-main">
          <div className="qb-sh-pair">
            <section className="qb-card qb-sh-focus" aria-labelledby="sh-continue">
              <p className="qb-overline"><BookOpen size={14} aria-hidden="true" /> Continue learning</p>
              {last ? <>
                <h2 id="sh-continue">{subjectLabel(last.subject_code)}</h2>
                <p className="qb-muted">Last result {Math.round(Number(last.percentage ?? 0))}%{last.submitted_at ? ` · ${formatDate(last.submitted_at)}` : ""}</p>
                <Link className="qb-btn secondary" href={practiseHref(last.subject_code)}>Keep practising</Link>
              </> : <>
                <h2 id="sh-continue">Start with a topic</h2>
                <p className="qb-muted">Pick a subject and strand, then practise what you learned.</p>
                <Link className="qb-btn secondary" href="/learn">Open Learn</Link>
              </>}
            </section>
            <section className="qb-card qb-sh-focus" aria-labelledby="sh-challenge">
              <p className="qb-overline"><Dumbbell size={14} aria-hidden="true" /> Today&apos;s practice</p>
              {practice ? <>
                <h2 id="sh-challenge">{sanitizeLabel(practice.title ?? practice.subject_name ?? "Practice set")}</h2>
                <p className="qb-muted">{practice.question_count ?? "Several"} questions{practice.time_limit_minutes ? ` · ${practice.time_limit_minutes} min` : ""} · {XP_RULES.correctAnswer} XP per correct answer</p>
                <button className="qb-btn" disabled={starting} onClick={() => void begin({ assessmentId: practice.id })}>{starting ? "Starting…" : "Start"}</button>
              </> : <>
                <h2 id="sh-challenge">No practice set yet</h2>
                <p className="qb-muted">New practice sets appear here as they are published for you.</p>
                <Link className="qb-btn secondary" href="/practise">Browse Practise</Link>
              </>}
            </section>
          </div>

          <section className="qb-card" aria-labelledby="sh-assignments">
            <div className="qb-page-head"><h2 id="sh-assignments">Assignments</h2><Link className="qb-link" href="/student/classroom">All assignments</Link></div>
            {assignments.length ? <ul className="qb-task-list">
              {assignments.slice(0, 3).map((row) => <li key={row.id}>
                <span className="qb-task-icon" aria-hidden="true"><FileText size={16} /></span>
                <div className="qb-row-main"><strong>{sanitizeLabel(row.assignments?.title ?? "Assignment")}</strong><span>{subjectLabel(row.assignments?.subject_code)}{row.assignments?.due_at ? ` · Due ${formatDate(row.assignments.due_at)}` : " · No due date"}</span></div>
                <button className="qb-btn secondary" disabled={starting} onClick={() => void startAssignment(row)}>Start</button>
              </li>)}
            </ul> : <div className="qb-empty"><strong>Nothing due</strong>Work from your teachers appears here.</div>}
          </section>

          <section className="qb-card" aria-labelledby="sh-subjects">
            <div className="qb-page-head"><h2 id="sh-subjects">Subject progress</h2><Link className="qb-link" href="/student/results">Full progress</Link></div>
            {subjects.length ? <div className="qb-subject-list">
              {subjects.slice(0, 4).map((s) => <ProgressCard key={s.name} name={s.name} percentage={s.percentage} detail={`${s.count} result${s.count === 1 ? "" : "s"}`} evidence={s.evidence || s.count} href={practiseHref(s.code)} />)}
            </div> : <div className="qb-empty"><strong>No mastery data yet</strong>Complete a practice set or assessment to see progress by subject.</div>}
          </section>

          <section className="qb-card" aria-labelledby="sh-performance">
            <h2 id="sh-performance">Recent performance</h2>
            {trend.length > 1 ? <TrendChart data={trend} height={180} yAxisLabel="Score %" /> : <div className="qb-empty"><strong>Not enough attempts</strong>Complete at least two to see your trend.</div>}
            {subjects.length > 0 && <ul className="qb-plain-list qb-sh-cues">
              {strongest && <li><span className="qb-pill success">Strength</span> {strongest.name} · {strongest.percentage}%</li>}
              {weakest.percentage < 68 && <li><span className="qb-pill danger">Focus next</span> {weakest.name} · {weakest.percentage}% · <Link className="qb-link" href={practiseHref(weakest.code)}>Practise</Link></li>}
            </ul>}
          </section>
        </div>

        <aside className="qb-sh-side">
          <section className="qb-card" aria-labelledby="sh-compete">
            <div className="qb-page-head"><h2 id="sh-compete">Compete</h2><Link className="qb-link" href="/competition">Challenges</Link></div>
            {rank ? <p className="qb-sh-rank"><Trophy size={18} aria-hidden="true" /> Rank #{rank}</p> : null}
            {comp?.leaderboard?.length ? <ol className="qb-leaderboard">
              {comp.leaderboard.slice(0, 3).map((p: any, i: number) => <li key={p.id || i} className={`top-${i + 1}`}>
                <span className="qb-leader-rank">{i + 1}</span><span className="qb-leader-name">{sanitizeLabel(p.name || "Learner")}</span><strong>{p.score || 0}</strong>
              </li>)}
            </ol> : <div className="qb-empty"><Flag size={22} aria-hidden="true" /><strong>No rankings yet</strong>Join a challenge to appear here.</div>}
          </section>
          <section className="qb-card" aria-labelledby="sh-rewards">
            <div className="qb-page-head"><h2 id="sh-rewards">Achievements</h2></div>
            {achievements.length ? <div className="qb-badges">
              {achievements.slice(0, 4).map((a) => <div key={a.id} className="qb-badge-item">
                <AchievementBadge type={String(a.type).toLowerCase() === "championship" ? "championship" : "mastery"} tier={a.tier?.toLowerCase() || "standard"} size="md" label="" />
                <strong>{sanitizeLabel(a.title)}</strong>
              </div>)}
            </div> : <div className="qb-empty"><strong>No achievements yet</strong>Badges unlock as you master topics and compete.</div>}
          </section>
        </aside>
      </div>
    </>
  );
}
