"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { buildQuickPractice, countChoices, getPracticeMenu, type PracticeMenu } from "@/lib/api/practice";
import { startAttempt } from "@/lib/api/assessment";

// One short screen: pick a subject, tick topics (or "All topics"), pick how many questions, press Start.
// No strands, sub-strands or codes are shown; topics are the plain sub-strand names with the number of questions each has.
export default function QuickPractice() {
  const router = useRouter();
  const [menu, setMenu] = useState<PracticeMenu | null>(null), [subjectId, setSubjectId] = useState("");
  const [ticked, setTicked] = useState<string[]>([]), [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");

  useEffect(() => { getPracticeMenu().then(setMenu).catch((e) => { setError(e.message); setMenu({ grade: "", subjects: [] }); }); }, []);
  const subject = menu?.subjects.find((s) => s.id === subjectId);
  const pool = useMemo(() => subject ? subject.topics.filter((t) => ticked.includes(t.id)).reduce((n, t) => n + t.available, 0) : 0, [subject, ticked]);
  const choices = countChoices(pool);
  useEffect(() => { if (choices.length && !choices.includes(count)) setCount(choices.includes(10) ? 10 : choices[choices.length - 1]); }, [choices, count]);

  const pick = (id: string) => { setSubjectId(id); const s = menu?.subjects.find((x) => x.id === id); setTicked(s ? s.topics.map((t) => t.id) : []); setNote(""); setError(""); };
  async function start() {
    if (!subject || !ticked.length || busy) return;
    setBusy(true); setError(""); setNote("");
    try {
      const built = await buildQuickPractice(ticked, count);
      if (built.short) setNote(`Only ${built.question_count} questions are available for these topics, so that is what you get.`);
      const attempt = await startAttempt({ assessmentId: built.assessment_id }) as { attempt_id: string };
      router.push(`/student/attempt/${attempt.attempt_id}`);
    } catch (e: any) { setError(e?.message ?? "Could not start practice."); setBusy(false); }
  }

  if (menu === null) return <section className="qb-card qb-skeleton" aria-busy="true" style={{ minHeight: 120 }} />;
  if (!menu.subjects.length) return <section className="qb-card"><h2>Build your practice</h2>
    {error ? <p className="qb-error" role="alert">{error}</p> : <p className="qb-muted">Questions for your class are being added. Check back soon, or use a practice set below.</p>}</section>;
  return <section className="qb-card" aria-labelledby="qp-title">
    <h2 id="qp-title">Build your own practice</h2>
    <p className="qb-muted">Pick a subject, tick what you want to practise, choose how many questions and start.{menu.grade ? ` Showing ${menu.grade} questions.` : ""}</p>
    {error && <p className="qb-error" role="alert">{error}</p>}{note && <p role="status">{note}</p>}

    <h3>1. Subject</h3>
    <div className="qb-chip-row" role="group" aria-label="Subject">
      {menu.subjects.map((s) => <button type="button" key={s.id} className="qb-chip" aria-pressed={subjectId === s.id} onClick={() => pick(s.id)}>{s.name} <span className="qb-muted">({s.available})</span></button>)}
    </div>

    {subject && <>
      <h3 style={{ marginTop: 14 }}>2. Topics <span className="qb-muted qb-small">tick one or more</span></h3>
      <label className="qb-small" style={{ display: "block", marginBottom: 6 }}><input type="checkbox" checked={ticked.length === subject.topics.length}
        onChange={(e) => setTicked(e.target.checked ? subject.topics.map((t) => t.id) : [])}/> All topics</label>
      <ul className="qb-task-list">
        {subject.topics.map((t) => <li key={t.id}><label><input type="checkbox" checked={ticked.includes(t.id)}
          onChange={(e) => setTicked(e.target.checked ? [...ticked, t.id] : ticked.filter((x) => x !== t.id))}/> {t.title} <span className="qb-muted">({t.available} questions)</span></label></li>)}
      </ul>

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
