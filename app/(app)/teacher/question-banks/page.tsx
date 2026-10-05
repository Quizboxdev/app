"use client";

import { useEffect, useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import CurriculumBrowser, { curriculumScopeFilters, type CurriculumBrowserNode } from "@/components/CurriculumBrowser";
import { humanize, shortenIds } from "@/lib/format";
import { listCurricula } from "@/lib/api/curriculum";
import { listQuestions } from "@/lib/api/teacher";

const TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "NUMERIC", "FRACTION", "SHORT_TEXT", "EXPRESSION"];

export default function TeacherQuestionBanksPage() {
  const [result, setResult] = useState({ rows: [] as any[], count: 0, page: 1, pageSize: 25 });
  const [curricula, setCurricula] = useState<any[]>([]);
  const [curriculumId, setCurriculumId] = useState("");
  const [path, setPath] = useState<CurriculumBrowserNode[]>([]);
  const [filters, setFilters] = useState({ search: "", status: "", difficulty: "", answerType: "" });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { listCurricula().then((rows) => { setCurricula(rows); setCurriculumId(rows[0]?.id ?? ""); }).catch((reason) => setError(reason.message)); }, []);
  const scope = useMemo(() => curriculumScopeFilters(path), [path]);
  const scopeKey = JSON.stringify(scope);
  useEffect(() => { setPage(1); }, [scopeKey, filters]);
  useEffect(() => {
    let active = true; setLoading(true);
    listQuestions({ ...scope, ...filters, page, pageSize: 25 })
      .then((next) => { if (active) { setResult(next); setError(""); } })
      .catch((reason) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [scopeKey, filters, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const pages = Math.max(1, Math.ceil(result.count / result.pageSize));
  const set = (key: keyof typeof filters) => (event: { target: { value: string } }) => setFilters({ ...filters, [key]: event.target.value });

  return <>
    <div className="qb-page-head"><div><h1>Question Bank</h1><p>Browse the approved curriculum repository by grade, subject, strand and indicator.</p></div><span className="qb-pill">{result.count} questions</span></div>

    <section className="qb-card" aria-labelledby="qb-scope">
      <div className="qb-page-head"><h2 id="qb-scope">Curriculum scope</h2>
        {curricula.length > 1 && <label className="qb-field"><span className="qb-sr-only">Curriculum</span><select value={curriculumId} onChange={(event) => setCurriculumId(event.target.value)}>{curricula.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>
      {curriculumId ? <CurriculumBrowser curriculumId={curriculumId} onPathChange={setPath} rootLabel="All grades and subjects"
        renderLeaf={(leaf) => <p className="qb-muted">Showing questions for <strong>{leaf.title}</strong>. Use the path above to widen the scope.</p>} />
        : <div className="qb-empty"><strong>No curriculum available</strong>Your curriculum has not been published for your market yet.</div>}
    </section>

    <section className="qb-card qb-form" style={{ marginTop: 16 }} aria-label="Question filters">
      <div className="qb-grid cols-2">
        <div className="qb-field"><label htmlFor="qbank-search">Search</label><input id="qbank-search" value={filters.search} onChange={set("search")} placeholder="Question text" /></div>
        <div className="qb-field"><label htmlFor="qbank-type">Question type</label><select id="qbank-type" value={filters.answerType} onChange={set("answerType")}><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></div>
        <div className="qb-field"><label htmlFor="qbank-status">Status</label><select id="qbank-status" value={filters.status} onChange={set("status")}><option value="">All statuses</option><option value="APPROVED">Approved</option><option value="DRAFT">Draft</option><option value="REVIEW">Review</option><option value="REJECTED">Rejected</option></select></div>
        <div className="qb-field"><label htmlFor="qbank-difficulty">Difficulty</label><select id="qbank-difficulty" value={filters.difficulty} onChange={set("difficulty")}><option value="">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
      </div>
    </section>

    {error && <div className="qb-card qb-error" role="alert" style={{ marginTop: 16 }}>{error}</div>}
    <div className="qb-card qb-table-wrap" style={{ marginTop: 16 }} aria-busy={loading}>
      <table className="qb-table"><thead><tr><th>Question</th><th>Curriculum</th><th>Difficulty</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>{result.rows.map((row) => <tr key={row.id}>
          <td><strong>{row.question_text}</strong><br /><span className="qb-muted">{shortenIds(row.question_code ?? row.id)}</span></td>
          <td>{row.grade} · {row.subject_code}<br /><span className="qb-muted">{[row.strand_name, row.substrand_name, row.indicator_code ?? row.content_standard_code].filter(Boolean).join(" › ")}</span></td>
          <td>{row.difficulty_label ? humanize(row.difficulty_label) : "Not set"}</td><td>{row.answer_type ? humanize(row.answer_type) : "Not set"}</td><td><StatusBadge status={row.status} /></td>
        </tr>)}</tbody></table>
      {!result.rows.length && !loading && !error && <div className="qb-empty"><strong>No questions match</strong>Widen the curriculum scope or clear a filter.</div>}
    </div>
    <div className="qb-actions" style={{ marginTop: 12 }}>
      <button className="qb-btn secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</button>
      <span className="qb-muted qb-small">Page {page} of {pages}</span>
      <button className="qb-btn secondary" disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  </>;
}
