"use client";
import { useEffect, useMemo, useState } from "react";
import { listAllCurricula, type CurriculumChoice } from "@/lib/api/curriculum-structure";
import { listApprovedSources, loadCurriculumIndex, runQuestionLoad, type ApprovedSource, type LoadResult } from "@/lib/api/question-loading";
import type { CurriculumIndex } from "@/lib/curriculum/verified";
import { readQuestionFile } from "@/lib/question-loading/read";
import { buildPlan, describePlan } from "@/lib/question-loading/plan";
import { buildLoadPayload } from "@/lib/question-loading/payload";
import type { LoadRow } from "@/lib/question-loading/template";
import { describeErrorMessage } from "@/lib/errors";

const sha256Hex = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map((b) => b.toString(16).padStart(2, "0")).join("");

// Content admin: load a question file against a curriculum that is already in the database. The file is checked in the browser first
// (format, quality, quotes, topic blocks, placement on real indicators); only a file that passes can be loaded. Loaded questions go to
// SME review; nothing is published from here.
export default function QuestionLoadingPage() {
  const [curricula, setCurricula] = useState<CurriculumChoice[]>([]), [curriculumId, setCurriculumId] = useState("");
  const [sources, setSources] = useState<ApprovedSource[]>([]), [chosen, setChosen] = useState<string[]>([]);
  const [index, setIndex] = useState<CurriculumIndex | null>(null);
  const [files, setFiles] = useState<string[]>([]), [rows, setRows] = useState<LoadRow[]>([]), [fileRows, setFileRows] = useState<number[]>([]), [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState(""), [result, setResult] = useState<LoadResult | null>(null);
  const curriculum = curricula.find((c) => c.id === curriculumId);

  useEffect(() => { listAllCurricula().then(setCurricula).catch((e) => setError(describeErrorMessage((e as Error).message))); }, []);
  useEffect(() => {
    setSources([]); setChosen([]); setIndex(null); setResult(null);
    if (!curriculumId) return;
    setBusy(true);
    Promise.all([listApprovedSources(curriculumId), loadCurriculumIndex(curriculumId)])
      .then(([s, i]) => { setSources(s); setChosen(s.map((x) => x.id)); setIndex(i); })
      .catch((e) => setError(describeErrorMessage((e as Error).message))).finally(() => setBusy(false));
  }, [curriculumId]);

  async function choose(list: FileList | null) {
    setError(""); setResult(null);
    if (!list?.length) return;
    try {
      const all: LoadRow[] = [], buffers: Uint8Array[] = []; let single: number[] = [];
      for (const f of Array.from(list)) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const parsed = await readQuestionFile(f.name, bytes);
        buffers.push(bytes); all.push(...parsed.rows); single = parsed.fileRows;
      }
      const joined = new Uint8Array(buffers.reduce((n, b) => n + b.length, 0)); let at = 0;
      for (const b of buffers) { joined.set(b, at); at += b.length; }
      setFiles(Array.from(list).map((f) => f.name)); setRows(all); setFileRows(list.length === 1 ? single : all.map((_, i) => i + 1)); setHash(await sha256Hex(joined));
    } catch (e) { setRows([]); setFiles([]); setError(describeErrorMessage((e as Error).message)); }
  }

  const plan = useMemo(() => (rows.length && index && hash ? buildPlan({ rows, fileRows, fileSha256: hash, scope: "CURRICULUM", index }) : null), [rows, fileRows, index, hash]);
  const noSources = Boolean(curriculumId) && !busy && sources.length === 0;

  async function load() {
    if (!plan || !plan.canLoad || !curriculum?.market_id) return;
    if (!window.confirm(`Load ${plan.report.rows} questions in ${plan.topics.length} topics? They go to SME review and are not published.`)) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const payload = buildLoadPayload(plan, rows);
      const r = await runQuestionLoad({ payload, fileName: files.join(", ").slice(0, 280), fileSha256: hash, marketId: curriculum.market_id, curriculumId, sourceIds: chosen,
        onProgress: (d, t) => setProgress(`Loaded ${d} of ${t} questions…`) });
      setResult(r);
    } catch (e) { setError(describeErrorMessage((e as Error).message)); }
    finally { setBusy(false); setProgress(""); }
  }

  return <>
    <div className="qb-page-head"><div><h1>Load questions</h1>
      <p>Check a question file against a curriculum and load it into SME review. The curriculum structure must already be loaded, and the curriculum needs at least one approved source.</p></div></div>
    {error && <p className="qb-error" role="alert">{error}</p>}
    <section className="qb-card"><h2>1. Curriculum and approved sources</h2>
      <label>Curriculum<select value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)}><option value="">Select a curriculum</option>
        {curricula.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.version})</option>)}</select></label>
      {index && <p className="qb-muted">{index.all.length} learning indicators loaded for this curriculum{index.all.length === 0 ? ". Load its structure first (Curriculum Structure)." : "."}</p>}
      {noSources && <p className="qb-error" role="alert">This curriculum has no approved source yet. Approve one under Curriculum Sources first.</p>}
      {sources.length > 0 && <fieldset><legend>Approved sources the questions come from</legend>
        {sources.map((s) => <label key={s.id}><input type="checkbox" checked={chosen.includes(s.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.id] : chosen.filter((x) => x !== s.id))}/>{s.title}</label>)}</fieldset>}
    </section>
    <section className="qb-card"><h2>2. Question file</h2>
      <p className="qb-muted">One or more .csv, .txt or .xlsx files in the QuizBox question template. Several batch files of one source can be chosen together.</p>
      <label>Files<input type="file" multiple accept=".csv,.txt,.xlsx" disabled={!index || index.all.length === 0} onChange={(e) => void choose(e.target.files)}/></label>
      {files.length > 0 && <p className="qb-muted">{files.join(", ")} · {rows.length} questions</p>}
    </section>
    {plan && <section className="qb-card"><h2>3. Check</h2>
      <ul>{describePlan(plan).map((l, i) => <li key={i}>{l}</li>)}</ul>
      <dl className="qb-stat-list"><div><dt>Clean</dt><dd>{plan.report.cleanRows}</dd></div><div><dt>Warnings</dt><dd>{plan.report.warningRows}</dd></div><div><dt>Errors</dt><dd>{plan.report.errorRows}</dd></div></dl>
      {plan.report.batchFlags.length > 0 && <ul>{plan.report.batchFlags.map((f) => <li key={f.code} className={f.severity === "error" ? "qb-error" : ""}><b>{f.code.replaceAll("_", " ").toLowerCase()}</b>: {f.detail}</li>)}</ul>}
      {plan.report.issues.filter((i) => i.severity === "error").length > 0 && <details open><summary>Rows to fix</summary><ul>
        {plan.report.issues.filter((i) => i.severity === "error").slice(0, 25).map((i, k) => <li key={k}>Row {i.row}: {describeErrorMessage(i.code)}{i.field ? ` (${i.field})` : ""}</li>)}</ul></details>}
      {plan.unresolved.length > 0 && <details><summary>{plan.unresolved.length} questions not placed on the curriculum</summary><ul>
        {plan.unresolved.slice(0, 25).map((u, k) => <li key={k}>Row {u.fileRow}: {u.status.toLowerCase().replaceAll("_", " ")} ({u.subject} {u.grade} {u.indicator_code})</li>)}</ul></details>}
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Topic</th><th>Indicator</th><th>Questions</th><th>Easy / medium / hard</th><th>Concepts</th></tr></thead>
        <tbody>{plan.topics.map((t) => <tr key={t.key}><td>{t.title}</td><td>{t.indicator.indicator_code}</td><td>{t.rows}</td><td>{t.easy} / {t.medium} / {t.hard}</td><td>{t.concepts.length}</td></tr>)}</tbody></table></div>
      <button className="qb-btn" disabled={busy || !plan.canLoad || chosen.length === 0 || !curriculum?.market_id} onClick={() => void load()}>{busy ? progress || "Working…" : "Load into SME review"}</button>
      {!plan.canLoad && <p className="qb-muted">Fix the problems above and choose the corrected files again.</p>}
    </section>}
    {result && <section className="qb-card" role="status"><h2>Result</h2>
      <p>{result.status}: {result.rows_loaded} of {result.rows_total} questions loaded into review{result.rows_rejected ? `, ${result.rows_rejected} rejected` : ""}.</p>
      {result.row_errors.length > 0 && <ul>{result.row_errors.slice(0, 25).map((e, i) => <li key={i}>Row {e.row}: {describeErrorMessage(e.code)}</li>)}</ul>}
    </section>}
  </>;
}
