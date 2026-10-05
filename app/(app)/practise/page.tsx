"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, Play, RotateCcw, Target, Zap } from "lucide-react";
import { bootstrapUser } from "@/lib/auth";
import { getMyAttemptsPage, listAvailableAssessments, startAttempt } from "@/lib/api/assessment";
import { getStudentDashboard } from "@/lib/api/student";
import { studentInsights } from "@/lib/api/platform";
import { sanitizeLabel, subjectLabel } from "@/lib/learning/labels";
import { formatDate } from "@/lib/format";

type PracticeSet = { id: string; assessment_type: string; subject_code: string | null; subject_name: string | null; grade: string | null; question_count: number | null; difficulty: string | null; time_limit_minutes: number | null };
const isPractice = (row: PracticeSet) => String(row.assessment_type).toUpperCase() === "PRACTICE";
const setTitle = (row: PracticeSet) => sanitizeLabel(row.subject_name ?? row.subject_code ?? "Practice set");

function PractiseInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [sets, setSets] = useState<PracticeSet[] | null>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [assigned, setAssigned] = useState<any[]>([]);
  const [weakSubject, setWeakSubject] = useState("");
  const [subject, setSubject] = useState(params.get("subject") ?? "");
  const [difficulty, setDifficulty] = useState("");
  const [starting, setStarting] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    listAvailableAssessments().then((rows) => setSets((rows as PracticeSet[]).filter(isPractice))).catch((e) => { setError(e.message); setSets([]); });
    getMyAttemptsPage(1).then((r) => setAttempts(r.rows)).catch(() => setAttempts([]));
    studentInsights().then((d) => {
      const worst = [...(d.by_subject ?? [])].filter((s: any) => s.subject).sort((a: any, b: any) => Number(a.mastery) - Number(b.mastery))[0];
      setWeakSubject(worst && Number(worst.mastery) < 68 ? String(worst.subject) : "");
    }).catch(() => undefined);
    bootstrapUser().then((ctx) => getStudentDashboard(String((ctx.studentProfile as any)?.id ?? "")))
      .then((d) => setAssigned((d.assignments as any[]).filter((row) => String(row.assignments?.mode ?? "").toUpperCase() === "PRACTICE")))
      .catch(() => setAssigned([]));
  }, []);

  const subjects = useMemo(() => [...new Set((sets ?? []).map((s) => s.subject_code).filter(Boolean) as string[])], [sets]);
  const difficulties = useMemo(() => [...new Set((sets ?? []).map((s) => s.difficulty).filter(Boolean) as string[])], [sets]);
  const visible = (sets ?? []).filter((s) => (!subject || s.subject_code === subject) && (!difficulty || s.difficulty === difficulty));
  const resumable = attempts.filter((a) => String(a.status).toUpperCase() === "IN_PROGRESS" && (sets ?? []).some((s) => s.id === a.assessment_id));
  const weakSet = weakSubject ? (sets ?? []).find((s) => s.subject_code === weakSubject || s.subject_name === weakSubject) : undefined;

  async function begin(args: { assessmentId: string; assignmentId?: string; classId?: string }, key: string) {
    setStarting(key); setError("");
    try { router.push(`/student/attempt/${((await startAttempt(args)) as any).attempt_id}`); }
    catch (e: any) { setError(e.message); setStarting(""); }
  }

  return (
    <>
      <div className="qb-page-head"><div><h1>Practise</h1><p>Short practice sets with instant feedback. Practising builds mastery and earns XP.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}

      <section className="qb-card" aria-labelledby="pr-shortcuts">
        <h2 id="pr-shortcuts">Jump back in</h2>
        <div className="qb-launch-grid">
          <div className="qb-launch">
            <h3><Zap size={16} aria-hidden="true" /> Quick practice</h3>
            <p className="qb-muted">The newest practice set available to you.</p>
            <button className="qb-btn" disabled={!sets?.length || !!starting} onClick={() => sets?.[0] && void begin({ assessmentId: sets[0].id }, "quick")}>{starting === "quick" ? "Starting…" : "Start"}</button>
          </div>
          <div className="qb-launch">
            <h3><Target size={16} aria-hidden="true" /> Weak areas</h3>
            <p className="qb-muted">{weakSet ? `${subjectLabel(weakSubject)} is your lowest subject right now.` : "Appears once your results show a subject that needs work."}</p>
            <button className="qb-btn secondary" disabled={!weakSet || !!starting} onClick={() => weakSet && void begin({ assessmentId: weakSet.id }, "weak")}>{starting === "weak" ? "Starting…" : "Practise weak area"}</button>
          </div>
          <div className="qb-launch">
            <h3><RotateCcw size={16} aria-hidden="true" /> Continue practice</h3>
            <p className="qb-muted">{resumable.length ? `Unfinished set started ${formatDate(resumable[0].started_at)}.` : "No unfinished practice sets."}</p>
            <Link className={`qb-btn secondary${resumable.length ? "" : " disabled"}`} aria-disabled={!resumable.length} tabIndex={resumable.length ? undefined : -1} href={resumable.length ? `/student/attempt/${resumable[0].id}` : "/practise"}>Resume</Link>
          </div>
        </div>
        {assigned.length > 0 && <>
          <h3 style={{ marginTop: 16 }}>Practice from your teacher</h3>
          <ul className="qb-task-list">
            {assigned.slice(0, 3).map((row) => <li key={row.id}>
              <div className="qb-row-main"><strong>{sanitizeLabel(row.assignments?.title ?? "Assignment")}</strong><span>{subjectLabel(row.assignments?.subject_code)}{row.assignments?.due_at ? ` · Due ${formatDate(row.assignments.due_at)}` : ""}</span></div>
              <button className="qb-btn secondary" disabled={!!starting} onClick={() => void begin({ assessmentId: row.assignments.assessment_id, assignmentId: row.assignment_id, classId: row.class_id }, row.id)}>Start</button>
            </li>)}
          </ul>
        </>}
      </section>

      <section className="qb-card" aria-labelledby="pr-sets" style={{ marginTop: 16 }}>
        <h2 id="pr-sets">Choose a practice set</h2>
        {subjects.length > 0 && <div className="qb-chip-row" role="group" aria-label="Subject">
          <button type="button" className="qb-chip" aria-pressed={!subject} onClick={() => setSubject("")}>All subjects</button>
          {subjects.map((code) => <button type="button" key={code} className="qb-chip" aria-pressed={subject === code} onClick={() => setSubject(code)}>{subjectLabel(code)}</button>)}
        </div>}
        {difficulties.length > 1 && <div className="qb-chip-row" role="group" aria-label="Difficulty" style={{ marginTop: 8 }}>
          <button type="button" className="qb-chip" aria-pressed={!difficulty} onClick={() => setDifficulty("")}>Any difficulty</button>
          {difficulties.map((d) => <button type="button" key={d} className="qb-chip" aria-pressed={difficulty === d} onClick={() => setDifficulty(d)}>{sanitizeLabel(d)}</button>)}
        </div>}

        <div className="qb-launch-grid" style={{ marginTop: 14 }} aria-busy={sets === null}>
          {sets === null && [1, 2, 3].map((i) => <div key={i} className="qb-launch qb-skeleton" />)}
          {visible.map((s) => <div key={s.id} className="qb-launch">
            <h3>{setTitle(s)}</h3>
            <div className="qb-meta">
              {s.grade && <span>{s.grade}</span>}
              {s.question_count != null && <span>{s.question_count} questions</span>}
              {s.time_limit_minutes != null && <span><Clock size={12} aria-hidden="true" /> {s.time_limit_minutes} min</span>}
              {s.difficulty && <span>{sanitizeLabel(s.difficulty)}</span>}
            </div>
            <button className="qb-btn" disabled={!!starting} onClick={() => void begin({ assessmentId: s.id }, s.id)}><Play size={14} aria-hidden="true" />{starting === s.id ? "Starting…" : "Start practice"}</button>
          </div>)}
        </div>
        {sets && !visible.length && <div className="qb-empty"><strong>No practice sets match</strong>{sets.length ? "Try another subject or difficulty." : "Practice sets appear here once they are published for you."}</div>}
        <p className="qb-gap-note" style={{ marginTop: 14 }}>Practice sets are published ahead of time, so strand, question count and difficulty cannot be chosen freely yet. Browse the curriculum in <Link className="qb-link" href="/learn">Learn</Link>.</p>
      </section>
    </>
  );
}

export default function PractisePage() {
  return <Suspense fallback={<div className="qb-card qb-skeleton" aria-busy="true" />}><PractiseInner /></Suspense>;
}
