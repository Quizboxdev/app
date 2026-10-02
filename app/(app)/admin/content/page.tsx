"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import dynamic from "next/dynamic";
import { getContentCoverage, getContentDetail, importCandidates, listContentBatches, listContentQueue, requestGeneration, reviewContent } from "@/lib/api/content-factory";
import { EDITORIAL_STATES, type GenerationSpec } from "@/lib/content/factory/contract";
import { userFacingError } from "@/lib/errors";

type View = "review" | "coverage" | "batches";
const initialFilters = { search: "", curriculum: "", grade: "", subject: "", node: "", source: "", status: "review", difficulty: "", cognitive: "", type: "", batch: "" };
const RichPreview = dynamic(() => import("@/components/QuestionRenderer"));
export default function AdminContentPage() {
  const [view, setView] = useState<View>("review");
  const [filters, setFilters] = useState(initialFilters), [applied, setApplied] = useState(initialFilters);
  const [page, setPage] = useState(1), [rows, setRows] = useState<any[]>([]), [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [branch, setBranch] = useState<Array<{ id: string; title: string }>>([]);
  const [detail, setDetail] = useState<any>(null), [editing, setEditing] = useState(false);
  const [note, setNote] = useState(""), [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [generation, setGeneration] = useState<any>(null), [json, setJson] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const request = ++loadVersion.current;
    setLoading(true); setError("");
    try {
      const result = view === "review" ? await listContentQueue(applied, page)
        : view === "batches" ? await listContentBatches(page)
        : await getContentCoverage({ ...applied, type: branch.length ? "" : "grade", parent: branch.at(-1)?.id ?? "" }, page);
      if (request !== loadVersion.current) return;
      setRows(result.rows ?? []); setTotal(result.total ?? 0); setSummary(result.summary ?? {});
    } catch (e) { if (request === loadVersion.current) setError(userFacingError(e)); }
    finally { if (request === loadVersion.current) setLoading(false); }
  }, [view, applied, page, branch]);
  useEffect(() => { void load(); }, [load]);
  const selectView = (next: View) => { loadVersion.current++; setRows([]); setTotal(0); setSummary({}); setView(next); setPage(1); setDetail(null); setGeneration(null); };
  const open = async (id: string) => {
    setBusy(true); setError("");
    try { setDetail(await getContentDetail(id)); setEditing(false); setNote(""); setAttested(false); setTimeout(() => heading.current?.focus(), 0); }
    catch (e) { setError(userFacingError(e)); } finally { setBusy(false); }
  };
  const act = async (action: string, patch: Record<string, unknown> = {}, next = false) => {
    setBusy(true); setError("");
    try {
      await reviewContent(detail.question, action, note, attested, patch);
      setNotice(action === "approve" ? "Approved. Publication remains a separate decision." : "Review saved.");
      const nextId = rows.find((r) => r.id !== detail.question.id)?.id;
      if (next && nextId) await open(nextId); else await open(detail.question.id);
      await load();
    } catch (e) { setError(userFacingError(e)); } finally { setBusy(false); }
  };
  const edit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget), patch: Record<string, unknown> = {};
    for (const name of ["question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation"]) patch[name] = data.get(name);
    try { patch.question_content = data.get("question_content") ? JSON.parse(String(data.get("question_content"))) : null; }
    catch { setError("Question content must be valid JSON."); return; }
    void act("edit", patch);
  };
  const queueGeneration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const spec: GenerationSpec = {
      indicatorId: generation.id, indicatorCode: generation.code, indicatorTitle: generation.title,
      curriculumId: generation.curriculum_id, educationLevel: generation.education_level ?? "Ghana school curriculum",
      grade: generation.canonical_grade_code ?? generation.grade_code, subject: generation.subject_code,
      count: Number(form.get("count")), difficulty: String(form.get("difficulty")) as GenerationSpec["difficulty"],
      answerType: String(form.get("type")) as GenerationSpec["answerType"], cognitiveLevel: String(form.get("cognitive")),
      language: "English", marks: 1, expectedSeconds: 60, provenance: { source: "AI_GENERATED" },
    };
    try { await requestGeneration(spec); selectView("batches"); setNotice("Generation request queued. Provider not configured."); }
    catch (e) { setError(userFacingError(e)); } finally { setBusy(false); }
  };
  const ingest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const input = JSON.parse(json); const result = await importCandidates(input.spec, input.candidates); setNotice(`Batch saved: ${result.batch_id}. No questions auto-approved.`); setJson(""); await load(); }
    catch (e) { setError(userFacingError(e)); } finally { setBusy(false); }
  };
  const q = detail?.question;
  return <div className="qb-content-ops">
    <div className="qb-page-head"><h1>Content Operations</h1><button type="button" onClick={() => void load()} title="Refresh" aria-label="Refresh" disabled={loading}><RefreshCw size={18}/></button></div>
    <nav className="qb-content-tabs" aria-label="Content views">{(["review", "coverage", "batches"] as View[]).map((item) => <button key={item} type="button" disabled={busy} aria-current={view === item ? "page" : undefined} onClick={() => selectView(item)}>{ { review: "Editorial Review", coverage: "Curriculum Coverage", batches: "Batches" }[item]}</button>)}</nav>
    {error && <p role="alert" className="qb-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {view !== "batches" && <form className="qb-content-filters" onSubmit={(e) => { e.preventDefault(); setApplied(filters); setPage(1); setBranch([]); }}>
      {["search", "grade", "subject", "curriculum", ...(view === "review" ? ["node", "source", "cognitive", "batch"] : [])].map((name) => <label key={name}>{({ node: "Curriculum node ID", curriculum: "Curriculum ID", batch: "Batch ID" } as Record<string, string>)[name] ?? name}<input value={filters[name as keyof typeof filters]} onChange={(e) => setFilters({ ...filters, [name]: e.target.value })}/></label>)}
      {view === "review" && <><label>Editorial state<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}><option value="">All</option>{EDITORIAL_STATES.map((s) => <option key={s}>{s}</option>)}</select></label><label>Difficulty<select value={filters.difficulty} onChange={(e) => setFilters({ ...filters, difficulty: e.target.value })}><option value="">All</option>{["easy","medium","hard"].map((s) => <option key={s}>{s}</option>)}</select></label><label>Question type<select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="">All</option>{["SINGLE_CHOICE","TRUE_FALSE","MULTIPLE_CHOICE","NUMERIC","FRACTION","SHORT_TEXT","EXPRESSION"].map((s) => <option key={s}>{s}</option>)}</select></label></>}
      <button type="submit">Apply Filters</button>
    </form>}
    {view === "coverage" && <>
      <dl className="qb-content-metrics">{Object.entries(summary).map(([name, value]) => <div key={name}><dt>{({rejected:"Rejected",belowTarget:"Below Target",reviewQueue:"Pending Review",zeroApproved:"Zero Approved",meetingTarget:"Meeting Target",totalIndicators:"Indicators",fixtureQuestions:"Fixtures",productionApproved:"Production Approved",duplicateCandidates:"Duplicate Candidates"} as Record<string,string>)[name] ?? name}</dt><dd>{value}</dd></div>)}</dl>
      {branch.length > 0 && <div className="qb-page-head"><button type="button" aria-label="Parent curriculum level" title="Parent curriculum level" onClick={() => { setBranch(branch.slice(0,-1)); setPage(1); }}><ArrowLeft size={18}/></button><span>{branch.map((b) => b.title).join(" / ")}</span></div>}
    </>}
    <div className="qb-table-wrap" aria-busy={loading}><table className="qb-table">
      <thead><tr>{(view === "review" ? ["Question", "Curriculum", "State", "Source", "Difficulty", ""] : view === "coverage" ? ["Curriculum", "Approved", "Review", "Rejected", "Easy / Medium / Hard", "Health", ""] : ["Batch", "Source / Provider", "Requested", "Valid", "Review / Approved", "Rejected", "Duplicates", "State", ""]).map((name,i) => <th key={i} scope="col">{name}</th>)}</tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}>{view === "review" ? <><td>{r.question_text}</td><td>{r.subject_code} / {r.canonical_grade_code ?? r.grade}<small>{r.indicator_code}</small></td><td>{r.validation_status}<small>{r.status}</small></td><td>{r.source_type ?? "Legacy"}</td><td>{r.difficulty_label}</td><td><button disabled={busy} onClick={() => void open(r.id)}>Review</button></td></>
        : view === "coverage" ? <><td>{r.code}<small>{r.title}</small></td><td>{r.approved}</td><td>{r.review}</td><td>{r.rejected}</td><td>{r.easy} / {r.medium} / {r.hard}</td><td>{r.health}</td><td>{["learning_indicator","learning_objective"].includes(r.node_type) ? <button onClick={() => setGeneration(r)}>Generate Questions</button> : <button onClick={() => { setBranch([...branch, {id:r.id,title:r.title}]); setPage(1); }}>Open</button>}</td></>
        : <><td>{r.source_file}<small>{r.id}</small><small>{r.started_at} / {r.imported_by}</small></td><td>{r.source_type}<small>{r.provider ?? "Not configured"} / {r.model_version ?? "-"}</small></td><td>{r.records_detected}</td><td>{r.valid_records}</td><td>{r.pending_records} / {r.approved_records}</td><td>{Number(r.rejected_records)+Number(r.rejected_editorial_records)}</td><td>{r.duplicates_skipped}</td><td>{r.status}</td><td><button onClick={() => { setFilters({...initialFilters,status:"",batch:r.id}); setApplied({...initialFilters,status:"",batch:r.id}); selectView("review"); }}>Open Batch</button></td></>}</tr>)}</tbody>
    </table>{!loading && !rows.length && <p>{view === "review" ? "No review items." : view === "coverage" ? "No matching curriculum nodes." : "No batches."}</p>}{loading && <p role="status">Loading...</p>}</div>
    <div className="qb-page-head"><span>{total} records. Page {page} of {Math.max(1,Math.ceil(total/25))}</span><div className="qb-content-actions"><button aria-label="Previous page" title="Previous page" disabled={page===1 || loading} onClick={() => setPage(page-1)}><ChevronLeft size={18}/></button><button aria-label="Next page" title="Next page" disabled={page*25>=total || loading} onClick={() => setPage(page+1)}><ChevronRight size={18}/></button></div></div>
    {q && <section className="qb-content-review" aria-labelledby="review-heading">
      <div className="qb-page-head"><h2 id="review-heading" ref={heading} tabIndex={-1}>Question Review</h2><button aria-label="Close review" title="Close review" onClick={() => setDetail(null)}><X size={18}/></button></div>
      <RichPreview question={{...q,question_id:q.id}}/><ol type="A">{[q.option_a,q.option_b,q.option_c,q.option_d].map((o,i) => <li key={i}>{o || "-"}</li>)}</ol>
      <p><strong>Proposed answer:</strong> {q.correct_answer}</p><p><strong>Explanation:</strong> {q.explanation}</p>
      <p>{q.indicator_code} / {q.subject_code} / {q.source_grade_code ?? q.grade} / {q.canonical_grade_code ?? q.grade}</p>
      <p>{q.difficulty_label} / {q.cognitive_level} / {q.source_type} / version {q.version}</p>
      {q.duplicate_group_id && <p role="status">Duplicate group: {q.duplicate_group_id}</p>}
      <ul>{(detail.validation_errors ?? []).map((code: string) => <li key={code}>{code}</li>)}</ul>
      <ul>{(q.editorial_metadata?.warnings ?? []).map((code: string) => <li key={code}>{code}</li>)}</ul>
      <label>Review note<textarea value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} maxLength={1000}/></label>
      <label className="qb-content-attestation"><input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)}/>I have reviewed facts, answer, distractors, explanation, curriculum alignment and duplicate warnings.</label>
      <div className="qb-content-actions">
        <button disabled={busy || !attested || q.validation_status!=="review" || (detail.validation_errors ?? []).length>0} onClick={() => void act("approve")}>Approve</button>
        <button disabled={busy || !attested || q.validation_status!=="review" || (detail.validation_errors ?? []).length>0} onClick={() => void act("approve",{},true)}>Approve Next</button>
        <button disabled={busy} onClick={() => void act("reject")}>Reject</button><button disabled={busy} onClick={() => void act("revision")}>Send for Revision</button>
        <button disabled={busy || q.validation_status!=="approved"} onClick={() => void act("publish")}>Publish Approved</button>
        <button disabled={busy} onClick={() => void act("archive")}>Archive</button><button disabled={busy} onClick={() => setEditing(!editing)}>Edit</button>
      </div>
      {editing && <form onSubmit={edit} className="qb-content-filters">{["question_text","option_a","option_b","option_c","option_d","correct_answer","explanation"].map((name) => <label key={name}>{name.replace(/_/g," ")}<textarea name={name} defaultValue={q[name]} required/></label>)}<label>Rich content JSON<textarea name="question_content" defaultValue={q.question_content ? JSON.stringify(q.question_content,null,2) : ""} rows={6}/></label><button disabled={busy || note.trim().length<3} type="submit">Save Revision</button></form>}
      <h3>Version History</h3><ul>{(detail.versions ?? []).map((v:any) => <li key={v.version}>Version {v.version} / {v.at} / {v.reason} / {v.editor ?? "Import"}</li>)}</ul>
    </section>}
    {generation && <section className="qb-content-review"><h2>Generate Questions</h2><p>{generation.code}: {generation.title}</p><form onSubmit={queueGeneration} className="qb-content-filters"><label>Count<input type="number" name="count" min={1} max={100} defaultValue={10} required/></label><label>Difficulty<select name="difficulty"><option>easy</option><option>medium</option><option>hard</option></select></label><label>Type<select name="type"><option>SINGLE_CHOICE</option><option>TRUE_FALSE</option></select></label><label>Cognitive level<input name="cognitive" defaultValue="Understand" required/></label><button type="submit" disabled={busy}>Queue Generation</button></form></section>}
    {view === "batches" && <section className="qb-content-review"><h2>Candidate Import</h2><form onSubmit={ingest}><label>Candidate batch JSON<textarea rows={8} value={json} onChange={(e) => setJson(e.target.value)} required maxLength={1000000}/></label><button type="submit" disabled={busy}>Import for Review</button></form></section>}
  </div>;
}
