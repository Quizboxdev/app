"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadResults, examAssignments, resultRows, results, type ExamAssignment, type ResultRow, type Results } from "@/lib/api/mock-exams";
import { formatDateTime } from "@/lib/format";
import { gradeLabel } from "@/lib/mock-exams/grades";
import { EMPTY_FILTER, bandLabel, bandOf, filterParticipants, groupsOf, hardestFirst, isFiltered, percentLabel, stateLabel, type ParticipantFilter } from "@/lib/mock-exams/results-view";

// What the exam's owner sees: participation, completion, scores, the questions learners found hardest, and every learner's answer to every question. Only attempts the owner may see are returned by the database:
// their own classes' learners by name, and marketplace buyers as "Buyer 1, 2 ..." with no identity. Exports are the same rows, up to the stated limit.
const PAGE = 100;

export default function ResultsPanel({ examId, hasVersion }: { examId: string; hasVersion: boolean }) {
  const [version, setVersion] = useState<string | null>(null), [data, setData] = useState<Results | null>(null), [error, setError] = useState(""), [classes, setClasses] = useState<ExamAssignment[]>([]);
  const [pf, setPf] = useState<ParticipantFilter>(EMPTY_FILTER);
  const load = useCallback(() => { setError(""); results(examId, version).then(setData).catch((e) => { setError(e.message); setData(null); }); }, [examId, version]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { examAssignments(examId).then(setClasses).catch(() => setClasses([])); }, [examId]);

  if (!hasVersion) return <div className="qb-card"><h2>Results</h2><p className="qb-muted">Publish the exam and give it to a class or sell it. Results appear here once learners start.</p></div>;
  if (error) return <div className="qb-card qb-error" role="alert"><strong>You cannot see these results.</strong> {error} <button className="qb-link-btn" onClick={load}>Try again</button></div>;
  if (!data) return <div className="qb-card qb-muted" role="status">Loading results…</div>;
  if (!data.summary || !data.version) return <div className="qb-card"><h2>Results</h2><p className="qb-muted">No version is published yet.</p></div>;

  const s = data.summary, participants = filterParticipants(data.participants, pf), groups = groupsOf(data.participants);
  const stat = (label: string, value: string | number | null, hint?: string) => <div key={label}><dt>{label}</dt><dd>{value ?? "-"}</dd>{hint && <span className="qb-small qb-muted">{hint}</span>}</div>;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="qb-card" aria-label="Summary">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Results: version {data.version.version_no}</h2>
          {data.versions.length > 1 && <div className="qb-field" style={{ minWidth: 180 }}><label htmlFor="rs-version">Version</label><select id="rs-version" value={version ?? data.version.id} onChange={(e) => setVersion(e.target.value)}>{data.versions.map((v) => <option key={v.id} value={v.id}>Version {v.version_no}</option>)}</select></div>}
        </div>
        <dl className="qb-stat-list">
          {stat("Assigned", s.assigned)}{stat("Started", s.started)}{stat("Finished", s.finished)}{stat("In progress", s.in_progress)}{stat("Not started", s.not_started)}
          {stat("Completion", s.completion_percent === null ? "-" : `${s.completion_percent}%`)}{stat("Average", percentLabel(s.average_percent), `${s.scored} scored`)}{stat("Median", percentLabel(s.median_percent))}
          {stat("Highest", percentLabel(s.highest_percent))}{stat("Lowest", percentLabel(s.lowest_percent))}
        </dl>
        <p className="qb-small qb-muted" style={{ margin: "8px 0 0" }}>Scores use each learner’s latest finished attempt. A finished attempt is one that was submitted or ran out of time.</p>
      </section>

      <section className="qb-card" aria-label="Participants">
        <h3 style={{ margin: "0 0 8px" }}>Who took it ({participants.length}{isFiltered(pf) ? ` of ${data.participants.length}` : ""})</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }} role="search" aria-label="Filter participants">
          <input className="qb-input" type="search" aria-label="Search by name" placeholder="Search by name" value={pf.query} onChange={(e) => setPf({ ...pf, query: e.target.value })} />
          <select className="qb-input" aria-label="State" value={pf.state} onChange={(e) => setPf({ ...pf, state: e.target.value })}><option value="">Any state</option>{["submitted", "expired", "in_progress", "not_started"].map((x) => <option key={x} value={x}>{stateLabel(x)}</option>)}</select>
          {groups.length > 1 && <select className="qb-input" aria-label="Class or group" value={pf.group} onChange={(e) => setPf({ ...pf, group: e.target.value })}><option value="">All classes and groups</option>{groups.map((g) => <option key={g}>{g}</option>)}</select>}
          {isFiltered(pf) && <button className="qb-link-btn" onClick={() => setPf(EMPTY_FILTER)}>Clear</button>}
        </div>
        {!data.participants.length ? <p className="qb-muted">No one has started yet. Learners in an assigned class, and buyers, appear here once they begin.</p> : !participants.length ? <p className="qb-muted">Nobody matches those filters.</p> :
          <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th scope="col">Learner</th><th scope="col">Class or group</th><th scope="col">Attempt</th><th scope="col">State</th><th scope="col">Score</th><th scope="col">Submitted</th></tr></thead><tbody>
            {participants.map((p, i) => <tr key={`${p.attempt_id ?? p.participant_key}-${i}`}><td>{p.participant}</td><td>{p.group}</td><td>{p.attempt_no || "-"}</td><td>{stateLabel(p.state)}</td>
              <td>{p.score === null ? "-" : `${p.score}/${p.total_marks} (${percentLabel(p.percent)})`}</td><td className="qb-small">{p.submitted_at ? formatDateTime(p.submitted_at) : "-"}</td></tr>)}</tbody></table></div>}
      </section>

      <QuestionStats data={data} />
      <ReviewGrid examId={examId} versionId={data.version.id} data={data} classes={classes} />
    </div>
  );
}

function QuestionStats({ data }: { data: Results }) {
  const [hardFirst, setHardFirst] = useState(true);
  const qs = hardFirst ? hardestFirst(data.questions) : data.questions;
  return (
    <section className="qb-card" aria-label="Question results">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><h3 style={{ margin: 0 }}>Question by question</h3><label className="qb-check"><input type="checkbox" checked={hardFirst} onChange={(e) => setHardFirst(e.target.checked)} /> Hardest first</label></div>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th scope="col">No.</th><th scope="col">Question</th><th scope="col">Year</th><th scope="col">Answered</th><th scope="col">Correct</th><th scope="col">How it went</th></tr></thead><tbody>
        {qs.map((q) => <tr key={q.question_id}><td>{q.position}</td><td>{q.question_text}<div className="qb-small qb-muted">{q.external_id ?? q.question_id.slice(0, 8)} · {q.subject_code}</div></td><td>{gradeLabel(q.grade_code)}</td><td>{q.answered}</td>
          <td>{q.correct_percent === null ? "-" : `${q.correct} (${q.correct_percent}%)`}</td><td className="qb-small">{bandLabel[bandOf(q.correct_percent)]}</td></tr>)}</tbody></table></div>
    </section>
  );
}

function ReviewGrid({ examId, versionId, data, classes }: { examId: string; versionId: string; data: Results; classes: ExamAssignment[] }) {
  const [student, setStudent] = useState(""), [question, setQuestion] = useState(""), [state, setState] = useState(""), [cls, setCls] = useState(""), [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ total: number; rows: ResultRow[] } | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(""), [note, setNote] = useState("");
  const filter = useMemo(() => ({ versionId, classId: cls || null, studentId: student || null, questionId: question || null, state: state || null }), [versionId, cls, student, question, state]);
  const people = useMemo(() => { const m = new Map<string, string>(); for (const p of data.participants) m.set(p.participant_key, p.participant); return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1])); }, [data.participants]);
  useEffect(() => { setOffset(0); }, [filter]);
  useEffect(() => { setPage(null); setError(""); resultRows(examId, filter, PAGE, offset).then(setPage).catch((e) => { setError(e.message); setPage({ total: 0, rows: [] }); }); }, [examId, filter, offset]);

  async function download(format: "csv" | "xlsx") {
    setBusy(format); setError(""); setNote("");
    try { const r = await downloadResults({ examId, ...filter }, format); setNote(r.rows < r.total ? `The file holds the first ${r.rows.toLocaleString("en-GB")} of ${r.total.toLocaleString("en-GB")} rows. Narrow the filters and export again for the rest.` : `Downloaded ${r.rows.toLocaleString("en-GB")} rows.`); } catch (e) { setError((e as Error).message); }
    setBusy("");
  }
  const total = page?.total ?? 0;
  return (
    <section className="qb-card" aria-label="Student by question review">
      <h3 style={{ margin: "0 0 8px" }}>Each learner’s answers</h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }} role="search" aria-label="Filter answers">
        <select className="qb-input" aria-label="Learner" value={student} onChange={(e) => setStudent(e.target.value)}><option value="">All learners</option>{people.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        <select className="qb-input" aria-label="Question" value={question} onChange={(e) => setQuestion(e.target.value)}><option value="">All questions</option>{data.questions.map((q) => <option key={q.question_id} value={q.question_id}>{q.position}. {q.question_text.slice(0, 50)}</option>)}</select>
        <select className="qb-input" aria-label="Attempt state" value={state} onChange={(e) => setState(e.target.value)}><option value="">Any finished or running attempt</option><option value="submitted">Submitted</option><option value="expired">Time ran out</option><option value="in_progress">In progress</option></select>
        {classes.length > 1 && <select className="qb-input" aria-label="Class" value={cls} onChange={(e) => setCls(e.target.value)}><option value="">All classes</option>{[...new Map(classes.map((c) => [c.class_id, c.class_name])).entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <button className="qb-btn" disabled={!!busy || !total} onClick={() => void download("csv")}>{busy === "csv" ? "Preparing…" : "Download CSV"}</button>
        <button className="qb-btn secondary" disabled={!!busy || !total} onClick={() => void download("xlsx")}>{busy === "xlsx" ? "Preparing…" : "Download Excel"}</button>
        <span className="qb-small qb-muted">The file uses the filters above. It holds up to 50,000 rows and contains learners’ names: keep it safe and delete it when you no longer need it. Marketplace buyers appear as Buyer 1, 2 … with no identity.</span>
      </div>
      {error && <p className="qb-error" role="alert">{error}</p>}{note && <p className="qb-ok" role="status">{note}</p>}
      {page === null ? <p className="qb-muted" role="status">Loading…</p> : !page.rows.length ? <p className="qb-muted">{data.participants.some((p) => p.attempt_id) ? "No answers match those filters." : "There are no answers yet."}</p> :
        <>
          <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th scope="col">Learner</th><th scope="col">No.</th><th scope="col">Question</th><th scope="col">Their answer</th><th scope="col">Correct answer</th><th scope="col">Result</th><th scope="col">Marks</th></tr></thead><tbody>
            {page.rows.map((r) => <tr key={`${r.attempt_id}-${r.position}`}><td>{r.participant}{r.attempt_no > 1 ? <span className="qb-small qb-muted"> (attempt {r.attempt_no})</span> : null}</td><td>{r.position}</td><td>{r.question_text}</td>
              <td>{r.answered ? r.answer : <span className="qb-muted">No answer</span>}</td><td>{r.correct_answer}</td>
              <td>{!r.answered ? "Not answered" : r.is_correct ? <span className="qb-ok">Correct</span> : <span className="qb-error">Wrong</span>}</td><td>{r.marks_awarded}/{r.marks}</td></tr>)}</tbody></table></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <button className="qb-btn secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
            <span className="qb-small" role="status">{offset + 1} to {Math.min(offset + PAGE, total)} of {total.toLocaleString("en-GB")}</span>
            <button className="qb-btn secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
          </div>
        </>}
    </section>
  );
}
