"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { candidates, clearRound, deleteRound, eligibleGradesFor, pickRound, saveRound, setRoundQuestions, subjects, topics, type Candidate, type Exam, type SubjectOption, type TopicOption } from "@/lib/api/mock-exams";
import { gradeLabel } from "@/lib/mock-exams/grades";
import { maxForRound, recoveryLabel, recoveryOptions, roundHealth, roundMessage, type RoundState } from "@/lib/mock-exams/tally";

// Rounds: year -> subject -> topic -> number of questions. Questions are only ever taken from the round's own topic. When a topic cannot supply the number asked for, the screen says how many are
// missing and offers three ways out; it never fills the gap from another topic or year.
type Draft = { round: string | null; grade: string; subject: string; topic: string; requested: number };
const EMPTY: Draft = { round: null, grade: "", subject: "", topic: "", requested: 1 };

export default function RoundBuilder({ exam, onChange }: { exam: Exam; onChange: (e: Exam) => void }) {
  const [grades, setGrades] = useState<string[]>([]), [subs, setSubs] = useState<SubjectOption[] | null>(null), [tops, setTops] = useState<TopicOption[] | null>(null);
  const [d, setD] = useState<Draft>(EMPTY), [busy, setBusy] = useState(""), [error, setError] = useState(""), [note, setNote] = useState(""), [choosing, setChoosing] = useState<string | null>(null);
  const archived = exam.status === "archived", editing = exam.rounds.find((r) => r.id === d.round);
  const room = maxForRound(exam.totals, editing?.requested ?? 0);

  useEffect(() => { eligibleGradesFor(exam.target_grade).then(setGrades).catch((e) => setError(e.message)); }, [exam.target_grade]);
  useEffect(() => { setSubs(null); if (!d.grade) return; subjects(exam.curriculum_id, d.grade).then(setSubs).catch((e) => { setError(e.message); setSubs([]); }); }, [exam.curriculum_id, d.grade]);
  useEffect(() => { setTops(null); if (!d.grade || !d.subject) return; topics(exam.curriculum_id, d.grade, d.subject, exam.id).then(setTops).catch((e) => { setError(e.message); setTops([]); }); }, [exam.curriculum_id, exam.id, d.grade, d.subject, exam.totals.selected]);
  const topic = useMemo(() => tops?.find((t) => t.topic_id === d.topic), [tops, d.topic]);

  async function run(key: string, fn: () => Promise<Exam | { exam: Exam; added?: number }>, ok?: (r: any) => string) {
    setBusy(key); setError(""); setNote("");
    try { const r = await fn(); const e = "exam" in r ? r.exam : r; onChange(e); if (ok) setNote(ok(r)); return true; } catch (x) { setError((x as Error).message); return false; } finally { setBusy(""); }
  }
  async function save() {
    const ok = await run("save", () => saveRound(exam.id, d.round, d.grade, d.subject, d.topic, d.requested), () => (d.round ? "Round saved." : "Round added."));
    if (ok) setD(EMPTY);
  }
  const edit = (r: RoundState, requested = r.requested) => { setD({ round: r.id, grade: r.grade_code, subject: r.subject_code, topic: r.topic_id, requested }); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <p className="qb-error" role="alert">{error}</p>}
      {note && <p className="qb-ok" role="status">{note}</p>}

      {!archived && <section className="qb-card qb-form" aria-label={d.round ? "Edit round" : "Add a round"}>
        <h2 style={{ margin: 0 }}>{d.round ? `Edit round ${editing?.position}` : "Add a round"}</h2>
        <p className="qb-muted qb-small" style={{ margin: 0 }}>Choose a year, then a subject, then a topic, then how many questions to take from it. {room > 0 ? `You can still allocate ${room} question${room === 1 ? "" : "s"}.` : "Every question is allocated. Edit a round to change the mix."}</p>
        <div className="qb-grid cols-2">
          <div className="qb-field"><label htmlFor="rb-grade">1. Year</label>
            <select id="rb-grade" value={d.grade} onChange={(e) => setD({ ...d, grade: e.target.value, subject: "", topic: "" })}><option value="">Choose a year</option>{grades.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}</select></div>
          <div className="qb-field"><label htmlFor="rb-subject">2. Subject</label>
            <select id="rb-subject" value={d.subject} disabled={!d.grade || subs === null} onChange={(e) => setD({ ...d, subject: e.target.value, topic: "" })}>
              <option value="">{!d.grade ? "Choose a year first" : subs === null ? "Loading…" : subs.length ? "Choose a subject" : "No subject has topics for this year"}</option>{(subs ?? []).map((s) => <option key={s.subject_code} value={s.subject_code}>{s.label} ({s.topics} topics)</option>)}</select></div>
          <div className="qb-field" style={{ gridColumn: "1 / -1" }}><label htmlFor="rb-topic">3. Topic</label>
            <select id="rb-topic" value={d.topic} disabled={!d.subject || tops === null} onChange={(e) => setD({ ...d, topic: e.target.value })}>
              <option value="">{!d.subject ? "Choose a subject first" : tops === null ? "Loading…" : tops.length ? "Choose a topic" : "No topics for this subject and year"}</option>
              {(tops ?? []).map((t) => <option key={t.topic_id} value={t.topic_id} disabled={t.in_exam && t.topic_id !== editing?.topic_id}>{t.title} · {t.available} approved{t.in_exam && t.topic_id !== editing?.topic_id ? " · already in this exam" : t.available === 0 ? " · none yet" : ""}</option>)}</select>
            {topic && <span className="qb-small qb-muted">{topic.strand ? `${topic.strand} · ` : ""}{topic.available} approved questions ({topic.easy} easy, {topic.medium} medium, {topic.hard} hard). {topic.available_to_add} can still be added to this exam.</span>}</div>
          <div className="qb-field"><label htmlFor="rb-count">4. Number of questions</label>
            <input id="rb-count" type="number" inputMode="numeric" min={1} max={Math.max(1, room)} value={d.requested} onChange={(e) => setD({ ...d, requested: Number(e.target.value) })} />
            {topic && d.requested > topic.available_to_add + (editing && editing.topic_id === d.topic ? editing.selected : 0) && <span className="qb-error qb-small" role="status">This topic has only {topic.available_to_add + (editing && editing.topic_id === d.topic ? editing.selected : 0)} different approved questions for this exam. You can add the round, but it will be short until more are approved.</span>}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="qb-btn" disabled={!!busy || !d.topic || d.requested < 1 || d.requested > room} onClick={() => void save()}>{busy === "save" ? "Saving…" : d.round ? "Save round" : "Add round"}</button>
          {d.round && <button className="qb-btn secondary" onClick={() => setD(EMPTY)}>Cancel</button>}
        </div>
      </section>}

      <section className="qb-card" aria-label="Rounds">
        <h2 style={{ margin: "0 0 8px" }}>Rounds</h2>
        {!exam.rounds.length ? <p className="qb-muted">No rounds yet. Add the first one above.</p> :
          <ol style={{ display: "grid", gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
            {exam.rounds.map((r) => { const h = roundHealth(r); return (
              <li key={r.id} className="qb-card" style={{ display: "grid", gap: 8, borderColor: h === "short" ? "var(--qb-danger)" : undefined }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>Round {r.position}: {gradeLabel(r.grade_code)} · {r.subject_label} · {r.topic_title}</strong>
                  <span className={`qb-pill ${h === "full" ? "success" : h === "short" ? "danger" : "warning"}`}>{h === "full" ? "Filled" : h === "short" ? "Short" : h === "partial" ? "Partly chosen" : "Not chosen yet"}</span>
                </div>
                <p className="qb-small qb-muted" style={{ margin: 0 }}>Asked for {r.requested} · chosen {r.selected} · {r.available} approved in the topic · {r.available_to_add} can still be added{r.strand ? ` · ${r.strand}` : ""}</p>
                <p className={h === "short" ? "qb-error" : "qb-small"} style={{ margin: 0 }} role={h === "short" ? "alert" : undefined}>{roundMessage(r)}</p>
                {h === "short" && <div className="qb-card" style={{ display: "grid", gap: 6 }}>
                  <strong>Ways to fix this round</strong>
                  <ul className="qb-list" style={{ margin: 0 }}>{recoveryOptions(r).map((o) => <li key={o}>{recoveryLabel[o]}</li>)}</ul>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="qb-btn secondary" disabled={archived} onClick={() => edit(r, Math.max(1, r.selected + r.available_to_add))}>Ask for {Math.max(1, r.selected + r.available_to_add)}</button>
                    <button className="qb-btn secondary" disabled={archived} onClick={() => edit(r)}>Change the topic or year</button>
                    <Link className="qb-btn secondary" href="/support">Ask for more questions</Link>
                  </div>
                  <span className="qb-small qb-muted">New questions only reach an exam after they are loaded and approved by QuizBox reviewers.</span>
                </div>}
                {!archived && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="qb-btn" disabled={!!busy || r.selected >= r.requested} onClick={() => void run(`pick-${r.id}`, () => pickRound(exam.id, r.id), (x) => `Added ${x.added} question${x.added === 1 ? "" : "s"} to round ${r.position}.`)}>{busy === `pick-${r.id}` ? "Choosing…" : "Choose automatically"}</button>
                  <button className="qb-btn secondary" onClick={() => setChoosing(choosing === r.id ? null : r.id)}>{choosing === r.id ? "Close the list" : "Choose by hand"}</button>
                  <button className="qb-btn secondary" disabled={!!busy || !r.selected} onClick={() => void run(`clear-${r.id}`, () => clearRound(exam.id, r.id), () => `Round ${r.position} cleared.`)}>Clear choices</button>
                  <button className="qb-btn secondary" onClick={() => edit(r)}>Edit round</button>
                  <button className="qb-link-btn" disabled={!!busy} onClick={() => { if (window.confirm(`Remove round ${r.position} and its chosen questions?`)) void run(`del-${r.id}`, () => deleteRound(exam.id, r.id), () => "Round removed."); }}>Remove</button>
                </div>}
                {choosing === r.id && !archived && <Chooser exam={exam} round={r} onSaved={(e) => { onChange(e); setChoosing(null); setNote(`Round ${r.position} saved.`); }} />}
              </li>); })}
          </ol>}
      </section>
    </div>
  );
}

// Choosing by hand: the approved questions of this round's topic. A question that is already in the exam (or is a copy of one) cannot be ticked.
function Chooser({ exam, round, onSaved }: { exam: Exam; round: RoundState; onSaved: (e: Exam) => void }) {
  const [list, setList] = useState<Candidate[] | null>(null), [ticked, setTicked] = useState<Set<string>>(new Set()), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { candidates(exam.id, round.id).then((c) => { setList(c); setTicked(new Set(c.filter((x) => x.in_round).map((x) => x.id))); }).catch((e) => { setError(e.message); setList([]); }); }, [exam.id, round.id]);
  const flip = (id: string, on: boolean) => setTicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  async function save() { setBusy(true); setError(""); try { onSaved(await setRoundQuestions(exam.id, round.id, [...ticked])); } catch (e) { setError((e as Error).message); setBusy(false); } }
  return (
    <div className="qb-card" style={{ display: "grid", gap: 8 }}>
      <strong>Choose up to {round.requested} for round {round.position} ({ticked.size} ticked)</strong>
      {error && <p className="qb-error" role="alert">{error}</p>}
      {list === null ? <p className="qb-muted">Loading…</p> : !list.length ? <p className="qb-muted">No approved questions are available in this topic yet.</p> :
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th scope="col">Use</th><th scope="col">Question</th><th scope="col">Type</th><th scope="col">Level</th></tr></thead><tbody>
          {list.map((c) => { const on = ticked.has(c.id), full = !on && ticked.size >= round.requested; return <tr key={c.id}>
            <td><input type="checkbox" aria-label={`Use: ${c.question_text.slice(0, 60)}`} checked={on} disabled={c.blocked || full} onChange={(e) => flip(c.id, e.target.checked)} /></td>
            <td>{c.question_text}{c.blocked && <div className="qb-small qb-error">Already in this exam, or a copy of a question that is.</div>}</td><td className="qb-small">{c.answer_type.replaceAll("_", " ").toLowerCase()}</td><td className="qb-small">{c.level || "-"}</td></tr>; })}
        </tbody></table></div>}
      <div><button className="qb-btn" disabled={busy || !list} onClick={() => void save()}>{busy ? "Saving…" : "Save these questions"}</button></div>
    </div>
  );
}
