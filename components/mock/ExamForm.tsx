"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createExam, curricula, updateExam, type CurriculumOption, type Exam, type ExamInput } from "@/lib/api/mock-exams";
import { GRADES, gradeLabel, stageOf, stageLabel } from "@/lib/mock-exams/grades";
import { PURPOSES, isWaecLabel } from "@/lib/mock-exams/purposes";

// The exam's name, purpose, target year and rules. The target year decides which earlier years can feed it (same stage, not above the target).
const BLANK: ExamInput = { title: "", description: "", purpose: "practice", audience: "", curriculum_id: "", target_grade: "B8", desired_total: 20, time_limit_minutes: 60, attempts_allowed: 1, shuffle_questions: false, instructions: "" };
const fromExam = (e: Exam): ExamInput => ({ title: e.title, description: e.description, purpose: e.purpose, audience: e.audience, curriculum_id: e.curriculum_id, target_grade: e.target_grade, desired_total: e.desired_total,
  time_limit_minutes: e.time_limit_minutes, attempts_allowed: e.attempts_allowed, shuffle_questions: e.shuffle_questions, instructions: e.instructions });

export default function ExamForm({ exam, onSaved }: { exam?: Exam; onSaved: (e: Exam) => void }) {
  const [f, setF] = useState<ExamInput>(exam ? fromExam(exam) : BLANK), [options, setOptions] = useState<CurriculumOption[] | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const archived = exam?.status === "archived", locked = Boolean(exam?.rounds.length);
  useEffect(() => { curricula().then((c) => { setOptions(c); setF((x) => (x.curriculum_id || !c.length ? x : { ...x, curriculum_id: c[0].id })); }).catch((e) => { setError(e.message); setOptions([]); }); }, []);
  const set = <K extends keyof ExamInput>(k: K, v: ExamInput[K]) => { setSaved(false); setF((x) => ({ ...x, [k]: v })); };

  async function submit(ev: FormEvent) {
    ev.preventDefault(); setBusy(true); setError(""); setSaved(false);
    try { const e = exam ? await updateExam(exam.id, f) : await createExam(f); setSaved(true); onSaved(e); } catch (x) { setError((x as Error).message); }
    setBusy(false);
  }
  const hint = PURPOSES.find((p) => p.value === f.purpose)?.hint;

  return (
    <form className="qb-card qb-form" onSubmit={(e) => void submit(e)} aria-label={exam ? "Exam details" : "New mock exam"}>
      {error && <p className="qb-error" role="alert">{error}</p>}
      <div className="qb-field"><label htmlFor="mx-title">Exam name</label><input id="mx-title" required minLength={5} maxLength={120} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. JHS 2 BECE readiness mock" disabled={archived} /></div>
      <div className="qb-field"><label htmlFor="mx-desc">Description (optional)</label><textarea id="mx-desc" maxLength={800} value={f.description} onChange={(e) => set("description", e.target.value)} disabled={archived} /></div>
      <div className="qb-grid cols-2">
        <div className="qb-field"><label htmlFor="mx-purpose">Purpose</label><select id="mx-purpose" value={f.purpose} onChange={(e) => set("purpose", e.target.value)} disabled={archived}>{PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
          {hint && <span className={`qb-small ${isWaecLabel(f.purpose) ? "qb-error" : "qb-muted"}`}>{hint}</span>}</div>
        <div className="qb-field"><label htmlFor="mx-audience">Who is it for? (optional)</label><input id="mx-audience" maxLength={200} value={f.audience} onChange={(e) => set("audience", e.target.value)} placeholder="e.g. JHS 2 learners preparing for JHS 3" disabled={archived} /></div>
        <div className="qb-field"><label htmlFor="mx-curr">Curriculum</label>
          <select id="mx-curr" value={f.curriculum_id} onChange={(e) => set("curriculum_id", e.target.value)} disabled={archived || locked || options === null} required>
            {options === null ? <option>Loading…</option> : !options.length ? <option value="">No curriculum available</option> : options.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.version})</option>)}</select>
          {locked && <span className="qb-small qb-muted">The curriculum cannot change once rounds exist.</span>}</div>
        <div className="qb-field"><label htmlFor="mx-grade">Target year (the year the learners are in)</label>
          <select id="mx-grade" value={f.target_grade} onChange={(e) => set("target_grade", e.target.value)} disabled={archived}>
            {(["PRIMARY", "JHS", "SHS"] as const).map((s) => <optgroup key={s} label={stageLabel(s)}>{GRADES.filter((g) => stageOf(g) === s).map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}</optgroup>)}</select>
          <span className="qb-small qb-muted">Rounds can use this year and earlier years of the same stage.</span></div>
        <div className="qb-field"><label htmlFor="mx-total">Number of questions</label><input id="mx-total" type="number" inputMode="numeric" min={5} max={100} required value={f.desired_total} onChange={(e) => set("desired_total", Number(e.target.value))} disabled={archived} />
          <span className="qb-small qb-muted">5 to 100. You add rounds (up to 10 questions from any one topic) until they add up to this.</span></div>
        <div className="qb-field"><label htmlFor="mx-time">Time allowed (minutes)</label><input id="mx-time" type="number" inputMode="numeric" min={5} max={300} required value={f.time_limit_minutes} onChange={(e) => set("time_limit_minutes", Number(e.target.value))} disabled={archived} /></div>
        <div className="qb-field"><label htmlFor="mx-att">Attempts allowed</label><select id="mx-att" value={f.attempts_allowed} onChange={(e) => set("attempts_allowed", Number(e.target.value))} disabled={archived}>{[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
        <label className="qb-check"><input type="checkbox" checked={f.shuffle_questions} onChange={(e) => set("shuffle_questions", e.target.checked)} disabled={archived} /> Shuffle the question order for each buyer (marketplace only; answer options are never shuffled)</label>
      </div>
      <div className="qb-field"><label htmlFor="mx-ins">Instructions for learners (optional)</label><textarea id="mx-ins" maxLength={1000} value={f.instructions} onChange={(e) => set("instructions", e.target.value)} disabled={archived} /></div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="qb-btn" disabled={busy || archived || !f.curriculum_id}>{busy ? "Saving…" : exam ? "Save details" : "Create exam and add rounds"}</button>
        {saved && <span className="qb-ok" role="status">Saved.</span>}
      </div>
    </form>
  );
}
