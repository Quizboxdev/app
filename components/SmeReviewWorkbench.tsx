"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, X, UserPlus } from "lucide-react";
import { assignSmeReview, completeSmeReview, getSmeContext, getSmeReviewDetail, listSmeRecords, publishSmeQuestion, RecordRow, SmeContext } from "@/lib/api/sme";
import { userFacingError } from "@/lib/errors";
import QuestionRenderer from "@/components/QuestionRenderer";
import StatusBadge from "@/components/StatusBadge";
import { listAuthorizedMarkets, type MarketOption } from "@/lib/api/content-context";
import { formatDateTime, humanize, shortId } from "@/lib/format";

export default function SmeReviewWorkbench({ questionId }: { questionId?: string }) {
  const [context, setContext] = useState<SmeContext | null>(null), [rows, setRows] = useState<RecordRow[]>([]);
  const [domains, setDomains] = useState<RecordRow[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ reviewer_id: "", market_id: "", subject_code: "" });
  const [applied, setApplied] = useState(filters);
  const [detail, setDetail] = useState<RecordRow | null>(null), [note, setNote] = useState(""), [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const permitted = context && (context.reviewer || context.content_admin || context.super_admin);
  const load = useCallback(async () => {
    if (!permitted) return;
    try {
      const [work, assignments] = await Promise.all([listSmeRecords("sme_review_queue", applied, page), listSmeRecords("sme_domain_assignments")]);
      setRows(work.rows); setTotal(work.total); setDomains(assignments.rows);
    } catch (cause) { setError(userFacingError(cause)); }
  }, [permitted, applied, page]);
  const [markets, setMarkets] = useState<MarketOption[]>([]);
  useEffect(() => { getSmeContext().then(setContext).catch(() => {}); listAuthorizedMarkets().then(setMarkets).catch(() => {}); }, []);
  useEffect(() => { void load(); }, [load]);
  const perform = async (operation: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError("");
    try { await operation(); await load(); } catch (cause) { setError(userFacingError(cause)); } finally { setBusy(false); }
  };
  const assign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const domain = domains.find(row => row.id === data.get("domain"));
    if (!domain) return;
    void perform(async () => { await assignSmeReview({ question: questionId || String(data.get("question")), reviewer: domain.reviewer_id, domain: domain.id, kind: String(data.get("kind")), sponsor: String(data.get("sponsor") ?? ""), prior: String(data.get("prior") ?? "") }); setNotice("Review assigned."); });
  };
  const open = (id: string) => void perform(async () => { setDetail(await getSmeReviewDetail(id)); setNote(""); setAttested(false); });
  const act = (decision: string) => void perform(async () => {
    if (!detail) return;
    await completeSmeReview(detail.assignment.id, decision, note, attested, detail.question.version);
    setNotice("Review recorded. Publication remains separate."); setDetail(null);
  });
  if (!permitted) return null;
  const visible = rows;
  const question = detail?.question;
  const marketName = (id: unknown) => (id ? markets.find(market => market.id === id)?.name ?? shortId(id) : "All markets");
  const reviewerIds = Array.from(new Set(domains.map(domain => String(domain.reviewer_id))));
  const subjects = Array.from(new Set(domains.map(domain => String(domain.subject_code)))).sort();
  const domainLabel = (domain: RecordRow) => `${domain.subject_code} · ${marketName(domain.market_id)} · reviewer ${shortId(domain.reviewer_id)}`;
  return <section className="qb-card qb-content-ops" aria-labelledby="sme-reviews-heading">
    <div className="qb-page-head"><div><h2 id="sme-reviews-heading">Assigned reviews</h2><p>{total} assignment{total === 1 ? "" : "s"}</p></div><button disabled={busy} title="Refresh assigned reviews" aria-label="Refresh assigned reviews" onClick={() => void load()}><RefreshCw size={16}/></button></div>
    {error && <p role="alert" className="qb-error">{error}</p>}{notice && <p role="status" className="qb-success">{notice}</p>}
    <form className="qb-content-filters" onSubmit={event => { event.preventDefault(); setPage(1); setApplied(filters); }}>
      <label>Reviewer<select value={filters.reviewer_id} disabled={busy} onChange={event => setFilters({ ...filters, reviewer_id: event.target.value })}><option value="">All reviewers</option>{reviewerIds.map(id => <option key={id} value={id}>Reviewer {shortId(id)}</option>)}</select></label>
      <label>Market<select value={filters.market_id} disabled={busy} onChange={event => setFilters({ ...filters, market_id: event.target.value })}><option value="">All markets</option>{markets.map(market => <option key={market.id} value={market.id}>{market.name}</option>)}</select></label>
      <label>Subject<select value={filters.subject_code} disabled={busy} onChange={event => setFilters({ ...filters, subject_code: event.target.value })}><option value="">All subjects</option>{subjects.map(code => <option key={code} value={code}>{code}</option>)}</select></label>
      <button disabled={busy} type="submit">Apply filters</button>
    </form>
    <div className="qb-table-wrap"><table className="qb-table"><thead><tr>{["Question", "Reviewer", "Subject", "Level", "Market", "Assigned", "Status", ""].map((label, i) => <th key={i}>{label || <span className="qb-sr-only">Actions</span>}</th>)}</tr></thead><tbody>{visible.map(row => <tr key={row.id}>
      <td><span className="qb-mono" title={row.question_id ?? ""}>{shortId(row.question_id)}</span></td>
      <td><span className="qb-mono" title={row.reviewer_id ?? ""}>{shortId(row.reviewer_id)}</span></td>
      <td>{domains.find(d => d.id === row.domain_assignment_id)?.subject_code ?? row.subject_code ?? "—"}</td>
      <td>{humanize(row.review_kind)}</td>
      <td>{marketName(row.market_id)}</td>
      <td>{formatDateTime(row.assigned_at)}</td>
      <td>{row.review_completed_at ? <span title={formatDateTime(row.review_completed_at)}><StatusBadge status="completed" label="Completed"/></span> : <StatusBadge status="pending" label="Pending"/>}</td>
      <td><button disabled={busy} onClick={() => open(row.id)}>Open</button></td></tr>)}</tbody></table>
      {!visible.length && <div className="qb-empty"><strong>No assigned reviews</strong>New assignments appear here when the scheduler or an administrator assigns work.</div>}</div>
    <div className="qb-page-head qb-pager"><span className="qb-muted qb-small">Page {page} of {Math.max(1, Math.ceil(total / 50))}</span><div className="qb-actions"><button title="Previous" aria-label="Previous assignments" disabled={busy || page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16}/></button><button title="Next" aria-label="Next assignments" disabled={busy || page * 50 >= total} onClick={() => setPage(page + 1)}><ChevronRight size={16}/></button></div></div>
    {(context?.content_admin || context?.super_admin) && <details className="qb-disclosure"><summary>Assign a review manually</summary><form className="qb-content-filters" onSubmit={assign}>
      {!questionId && <label>Question ID<input name="question" required placeholder="Full question ID"/></label>}
      <label>Reviewer domain<select name="domain" required disabled={busy}><option value="">Select a domain</option>{domains.filter(domain => domain.active).map(domain => <option key={domain.id} value={domain.id}>{domainLabel(domain)}</option>)}</select></label>
      <label>Review level<select name="kind"><option value="primary">Primary</option><option value="senior">Senior QA</option></select></label><label>Prior review event (senior QA only)<input name="prior" placeholder="Optional"/></label><label>Sponsor ID<input name="sponsor" placeholder="Optional"/></label>
      <button type="submit" disabled={busy}><UserPlus size={16}/>Assign review</button>
    </form></details>}
    {question && <div className="qb-content-review"><div className="qb-page-head"><h3>Assigned question</h3><button title="Close question" aria-label="Close question" onClick={() => setDetail(null)}><X size={18}/></button></div>
      <QuestionRenderer question={{ ...question, question_id: question.id }}/><ol type="A">{[question.option_a, question.option_b, question.option_c, question.option_d].map((option, i) => <li key={i}>{option || "-"}</li>)}</ol>
      <p><strong>Answer:</strong> {question.correct_answer}</p><p><strong>Explanation:</strong> {question.explanation}</p>
      {question.answer_spec && <p><strong>Answer specification:</strong> {JSON.stringify(question.answer_spec)}</p>}
      <p>{question.subject_code} / {question.source_grade_code ?? question.grade} / {question.canonical_grade_code ?? question.grade} / {question.indicator_code}</p>
      <p>{question.indicator_text} / {question.difficulty_label} / {question.source_type} / {question.source_version}</p>
      <ul>{(detail?.validation_errors ?? []).map((code: string) => <li key={code}>{code}</li>)}</ul>
      <ul>{(question.editorial_metadata?.warnings ?? []).map((code: string) => <li key={code}>{code}</li>)}</ul>
      {question.duplicate_group_id && <p>Duplicate group: {question.duplicate_group_id}</p>}
      <ul>{(question.tags ?? []).filter((tag: string) => tag.startsWith("curriculum-source:") || tag.startsWith("curriculum-page:") || tag.startsWith("curriculum-sha256:")).map((tag: string) => <li key={tag}>{tag}</li>)}</ul>
      {!detail?.assignment.review_completed_at && <><label>Review notes<textarea minLength={3} maxLength={1000} value={note} onChange={event => setNote(event.target.value)}/></label><label className="qb-content-attestation"><input type="checkbox" checked={attested} onChange={event => setAttested(event.target.checked)}/>I have reviewed facts, answer, explanation, alignment and validation flags.</label><div className="qb-content-actions">{["approve", "revision", "reject"].map(decision => <button key={decision} className={decision === "approve" ? "qb-btn" : decision === "reject" ? "qb-btn danger" : "qb-btn secondary"} disabled={busy || !attested || note.trim().length < 3 || decision === "approve" && Boolean(detail?.validation_errors.length)} onClick={() => act(decision)}>{ { approve: "Approve", revision: "Needs Revision", reject: "Reject" }[decision]}</button>)}</div></>}
      {(context?.content_admin || context?.super_admin) && question.validation_status === "approved" && <button disabled={busy || !detail?.assignment.review_completed_at} onClick={() => void perform(async () => { await publishSmeQuestion(question.id, question.version); setNotice("Approved question published."); setDetail(null); })}>Publish Approved</button>}
    </div>}
  </section>;
}
