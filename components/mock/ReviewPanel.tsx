"use client";

import { useCallback, useEffect, useState } from "react";
import { archiveExam, examHealth, publishExam, reviewExam, type Exam, type Review } from "@/lib/api/mock-exams";
import { formatDate } from "@/lib/format";
import { gradeLabel } from "@/lib/mock-exams/grades";
import { purposeLabel } from "@/lib/mock-exams/purposes";
import { issueText } from "@/lib/mock-exams/tally";

// The assembled exam as a learner will meet it: rounds, every question, answer types and scoring. Publishing freezes a numbered version; later edits become the next version and never change attempts already made.
export default function ReviewPanel({ exam, onChange }: { exam: Exam; onChange: (e: Exam) => void }) {
  const [r, setR] = useState<Review | null>(null), [stale, setStale] = useState(0), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState("");
  const load = useCallback(() => { setError(""); reviewExam(exam.id).then(setR).catch((e) => setError(e.message)); examHealth(exam.id).then((h) => setStale(h.stale_questions)).catch(() => undefined); }, [exam.id]);
  useEffect(() => { load(); }, [load, exam.totals.selected, exam.updated_at]);

  async function publish() {
    if (!window.confirm(`Publish this exam as version ${exam.version_count + 1}? Once published, that version never changes. You can still edit the exam and publish the next version.`)) return;
    setBusy(true); setError(""); setDone("");
    try { const p = await publishExam(exam.id); onChange(p.exam); setDone(`Version ${p.version_no} is published (${p.question_count} questions). You can now assign it to a class${exam.owner_kind === "teacher" ? " or sell it" : ""}.`); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  async function archive() {
    if (!window.confirm("Archive this exam? It cannot be assigned or sold again. Classes and buyers who already have it keep working until their access ends.")) return;
    setBusy(true); setError("");
    try { onChange(await archiveExam(exam.id)); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  if (!r) return error ? <p className="qb-error" role="alert">{error}</p> : <div className="qb-card qb-muted" role="status">Loading…</div>;
  const ready = r.readiness.ready, archived = exam.status === "archived", nothingNew = exam.version_count > 0 && !exam.dirty;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {error && <p className="qb-error" role="alert">{error}</p>}
      {done && <p className="qb-ok" role="status">{done}</p>}
      {stale > 0 && <div className="qb-card qb-error" role="alert"><strong>{stale} question{stale === 1 ? "" : "s"} changed or {stale === 1 ? "was" : "were"} withdrawn since version {exam.current_version_no} was published.</strong> That version can no longer be given to a class or sold. Choose those questions again and publish the next version.</div>}

      <section className="qb-card" aria-label="Readiness">
        <h2 style={{ margin: "0 0 8px" }}>{exam.title}</h2>
        <p className="qb-muted" style={{ margin: "0 0 8px" }}>{purposeLabel(exam.purpose)} · target {gradeLabel(exam.target_grade)}{exam.audience ? ` · ${exam.audience}` : ""}</p>
        {ready ? <p className="qb-ok" role="status">Ready to publish: {r.readiness.totals.selected} of {r.readiness.totals.desired} questions chosen.</p> :
          <div role="status"><strong>Not ready yet</strong><ul className="qb-list">{r.readiness.issues.map((i, n) => <li key={n}>{issueText(i)}</li>)}</ul></div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button className="qb-btn" disabled={!ready || busy || archived || nothingNew} onClick={() => void publish()}>{busy ? "Working…" : exam.version_count ? `Publish version ${exam.version_count + 1}` : "Publish this exam"}</button>
          {nothingNew && !archived && <span className="qb-small qb-muted" style={{ alignSelf: "center" }}>Nothing has changed since version {exam.current_version_no}.</span>}
          {!archived && <button className="qb-btn secondary" disabled={busy} onClick={() => void archive()}>Archive</button>}
          {archived && <span className="qb-pill neutral">Archived</span>}
        </div>
        {exam.dirty && exam.version_count > 0 && <p className="qb-small qb-muted">You have changes that are not published. Learners and buyers still see version {exam.current_version_no}.</p>}
      </section>

      <section className="qb-card" aria-label="Scoring and rules">
        <h3 style={{ margin: "0 0 8px" }}>Scoring and rules</h3>
        <dl className="qb-stat-list">
          <div><dt>Questions</dt><dd>{r.questions.length}</dd></div><div><dt>Total marks</dt><dd>{r.scoring.total_marks}</dd></div><div><dt>Time allowed</dt><dd>{r.scoring.time_limit_minutes} min</dd></div>
          <div><dt>Attempts</dt><dd>{r.scoring.attempts_allowed}</dd></div><div><dt>Question order</dt><dd>{r.scoring.shuffle_questions ? "Shuffled for buyers" : "Fixed"}</dd></div>
        </dl>
        <p className="qb-small" style={{ margin: "8px 0 0" }}><strong>Answer types:</strong> {Object.entries(r.scoring.answer_types).map(([k, n]) => `${n} ${k.replaceAll("_", " ").toLowerCase()}`).join(", ") || "none yet"}. Every answer is marked by the system from the question’s stored answer.
          The pass mark is QuizBox’s standard (40%) and is not set per exam.</p>
      </section>

      <section className="qb-card" aria-label="Rounds summary">
        <h3 style={{ margin: "0 0 8px" }}>Rounds</h3>
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th scope="col">Round</th><th scope="col">Year</th><th scope="col">Subject</th><th scope="col">Topic</th><th scope="col">Asked</th><th scope="col">Chosen</th></tr></thead><tbody>
          {exam.rounds.map((x) => <tr key={x.id}><td>{x.position}</td><td>{gradeLabel(x.grade_code)}</td><td>{x.subject_label}</td><td>{x.topic_title}</td><td>{x.requested}</td><td>{x.selected}</td></tr>)}
          {!exam.rounds.length && <tr><td colSpan={6} className="qb-muted">No rounds yet.</td></tr>}</tbody></table></div>
      </section>

      <section className="qb-card" aria-label="Questions">
        <h3 style={{ margin: "0 0 8px" }}>Questions ({r.questions.length})</h3>
        {!r.questions.length ? <p className="qb-muted">No questions chosen yet.</p> :
          <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th scope="col">No.</th><th scope="col">Round</th><th scope="col">Question</th><th scope="col">Type</th><th scope="col">Marks</th><th scope="col">Chosen</th></tr></thead><tbody>
            {r.questions.map((q) => <tr key={q.question_id}><td>{q.position}</td><td>{q.round}</td><td>{q.question_text}{!q.available && <div className="qb-small qb-error">No longer approved or available.</div>}</td>
              <td className="qb-small">{q.answer_type.replaceAll("_", " ").toLowerCase()}</td><td>{q.marks}</td><td className="qb-small">{q.picked_by === "manual" ? "By hand" : "Automatically"}</td></tr>)}</tbody></table></div>}
      </section>

      {!!exam.versions?.length && <section className="qb-card" aria-label="Versions"><h3 style={{ margin: "0 0 8px" }}>Published versions</h3>
        <ul className="qb-list">{exam.versions.map((v) => <li key={v.id}>Version {v.version_no} · {v.question_count} questions · {v.total_marks} marks · published {formatDate(v.published_at)}</li>)}</ul></section>}
    </div>
  );
}
