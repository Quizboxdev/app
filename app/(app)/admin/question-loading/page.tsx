"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { listAllCurricula, type CurriculumChoice } from "@/lib/api/curriculum-structure";
import { findLoadBatchByHash, listApprovedSources, loadCurriculumIndex, runQuestionLoad, type ApprovedSource, type LoadBatchState } from "@/lib/api/question-loading";
import { canContinue } from "@/lib/question-loading/resume";
import { jobView, summarise } from "@/lib/question-loading/queue";
import type { CurriculumIndex } from "@/lib/curriculum/verified";
import { readQuestionFile } from "@/lib/question-loading/read";
import { buildPlan, describePlan, type LoadPlan } from "@/lib/question-loading/plan";
import { balanceAnswerKey } from "@/lib/question-loading/balance";
import { sourcesForSubjects } from "@/lib/question-loading/sources";
import { buildLoadPayload } from "@/lib/question-loading/payload";
import type { LoadRow } from "@/lib/question-loading/template";
import { describeErrorMessage } from "@/lib/errors";
import ExportLink from "@/components/admin/ExportLink";
import DraftNotice from "@/components/DraftNotice";
import { useScreenDraft } from "@/lib/drafts/use-screen-draft";
import { clearFiles, getFiles, putFiles } from "@/lib/drafts/local-files";

const sha256Hex = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource))].map((b) => b.toString(16).padStart(2, "0")).join("");
const n = (v: number) => v.toLocaleString("en-GB");
const FILE_KEY = "question-loading";

// One chosen file. Every file is checked, sourced, loaded and approved on its own, so one bad file never stops the others.
type Job = {
  key: string; name: string; hash: string; rows: LoadRow[]; fileRows: number[]; subjects: string[]; readError: string | null;
  loadRows: LoadRow[]; plan: LoadPlan | null; plannedWith: string; checked: boolean; earlier: LoadBatchState | null | undefined;
  sourceIds: string[]; manualSource: boolean;
  running: boolean; progress: string; outcome: { ok: boolean; rowsLoaded?: number; rowsTotal?: number; message?: string } | null; open: boolean;
};
const newJob = (name: string, hash: string, rows: LoadRow[], fileRows: number[], readError: string | null): Job => ({
  key: hash, name, hash, rows, fileRows, readError, subjects: [...new Set(rows.map((r) => r.subject).filter(Boolean))], loadRows: rows, plan: null, plannedWith: "", checked: false, earlier: undefined,
  sourceIds: [], manualSource: false, running: false, progress: "", outcome: null, open: false });

// Content admin: load question files against a curriculum that is already in the database. Choose as many files as you like. Each file is checked in the browser, the source it
// was written from is picked for you, and a single button loads everything that is ready, in order. If anything stops, the screen says what and where, and you continue from
// there. Loaded questions go to SME review; nothing is published from here.
export default function QuestionLoadingPage() {
  const [curricula, setCurricula] = useState<CurriculumChoice[]>([]), [curriculumId, setCurriculumId] = useState("");
  const [sources, setSources] = useState<ApprovedSource[]>([]), [index, setIndex] = useState<CurriculumIndex | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]), [balance, setBalance] = useState(false);
  const [busy, setBusy] = useState(false), [running, setRunning] = useState(false), [error, setError] = useState("");
  const curriculum = curricula.find((c) => c.id === curriculumId);
  const jobsRef = useRef<Job[]>([]); jobsRef.current = jobs;
  const patch = (key: string, p: Partial<Job>) => setJobs((prev) => prev.map((j) => (j.key === key ? { ...j, ...p } : j)));
  const jobKeys = jobs.map((j) => j.key).join("|");

  // Leaving this page by mistake loses nothing: the curriculum, the answer-position choice and the file names are kept as a draft in Unfinished work, and the chosen files themselves
  // are kept in this browser only (never sent anywhere), so the same files come back. The draft is removed once everything has loaded.
  const restored = useRef<{ files: string[] } | null>(null), triedFiles = useRef(false);
  const draft = useScreenDraft<{ curriculumId: string; balance: boolean; files: string[] }>({ screen: "question-loading", label: "Load questions", detail: jobs.map((j) => j.name).join(", "),
    value: { curriculumId, balance, files: jobs.map((j) => j.name) }, baseline: { curriculumId: "", balance: false, files: [] },
    apply: (v) => { restored.current = { files: v.files ?? [] }; setBalance(Boolean(v.balance)); setCurriculumId(v.curriculumId ?? ""); } });

  useEffect(() => { listAllCurricula().then(setCurricula).catch((e) => setError(describeErrorMessage((e as Error).message))); }, []);
  useEffect(() => {
    setSources([]); setIndex(null);
    setJobs((prev) => prev.map((j) => ({ ...j, plan: null, plannedWith: "", checked: false, earlier: undefined, sourceIds: [], outcome: null })));
    if (!curriculumId) return;
    setBusy(true);
    Promise.all([listApprovedSources(curriculumId), loadCurriculumIndex(curriculumId)])
      .then(([s, i]) => { setSources(s); setIndex(i); })
      .catch((e) => setError(describeErrorMessage((e as Error).message))).finally(() => setBusy(false));
  }, [curriculumId]);

  async function choose(list: File[], fromDraft = false) {
    setError("");
    if (!list.length) return;
    if (!fromDraft) void putFiles(FILE_KEY, list);
    const seen = new Set<string>(), made: Job[] = [];
    for (const f of list) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer()), hash = await sha256Hex(bytes);
        if (seen.has(hash)) continue;
        seen.add(hash);
        const parsed = await readQuestionFile(f.name, bytes);
        made.push(newJob(f.name, hash, parsed.rows, parsed.fileRows, null));
      } catch (e) { made.push(newJob(f.name, `unreadable-${made.length}-${f.name}`, [], [], (e as Error).message)); }
    }
    setJobs(made);
  }
  useEffect(() => {
    if (!index || triedFiles.current || jobsRef.current.length > 0 || !restored.current?.files.length) return;
    triedFiles.current = true;
    void getFiles(FILE_KEY).then((fs) => { if (fs.length) void choose(fs, true); });
  }, [index]);

  // Every ticked source is recorded on every question in the file, so each file gets the source its subject column names. The admin can still change it per file.
  useEffect(() => {
    if (!sources.length) return;
    setJobs((prev) => { let changed = false;
      const next = prev.map((j) => { if (j.manualSource) return j; const picked = sourcesForSubjects(sources, j.subjects); if (picked.join() === j.sourceIds.join()) return j; changed = true; return { ...j, sourceIds: picked }; });
      return changed ? next : prev; });
  }, [sources, jobKeys]);

  // Check each file against the curriculum, one at a time so the page stays responsive, and ask the database whether it has seen the file before.
  useEffect(() => {
    if (!index) return;
    const stamp = `${curriculumId}|${balance}`, todo = jobsRef.current.filter((j) => !j.readError && j.plannedWith !== stamp);
    if (!todo.length) return;
    let alive = true;
    void (async () => {
      for (const j of todo) {
        await new Promise((r) => setTimeout(r, 0));
        if (!alive) return;
        const balanced = balance ? balanceAnswerKey(j.rows, parseInt(j.hash.slice(0, 8) || "1", 16) || 1) : null, loadRows = balanced ? balanced.rows : j.rows;
        const plan = buildPlan({ rows: loadRows, fileRows: j.fileRows, fileSha256: j.hash, scope: "CURRICULUM", index });
        const earlier = plan.canLoad ? await findLoadBatchByHash(j.hash) : null;
        if (!alive) return;
        patch(j.key, { loadRows, plan, checked: true, earlier, plannedWith: stamp });
      }
    })();
    return () => { alive = false; };
  }, [index, balance, curriculumId, jobKeys]);

  const views = jobs.map((job) => ({ job, view: jobView({ readError: job.readError, checked: job.checked, plan: job.plan, rowsCount: job.loadRows.length, earlier: job.earlier, sourceIds: job.sourceIds, running: job.running, outcome: job.outcome }) }));
  const summary = summarise(views.map(({ job, view }) => ({ view, rowsCount: job.loadRows.length, savedRows: view.phase === "continue" ? job.earlier?.rows_total : 0 })));
  const noSources = Boolean(curriculumId) && !busy && sources.length === 0;
  const allFinished = jobs.length > 0 && views.every(({ view }) => ["done", "loaded-before"].includes(view.phase));
  const canRun = summary.files > 0 && !running && Boolean(curriculum?.market_id);

  async function runAll() {
    if (!curriculum?.market_id || !canRun) return;
    if (!window.confirm(`Load ${summary.files} file${summary.files === 1 ? "" : "s"} (${n(summary.questions)} questions)? They go to SME review and are not published. If anything stops, you can continue from where it stopped.`)) return;
    setRunning(true); setError("");
    let failed = false;
    for (const { job } of views.filter((v) => v.view.runnable)) {
      patch(job.key, { running: true, outcome: null, progress: "" });
      try {
        const held = await findLoadBatchByHash(job.hash), total = job.loadRows.length;
        const resume = held && canContinue(held, total) ? { batchId: held.id, fromRow: held.rows_total } : undefined;
        const r = await runQuestionLoad({ payload: buildLoadPayload(job.plan!, job.loadRows), fileName: job.name.slice(0, 280), fileSha256: job.hash, marketId: curriculum.market_id, curriculumId,
          sourceIds: job.sourceIds, resume, onProgress: (d, t) => patch(job.key, { progress: `${n(d)} of ${n(t)}` }) });
        const ok = r.status === "LOADED" || r.status === "PARTIAL";
        const notes = [r.rows_rejected ? `${n(r.rows_rejected)} rejected` : "", ...r.row_errors.slice(0, 3).map((e) => `row ${e.row}: ${describeErrorMessage(e.code)}`)].filter(Boolean).join("; ");
        patch(job.key, { running: false, earlier: await findLoadBatchByHash(job.hash), outcome: { ok, rowsLoaded: r.rows_loaded, rowsTotal: r.rows_total, message: ok ? notes : `Nothing usable was loaded. ${notes}` } });
        if (!ok) { failed = true; break; }
      } catch (e) {
        patch(job.key, { running: false, earlier: await findLoadBatchByHash(job.hash), outcome: { ok: false, message: describeErrorMessage((e as Error).message) } });
        failed = true; break;
      }
    }
    setRunning(false);
    if (!failed) { void draft.finish(); void clearFiles(FILE_KEY); }   // everything loaded: nothing left to come back to
  }

  function clearAll() { void draft.finish(); void clearFiles(FILE_KEY); restored.current = null; triedFiles.current = false; setJobs([]); setBalance(false); setCurriculumId(""); setError(""); }

  return <>
    <div className="qb-page-head"><div><h1>Load questions</h1>
      <p>Choose a curriculum, then choose your question files. Each file is checked and loaded on its own, and the matching source is picked for you. Loaded questions wait in SME review until they are approved in Question batches.</p></div><ExportLink dataset="question_batches" /></div>
    {error && <p className="qb-error" role="alert">{error}</p>}
    {(curriculumId || jobs.length > 0) && <DraftNotice restored={!!draft.restored} expiresAt={draft.expiresAt} noun="question load" onDiscard={clearAll} />}

    <section className="qb-card"><h2>1. Curriculum</h2>
      <label>Curriculum<select value={curriculumId} onChange={(e) => setCurriculumId(e.target.value)}><option value="">Select a curriculum</option>
        {curricula.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name} ({c.version})</option>)}</select></label>
      {index && <p className="qb-muted">{n(index.all.length)} learning indicators loaded for this curriculum{index.all.length === 0 ? ". Load its structure first (Curriculum Structure)." : "."}</p>}
      {noSources && <p className="qb-error" role="alert">This curriculum has no approved source yet. Approve one under Curriculum Sources first.</p>}
      {curriculumId && curriculum && !curriculum.market_id && <p className="qb-error" role="alert">This curriculum is not attached to a market yet, so questions cannot be loaded for it.</p>}
    </section>

    <section className="qb-card"><h2>2. Question files</h2>
      <p className="qb-muted">Choose as many .csv, .txt or .xlsx files as you like. Choosing files again replaces this list.</p>
      <label>Files<input type="file" multiple accept=".csv,.txt,.xlsx" disabled={!index || index.all.length === 0} onChange={(e) => void choose(Array.from(e.target.files ?? []))} /></label>
      {!curriculumId && <p className="qb-muted qb-small">Pick the curriculum first.</p>}
    </section>

    {jobs.length > 0 && <section className="qb-card"><h2>3. Check and load</h2>
      <p role="status"><strong>{summary.line}</strong></p>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>File</th><th>Questions</th><th>Source</th><th>Status</th><th /></tr></thead><tbody>
        {views.map(({ job, view }) => <Fragment key={job.key}>
          <tr>
            <td>{job.name}</td>
            <td>{n(job.loadRows.length)}{job.plan ? <span className="qb-muted qb-small" style={{ display: "block" }}>{job.plan.topics.length} topics</span> : null}</td>
            <td className="qb-small">{job.sourceIds.length ? sources.filter((s) => job.sourceIds.includes(s.id)).map((s) => s.title.replace(/\s+B\d.*$/, "")).join(", ") : <span className="qb-muted">none</span>}</td>
            <td><span className={`qb-pill${view.tone === "ok" ? " success" : ""}`}>{view.label}</span>{job.running && job.progress ? <span className="qb-muted qb-small" style={{ display: "block" }}>{job.progress}</span> : null}
              {view.detail ? <span className={`qb-small ${view.tone === "bad" ? "qb-error" : "qb-muted"}`} style={{ display: "block" }}>{view.detail}</span> : null}</td>
            <td><button type="button" className="qb-link-btn" onClick={() => patch(job.key, { open: !job.open })}>{job.open ? "Hide details" : "Details"}</button></td>
          </tr>
          {job.open && <tr><td colSpan={5}>
            <fieldset><legend>Source this file was written from</legend>
              {sources.map((s) => <label key={s.id}><input type="checkbox" checked={job.sourceIds.includes(s.id)} onChange={(e) => patch(job.key, { manualSource: true, sourceIds: e.target.checked ? [...job.sourceIds, s.id] : job.sourceIds.filter((x) => x !== s.id) })} />{s.title}</label>)}
              {job.sourceIds.length > 1 && <p className="qb-error" role="alert">{job.sourceIds.length} sources are ticked. Every question in this file will record all of them. Tick only the source(s) it was written from.</p>}
            </fieldset>
            {job.plan && <>
              <ul>{describePlan(job.plan).map((l, i) => <li key={i}>{l}</li>)}</ul>
              <dl className="qb-stat-list"><div><dt>Clean</dt><dd>{job.plan.report.cleanRows}</dd></div><div><dt>Warnings</dt><dd>{job.plan.report.warningRows}</dd></div><div><dt>Errors</dt><dd>{job.plan.report.errorRows}</dd></div></dl>
              {job.plan.report.issues.filter((i) => i.severity === "error").length > 0 && <details open><summary>Rows to fix</summary><ul>
                {job.plan.report.issues.filter((i) => i.severity === "error").slice(0, 25).map((i, k) => <li key={k}>Row {i.row}: {describeErrorMessage(i.code)}{i.field ? ` (${i.field})` : ""}</li>)}</ul></details>}
              {job.plan.unresolved.length > 0 && <details><summary>{job.plan.unresolved.length} questions not placed on the curriculum</summary><ul>
                {job.plan.unresolved.slice(0, 25).map((u, k) => <li key={k}>Row {u.fileRow}: {u.status.toLowerCase().replaceAll("_", " ")} ({u.subject} {u.grade} {u.indicator_code})</li>)}</ul></details>}
              <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Topic</th><th>Indicator</th><th>Questions</th><th>Easy / medium / hard</th><th>Concepts</th></tr></thead>
                <tbody>{job.plan.topics.map((t) => <tr key={t.key}><td>{t.title}</td><td>{t.indicator.indicator_code}</td><td>{t.rows}</td><td>{t.easy} / {t.medium} / {t.hard}</td><td>{t.concepts.length}</td></tr>)}</tbody></table></div>
            </>}
          </td></tr>}
        </Fragment>)}
      </tbody></table></div>

      <label className="qb-check"><input type="checkbox" checked={balance} onChange={(e) => setBalance(e.target.checked)} /> Even out the correct-answer positions in every file before loading (moves whole option texts, never just the letter, and leaves alone questions whose wording points at option positions)</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <button className="qb-btn" disabled={!canRun} onClick={() => void runAll()}>{running ? "Loading…" : summary.files > 0 ? `Load ${summary.files} file${summary.files === 1 ? "" : "s"} (${n(summary.questions)} questions)` : "Nothing ready to load"}</button>
        {summary.files === 0 && summary.attention > 0 && !running && <span className="qb-muted qb-small">Open Details on a file marked “Needs attention” to see what to fix, then choose the corrected file again.</span>}
      </div>
      {allFinished && <div className="qb-card" role="status" style={{ marginTop: 12 }}><strong>All done.</strong> The questions are in SME review. <Link className="qb-link" href="/admin/question-batches">Review and approve them in Question batches</Link>.</div>}
    </section>}
  </>;
}
