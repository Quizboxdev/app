"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Shuffle, ListChecks } from "lucide-react";
import { buildQuickPractice, countChoices, getPracticeMenu, type PracticeMenu } from "@/lib/api/practice";
import { startAttempt } from "@/lib/api/assessment";
import { gradeSort } from "@/lib/sme/catalogue";

// One short screen for learners and teachers alike: subject, then either a random mix or ticked topics, then how many questions, Start.
// No strands, sub-strands, levels or codes are shown; topics are plain sub-strand names with their question counts. Teachers and admins
// first choose the grade they are working on; a learner's grade comes from their profile and is enforced on the server.
export default function QuickPractice() {
  const router = useRouter();
  const [menu, setMenu] = useState<PracticeMenu | null>(null), [grade, setGrade] = useState(""), [subjectId, setSubjectId] = useState("");
  const [mode, setMode] = useState<"random" | "topics">("random"), [ticked, setTicked] = useState<string[]>([]), [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");

  const load = (g?: string) => { setMenu(null); getPracticeMenu(g).then(setMenu).catch((e) => { setError(e.message); setMenu({ grade: "", subjects: [] }); }); };
  useEffect(() => { load(); }, []);
  const subject = menu?.subjects.find((s) => s.id === subjectId);
  const effective = useMemo(() => subject ? (mode === "random" ? subject.topics.map((t) => t.id) : ticked) : [], [subject, mode, ticked]);
  const pool = useMemo(() => subject ? subject.topics.filter((t) => effective.includes(t.id)).reduce((n, t) => n + t.available, 0) : 0, [subject, effective]);
  const choices = countChoices(pool);
  useEffect(() => { if (choices.length && !choices.includes(count)) setCount(choices.includes(10) ? 10 : choices[choices.length - 1]); }, [choices, count]);

  const pick = (id: string) => { setSubjectId(id); setTicked([]); setMode("random"); setNote(""); setError(""); };
  async function start() {
    if (!subject || !effective.length || busy) return;
    setBusy(true); setError(""); setNote("");
    try {
      const built = await buildQuickPractice(effective, count, grade || undefined);
      if (built.short) setNote(`Only ${built.question_count} questions are available for this choice, so that is what you get.`);
      const attempt = await startAttempt({ assessmentId: built.assessment_id }) as { attempt_id: string };
      router.push(`/student/attempt/${attempt.attempt_id}`);
    } catch (e: any) { setError(e?.message ?? "Could not start practice."); setBusy(false); }
  }

  if (menu === null) return <section className="qb-card qb-skeleton" aria-busy="true" style={{ minHeight: 120 }} />;
  // Teachers and admins: pick the grade first (the server lists the grades that exist for their market).
  if (menu.grades && !menu.grade) return <section className="qb-card"><h2>Build practice questions</h2>
    <p className="qb-muted">Choose the grade you are working on.</p>
    {error && <p className="qb-error" role="alert">{error}</p>}
    <div className="qb-chip-row" role="group" aria-label="Grade">{[...menu.grades].sort(gradeSort).map((g) => <button type="button" key={g} className="qb-chip" onClick={() => { setGrade(g); load(g); }}>{g}</button>)}</div>
    {!menu.grades.length && <p className="qb-muted">No grades are published for your market yet.</p>}</section>;
  if (!menu.subjects.length) return <section className="qb-card"><h2>Build your practice</h2>
    {error ? <p className="qb-error" role="alert">{error}</p> : <p className="qb-muted">Questions for {menu.grade || "your class"} are being added. Check back soon.</p>}</section>;
  return <section className="qb-card" aria-labelledby="qp-title">
    <h2 id="qp-title">Build your practice{menu.grade ? ` · ${menu.grade}` : ""}</h2>
    {error && <p className="qb-error" role="alert">{error}</p>}{note && <p role="status">{note}</p>}

    <h3>1. Subject</h3>
    <div className="qb-chip-row" role="group" aria-label="Subject">
      {menu.subjects.map((s) => <button type="button" key={s.id} className="qb-chip" aria-pressed={subjectId === s.id} onClick={() => pick(s.id)}>{s.name} <span className="qb-muted">({s.available})</span></button>)}
    </div>

    {subject && <>
      <h3 style={{ marginTop: 14 }}>2. What to practise</h3>
      <div className="qb-chip-row" role="group" aria-label="Mode">
        <button type="button" className="qb-chip" aria-pressed={mode === "random"} onClick={() => setMode("random")}><Shuffle size={14} aria-hidden="true" /> Random mix</button>
        <button type="button" className="qb-chip" aria-pressed={mode === "topics"} onClick={() => { setMode("topics"); if (!ticked.length) setTicked(subject.topics.map((t) => t.id)); }}><ListChecks size={14} aria-hidden="true" /> Choose topics</button>
      </div>
      {mode === "topics" && <>
        <label className="qb-small" style={{ display: "block", margin: "10px 0 6px" }}><input type="checkbox" checked={ticked.length === subject.topics.length}
          onChange={(e) => setTicked(e.target.checked ? subject.topics.map((t) => t.id) : [])}/> All topics</label>
        <ul className="qb-task-list">
          {subject.topics.map((t) => <li key={t.id}><label><input type="checkbox" checked={ticked.includes(t.id)}
            onChange={(e) => setTicked(e.target.checked ? [...ticked, t.id] : ticked.filter((x) => x !== t.id))}/> {t.title} <span className="qb-muted">({t.available} questions)</span></label></li>)}
        </ul>
      </>}

      <h3 style={{ marginTop: 14 }}>3. How many questions?</h3>
      {choices.length === 0 ? <p className="qb-muted">Tick at least one topic that has questions.</p> :
        <div className="qb-chip-row" role="group" aria-label="Number of questions">
          {choices.map((n) => <button type="button" key={n} className="qb-chip" aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}
        </div>}

      <div style={{ marginTop: 16 }}>
        <button className="qb-btn" disabled={busy || !choices.length} onClick={() => void start()}><Play size={14} aria-hidden="true" /> {busy ? "Getting your questions…" : `Start ${choices.length ? count : ""} questions`}</button>
      </div>
    </>}
  </section>;
}
