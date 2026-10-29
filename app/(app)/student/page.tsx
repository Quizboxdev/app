"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, Coins, Dumbbell, FileText, Flag, Flame, Star, Target, Trophy } from "lucide-react";
import { bootstrapUser } from "@/lib/auth";
import { getStudentDashboard, getStudentCompetitionAnalytics, getStudentAchievements } from "@/lib/api/student";
import { listAvailableAssessments, startAttempt } from "@/lib/api/assessment";
import TrendChart from "@/components/charts/TrendChart";
import AchievementBadge from "@/components/achievements/AchievementBadge";
import ProgressCard from "@/components/ProgressCard";
import { formatDate, isUuid } from "@/lib/format";
import { practiseHref, sanitizeLabel, subjectLabel } from "@/lib/learning/labels";
import { XP_RULES } from "@/lib/learning/xp";
import { dayStreak, todayGoal, upNext } from "@/lib/learning/home";
import { getMyAccess, type MyAccess } from "@/lib/api/access";
import { getMyQPoints, getMyWallet } from "@/lib/api/core";
import SubjectIcon from "@/components/SubjectIcon";
import InstallPrompt from "@/components/InstallPrompt";
import SponsoredCarousel from "@/components/challenges/SponsoredCarousel";
import { levelFromGrade } from "@/lib/challenges/content-types";
import { errorMessage } from "@/lib/errors";
import KnowledgeWindow, { KnowledgeWindowGrid } from "@/components/qinsignia/KnowledgeWindow";
import MasteryBadge from "@/components/MasteryBadge";
import { useWorkspaceFlags } from "@/components/WorkspaceProvider";
import { subjectCardView } from "@/lib/learning/subject-card-state";
import { subjectSlug } from "@/lib/brand/subjects";
import { getPracticeMenu, type PracticeMenu } from "@/lib/api/practice";
import { getMyAttemptsPage } from "@/lib/api/assessment";
import type { MyAttempt } from "@/lib/api/student-types";
import type { BadgeTier } from "@/components/achievements/AchievementBadge";
import type { Achievement, AvailableAssessment, CompetitionAnalytics, StudentDashboardData } from "@/lib/api/student-types";
import type { AssignmentLike } from "@/lib/learning/home";

type Subject = { code: string; name: string; percentage: number; count: number; evidence: number };

export default function StudentHomePage() {
  const router = useRouter();
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [comp, setComp] = useState<CompetitionAnalytics | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [practice, setPractice] = useState<AvailableAssessment | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [access, setAccess] = useState<MyAccess | null>(null);
  const [coins, setCoins] = useState<number | null>(null);
  const [qpoints, setQpoints] = useState<number | null>(null);
  const flags = useWorkspaceFlags();
  const cards = flags.q_insignia_subject_cards_v02;
  const [menu, setMenu] = useState<PracticeMenu | null | "error">(null);
  const [sets, setSets] = useState<AvailableAssessment[]>([]);
  const [unfinished, setUnfinished] = useState<MyAttempt | null>(null);
  // Q-Insignia pilot only: the same practice menu and attempts the Practise page reads. Nothing is fetched while the flag is off.
  const loadMenu = () => { setMenu(null); getPracticeMenu().then(setMenu).catch(() => setMenu("error")); };
  useEffect(() => {
    if (!cards) return;
    loadMenu();
    getMyAttemptsPage(1).then((r) => setUnfinished(r.rows.find((a) => String(a.status).toUpperCase() === "IN_PROGRESS") ?? null)).catch(() => setUnfinished(null));
  }, [cards]);

  useEffect(() => {
    bootstrapUser().then(async (ctx) => {
      const studentId = String(ctx.studentProfile?.id ?? "");
      if (!studentId) throw new Error("Student profile not found.");
      setName(String(ctx.profile?.full_name ?? "").split(" ")[0]);
      const [dash, c, a, available] = await Promise.all([
        getStudentDashboard(studentId),
        getStudentCompetitionAnalytics(studentId).catch(() => null),
        getStudentAchievements(studentId).catch(() => []),
        listAvailableAssessments().catch(() => []),
      ]);
      setData(dash); setComp(c); setAchievements(a);
      setSets(available);
      setPractice(available.find((row) => String(row.assessment_type).toUpperCase() === "PRACTICE") ?? null);
      void getMyAccess().then(setAccess);
      void getMyWallet(ctx.userId).then((w) => setCoins(w ? Number(w.purchased_balance) + Number(w.promotional_balance) : 0)).catch(() => setCoins(null));
      void getMyQPoints(ctx.userId).then(setQpoints).catch(() => setQpoints(null));
    }).catch((e) => setError(errorMessage(e)));
  }, []);

  if (error && !data) return <div className="qb-card qb-error" role="alert">{error}</div>;
  if (!data) return <div className="qb-sh-grid" aria-busy="true"><div className="qb-card qb-skeleton" /><div className="qb-card qb-skeleton" /><div className="qb-card qb-skeleton" /></div>;

  const results = data.results ?? [];
  const assignments = data.assignments ?? [];
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
  const goal = todayGoal(results);
  const streak = dayStreak(results);
  const nextStep = upNext(assignments, subjects.map((x) => ({ code: x.code, name: x.name, percentage: x.percentage })));

  const begin = async (args: { assessmentId: string; assignmentId?: string; classId?: string }) => {
    setStarting(true); setError("");
    try { router.push(`/student/attempt/${(await startAttempt(args)).attempt_id}`); }
    catch (e) { setError(errorMessage(e)); setStarting(false); }
  };
  const startAssignment = (row: AssignmentLike) => begin({ assessmentId: String(row.assignments?.assessment_id ?? ""), assignmentId: row.assignment_id, classId: row.class_id ?? undefined });

  return (
    <>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <InstallPrompt />
      <SponsoredCarousel level={levelFromGrade(klass?.grade)} />
      <section className="qb-dashboard-hero qb-sh-hero" aria-labelledby="sh-title">
        <div>
          <p className="qb-eyebrow">{[klass?.grade, klass?.class_name].filter(Boolean).join(" · ") || "Student workspace"}</p>
          <h1 id="sh-title">{greeting}{name ? `, ${name}` : ""}</h1>
          <p>{assignments.length ? `${assignments.length} assignment${assignments.length === 1 ? "" : "s"} waiting for you.` : "You are all caught up. Keep practising to build mastery."}</p>
          <div className="qb-actions">
            {next
              ? <button className="qb-btn" disabled={starting} onClick={() => void startAssignment(next)}>Start {sanitizeLabel(next.assignments?.title ?? "assignment")}<ArrowRight size={16} aria-hidden="true" /></button>
              : <Link className="qb-btn" href="/practise">Start practising<ArrowRight size={16} aria-hidden="true" /></Link>}
            {next && <Link className="qb-btn ghost" href="/practise">Practise instead</Link>}
          </div>
        </div>
        <div className="qb-sh-level" aria-label="Level and experience">
          <span className="qb-sh-level-num">Level {xp.level}</span>
          <div className="qb-progress-track" role="progressbar" aria-valuenow={levelPct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level"><div className="qb-progress-fill" style={{ width: `${levelPct}%` }} /></div>
          <span className="qb-muted qb-small">{Number(xp.total_xp).toLocaleString()} XP · {Number(xp.current_level_xp)} / {Number(xp.next_level_xp)} to level {Number(xp.level) + 1}</span>
        </div>
      </section>


      <section className="qb-sh-strip" aria-label="Today at a glance">
        <div className="qb-card qb-sh-stat" aria-labelledby="sh-goal">
          <p className="qb-overline" id="sh-goal"><Target size={14} aria-hidden="true" /> Today&apos;s goal</p>
          <strong>{goal.met ? "Goal met" : `${goal.done} of ${goal.goal} session${goal.goal === 1 ? "" : "s"}`}</strong>
          <div className="qb-progress-track" role="progressbar" aria-valuenow={goal.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Today's goal"><div className="qb-progress-fill" style={{ width: `${goal.pct}%` }} /></div>
          <span className="qb-muted qb-small">{goal.met ? "Great work. Keep going if you like." : "Finish a practice or assessment today."}</span>
        </div>
        <div className="qb-card qb-sh-stat">
          <p className="qb-overline"><Flame size={14} aria-hidden="true" /> Day streak</p>
          <strong>{streak.days}{streak.capped ? "+" : ""} day{streak.days === 1 ? "" : "s"}</strong>
          <span className="qb-muted qb-small">{streak.days ? "Practise every day to keep it going." : "Finish a session today to start a streak."}</span>
        </div>
        {access?.gated && !access.subscribed && <div className="qb-card qb-sh-stat">
          <p className="qb-overline"><Star size={14} aria-hidden="true" /> Free practice</p>
          <strong>{access.exhausted ? "Used up" : `${access.remaining} left`}</strong>
          <span className="qb-muted qb-small"><Link className="qb-link" href="/subscribe">{access.exhausted ? "Subscribe to keep practising" : "See subscription plans"}</Link></span>
        </div>}
        {access?.subscribed && <div className="qb-card qb-sh-stat">
          <p className="qb-overline"><Star size={14} aria-hidden="true" /> Subscription</p>
          <strong>Active</strong>
          <span className="qb-muted qb-small">Unlimited practice.</span>
        </div>}
        {coins !== null && coins > 0 && <div className="qb-card qb-sh-stat"><p className="qb-overline"><Coins size={14} aria-hidden="true" /> Coins</p><strong>{coins.toLocaleString()}</strong><span className="qb-muted qb-small">Your balance</span></div>}
        {qpoints !== null && qpoints > 0 && <div className="qb-card qb-sh-stat"><p className="qb-overline"><Star size={14} aria-hidden="true" /> QPoints</p><strong>{qpoints.toLocaleString()}</strong><span className="qb-muted qb-small">Earned for mastery</span></div>}
      </section>
      {cards && <SubjectWindows menu={menu} sets={sets} unfinished={unfinished} subjects={subjects} onRetry={loadMenu} />}
      <div className="qb-sh-grid">
        <div className="qb-sh-main">
          <div className="qb-sh-pair">
            <section className="qb-card qb-sh-focus" aria-labelledby="sh-continue">
              <p className="qb-overline"><BookOpen size={14} aria-hidden="true" /> Up next</p>
              {nextStep.kind === "assignment" ? <>
                <h2 id="sh-continue">{sanitizeLabel(nextStep.title)}</h2>
                <p className="qb-muted">{nextStep.overdue ? "This assignment is overdue." : nextStep.due ? `Due ${formatDate(nextStep.due)}.` : "From your teacher."}</p>
                <button className="qb-btn" disabled={starting} onClick={() => void startAssignment(nextStep.row)}>{starting ? "Starting…" : "Start assignment"}</button>
              </> : nextStep.kind === "weak" ? <>
                <h2 id="sh-continue">Improve {nextStep.subjectName}</h2>
                <p className="qb-muted">Your lowest subject is at {nextStep.percentage}%. A short practice will lift it.</p>
                <Link className="qb-btn" href={practiseHref(nextStep.subjectCode)}>Practise {nextStep.subjectName}</Link>
              </> : last ? <>
                <h2 id="sh-continue">{subjectLabel(last.subject_code)}</h2>
                <p className="qb-muted">Last result {Math.round(Number(last.percentage ?? 0))}%{last.submitted_at ? ` · ${formatDate(last.submitted_at)}` : ""}</p>
                <Link className="qb-btn secondary" href={practiseHref(last.subject_code)}>Keep practising</Link>
              </> : <>
                <h2 id="sh-continue">Start with a subject</h2>
                <p className="qb-muted">Pick a subject, choose random questions or tick topics, and go.</p>
                <Link className="qb-btn" href="/practise">Start practising</Link>
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
            {subjects.length && cards ? <KnowledgeWindowGrid dense>
              {subjects.slice(0, 6).map((s) => <KnowledgeWindow key={s.name} variant="compact" name={s.name} href={practiseHref(s.code)} headingLevel={3}
                meta={`${s.percentage}% average · ${s.count} result${s.count === 1 ? "" : "s"}`} measure={<MasteryBadge percentage={s.percentage} evidence={s.evidence || s.count} />}
                view={{ ...subjectCardView({ evidence: s.evidence || s.count }), status: null }} />)}
            </KnowledgeWindowGrid> : subjects.length ? <div className="qb-subject-list">
              {subjects.slice(0, 6).map((s) => <ProgressCard key={s.name} name={s.name} percentage={s.percentage} detail={`${s.count} result${s.count === 1 ? "" : "s"}`} evidence={s.evidence || s.count} href={practiseHref(s.code)} icon={<SubjectIcon name={s.name} size={24} />} />)}
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
              {comp.leaderboard.slice(0, 3).map((p, i) => <li key={p.id || i} className={`top-${i + 1}`}>
                <span className="qb-leader-rank">{i + 1}</span><span className="qb-leader-name">{sanitizeLabel(p.name || "Learner")}</span><strong>{p.score || 0}</strong>
              </li>)}
            </ol> : <div className="qb-empty"><Flag size={22} aria-hidden="true" /><strong>No rankings yet</strong>Join a challenge to appear here.</div>}
          </section>
          <section className="qb-card" aria-labelledby="sh-rewards">
            <div className="qb-page-head"><h2 id="sh-rewards">Achievements</h2></div>
            {achievements.length ? <div className="qb-badges">
              {achievements.slice(0, 4).map((a) => <div key={a.id} className="qb-badge-item">
                <AchievementBadge type={String(a.type).toLowerCase() === "championship" ? "championship" : "mastery"} tier={(a.tier?.toLowerCase() as BadgeTier | undefined) || "standard"} size="md" label="" />
                <strong>{sanitizeLabel(a.title)}</strong>
              </div>)}
            </div> : <div className="qb-empty"><strong>No achievements yet</strong>Badges unlock as you master topics and compete.</div>}
          </section>
        </aside>
      </div>
    </>
  );
}

// Q-Insignia Knowledge Window pilot (flag q_insignia_subject_cards_v02): an unfinished attempt first, then the subjects the
// learner can practise now. Cards open the existing builder with the subject chosen; topics are still picked there.
function SubjectWindows({ menu, sets, unfinished, subjects, onRetry }: { menu: PracticeMenu | null | "error"; sets: AvailableAssessment[]; unfinished: MyAttempt | null; subjects: Subject[]; onRetry: () => void }) {
  const resumeSet = unfinished ? sets.find((x) => x.id === unfinished.assessment_id) : undefined;
  const bySlug = new Map(subjects.map((s) => [subjectSlug(s.name), s]));
  return <section className="qb-card" aria-labelledby="sh-explore">
    <div className="qb-page-head"><h2 id="sh-explore">Your subjects</h2><Link className="qb-link" href="/practise">Build a practice</Link></div>
    {unfinished && <div style={{ marginBottom: 14 }}>
      <KnowledgeWindow variant="returning" name={sanitizeLabel(resumeSet?.subject_name ?? resumeSet?.subject_code ?? "Practice")} href={`/student/attempt/${unfinished.id}`}
        meta={unfinished.started_at ? `Unfinished · started ${formatDate(String(unfinished.started_at))}` : "Unfinished practice"} view={subjectCardView({ attempt: { id: unfinished.id } })} />
    </div>}
    {menu === null ? <KnowledgeWindowGrid>{[1, 2, 3, 4].map((i) => <div key={i} className="qi-kw qb-skeleton" style={{ minHeight: 200 }} aria-hidden="true" />)}</KnowledgeWindowGrid>
      : menu === "error" ? <div className="qb-empty"><strong>Subjects could not load</strong><button type="button" className="qb-btn secondary" onClick={onRetry}>Try again</button></div>
      : !menu.subjects.length ? <div className="qb-empty"><strong>No subjects yet</strong>Questions for {menu.grade || "your class"} are being added. Check back soon.</div>
      : <KnowledgeWindowGrid label="Subjects you can practise">
        {menu.subjects.map((s) => { const mine = bySlug.get(subjectSlug(s.name));
          const view = subjectCardView({ available: s.available, evidence: mine ? mine.evidence || mine.count : 0, weak: !!mine && mine.percentage < 68 });
          return <KnowledgeWindow key={s.id} name={s.name} href={`/practise?pick=${encodeURIComponent(s.id)}`}
            meta={`${s.topics.length} topic${s.topics.length === 1 ? "" : "s"} · ${s.available} question${s.available === 1 ? "" : "s"}`} view={view} />; })}
      </KnowledgeWindowGrid>}
  </section>;
}
