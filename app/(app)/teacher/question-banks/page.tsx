"use client";

import { FormEvent, useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { shortenIds } from "@/lib/format";
import { listQuestions } from "@/lib/api/teacher";

export default function TeacherQuestionBanksPage() {
  const [result, setResult] = useState({ rows: [] as any[], count: 0, page: 1, pageSize: 25 });
  const [filters, setFilters] = useState({ search: "", grade: "", subject: "", status: "", difficulty: "" });
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  async function load(nextPage = page) { try { setError(""); setResult(await listQuestions({ ...filters, page: nextPage, pageSize: 25 })); } catch (reason: any) { setError(reason.message); } }
  useEffect(() => { listQuestions({ page: 1, pageSize: 25 }).then(setResult).catch((reason) => setError(reason.message)); }, []);
  function submit(event: FormEvent) { event.preventDefault(); setPage(1); load(1); }
  const pages = Math.max(1, Math.ceil(result.count / result.pageSize));

  return <>
    <div className="qb-page-head"><div><h1>Question Bank</h1><p>Search the approved multi-subject curriculum repository.</p></div><span className="qb-pill">{result.count} questions</span></div>
    <form className="qb-card qb-form" onSubmit={submit}><div className="qb-grid cols-2">
      <div className="qb-field"><label htmlFor="qbank-search">Search</label><input id="qbank-search" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Question text" /></div>
      <div className="qb-field"><label htmlFor="qbank-grade">Grade / form</label><input id="qbank-grade" value={filters.grade} onChange={(event) => setFilters({ ...filters, grade: event.target.value.toUpperCase() })} placeholder="B7 or SHS1" /></div>
      <div className="qb-field"><label htmlFor="qbank-subject">Subject code</label><input id="qbank-subject" value={filters.subject} onChange={(event) => setFilters({ ...filters, subject: event.target.value.toUpperCase() })} placeholder="COMPUTING" /></div>
      <div className="qb-field"><label htmlFor="qbank-status">Status</label><select id="qbank-status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option><option value="APPROVED">Approved</option><option value="DRAFT">Draft</option><option value="REVIEW">Review</option><option value="REJECTED">Rejected</option></select></div>
      <div className="qb-field"><label htmlFor="qbank-difficulty">Difficulty</label><select id="qbank-difficulty" value={filters.difficulty} onChange={(event) => setFilters({ ...filters, difficulty: event.target.value })}><option value="">All difficulties</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
    </div><button className="qb-btn" type="submit">Apply filters</button></form>
    {error && <div className="qb-card qb-error">{error}</div>}
    <div className="qb-card qb-table-wrap"><table className="qb-table"><thead><tr><th>Question</th><th>Curriculum</th><th>Difficulty</th><th>Type</th><th>Status</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.id}><td><strong>{row.question_text}</strong><br /><span className="qb-muted">{shortenIds(row.question_code ?? row.id)}</span></td><td>{row.grade} · {row.subject_code}<br /><span className="qb-muted">{row.indicator_code ?? row.content_standard_code ?? row.substrand_name}</span></td><td>{row.difficulty_label ?? "Not set"}</td><td>{row.answer_type ?? "Not set"}</td><td><StatusBadge status={row.status} /></td></tr>)}</tbody></table>{!result.rows.length && !error && <div className="qb-muted">No questions match these filters.</div>}</div>
    <div className="qb-actions"><button className="qb-btn qb-btn-secondary" disabled={page <= 1} onClick={() => { const next = page - 1; setPage(next); load(next); }}>Previous</button><span>Page {page} of {pages}</span><button className="qb-btn qb-btn-secondary" disabled={page >= pages} onClick={() => { const next = page + 1; setPage(next); load(next); }}>Next</button></div>
  </>;
}
