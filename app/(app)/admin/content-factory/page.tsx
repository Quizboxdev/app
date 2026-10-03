"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { factory, factoryOptions, importQuestions, runCampaignJobs, type Allocation, type Campaign, type CampaignDetail, type FactoryOptions } from "@/lib/api/factory";
import { parseImport, precheckRows, type ImportRow } from "@/lib/content/factory/import";

type Ops = { totals: Record<string, number>; by_subject: Array<Record<string, any>>; by_level: Array<Record<string, any>>; by_market: Array<Record<string, any>>; indicators: Array<Record<string, any>>; sources: Array<Record<string, any>> };
const DIFFICULTY = ["easy", "medium", "hard"], COGNITIVE = ["Recall", "Understanding", "Application", "Higher-order"], TYPES = ["SINGLE_CHOICE", "TRUE_FALSE"];
const blank = { name: "", market_id: "", curriculum_id: "", sources: [] as string[], subjects: [] as string[], grades: [] as string[], levels: [] as string[], nodeCodes: "", weighting: "equal", target: 1000, batch: 25,
  difficulty: { easy: 30, medium: 50, hard: 20 } as Record<string, number>, cognitive: { Recall: 20, Understanding: 30, Application: 35, "Higher-order": 15 } as Record<string, number>, types: { SINGLE_CHOICE: 100, TRUE_FALSE: 0 } as Record<string, number>,
  provider: "", model: "", senior: false, priority: 100, maxJobs: 5, retry: 2, pauseAfter: 3, largeThreshold: 1000 };
const mix = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]));

// Content Admin: QuizBox-owned curriculum production. Sponsor competition generation stays in the Sponsor Workspace.
export default function ContentFactoryPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]), [options, setOptions] = useState<FactoryOptions | null>(null), [form, setForm] = useState(blank);
  const [selected, setSelected] = useState(""), [detail, setDetail] = useState<CampaignDetail | null>(null), [ops, setOps] = useState<Ops | null>(null), [edits, setEdits] = useState<Record<string, number>>({});
  const [confirm, setConfirm] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [importText, setImportText] = useState(""), [importFormat, setImportFormat] = useState<"csv" | "json">("csv"), [preview, setPreview] = useState<{ rows: ImportRow[]; issues: Array<{ row: number; code: string }> } | null>(null);
  const [manual, setManual] = useState<ImportRow>({ answer_type: "SINGLE_CHOICE", correct_answer: "A", difficulty: "medium", cognitive_level: "Understanding" });

  const act = useCallback(async (work: () => Promise<unknown>, message?: string) => { setBusy(true); setError(""); setNotice(""); try { await work(); if (message) setNotice(message); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } }, []);
  const load = useCallback(async () => { setCampaigns(await factory<Campaign[]>("list")); }, []);
  const open = useCallback(async (id: string) => { if (!id) { setDetail(null); setOps(null); return; } setDetail(await factory<CampaignDetail>("get", { campaign_id: id, limit: 500 })); setOps(await factory<Ops>("operations", { campaign_id: id })); setEdits({}); }, []);
  useEffect(() => { void act(async () => { await load(); setOptions(await factoryOptions()); }); }, [act, load]);
  useEffect(() => { void act(() => open(selected)); }, [act, open, selected]);
  useEffect(() => { if (form.curriculum_id) factoryOptions(form.curriculum_id).then((o) => setOptions((prev) => prev ? { ...prev, scope: o.scope } : o)).catch(() => undefined); }, [form.curriculum_id]);

  const curricula = useMemo(() => (options?.curricula ?? []).filter((c) => c.market_id === form.market_id), [options, form.market_id]);
  const sources = useMemo(() => (options?.sources ?? []).filter((s) => s.market_id === form.market_id && s.curriculum_id === form.curriculum_id), [options, form.market_id, form.curriculum_id]);
  const scope = options?.scope ?? [];
  const uniq = (key: "subject" | "grade" | "level") => [...new Set(scope.map((s) => s[key]).filter(Boolean))].sort();
  const toggle = (key: "sources" | "subjects" | "grades" | "levels", value: string) => setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));
  const sum = (m: Record<string, number>) => Object.values(m).reduce((s, v) => s + Number(v || 0), 0);

  async function create(event: FormEvent) {
    event.preventDefault();
    await act(async () => {
      const created = await factory<Campaign>("create", { name: form.name, market_id: form.market_id, curriculum_id: form.curriculum_id, target_question_count: Number(form.target), batch_size: Number(form.batch), provider: form.provider, model: form.model,
        source_scope: { source_document_ids: form.sources, subject_codes: form.subjects, grade_codes: form.grades, education_levels: form.levels, node_codes: form.nodeCodes.split(/[\s,]+/).filter(Boolean), weighting: form.weighting },
        difficulty_mix: mix(form.difficulty), cognitive_mix: mix(form.cognitive), question_types: mix(form.types), review_policy: { senior_review: form.senior },
        priority: Number(form.priority), max_jobs_per_execution: Number(form.maxJobs), retry_limit: Number(form.retry), pause_failure_threshold: Number(form.pauseAfter), large_campaign_threshold: Number(form.largeThreshold) });
      await load(); setSelected(created.id); setForm(blank);
    }, "Campaign created as a draft. Generate the distribution plan next.");
  }
  const campaignAction = (action: string, data: Record<string, unknown> = {}, message?: string) => act(async () => { await factory(action, { campaign_id: selected, ...data }); await load(); await open(selected); }, message);
  const saveAdjustments = () => campaignAction("adjust", { allocations: Object.entries(edits).map(([id, target_count]) => ({ id, target_count })) }, "Distribution updated.");
  const runJobs = () => act(async () => { const result = await runCampaignJobs(selected); await load(); await open(selected);
    setNotice(`Ran ${result.claimed} job(s): ${result.outcomes.filter((o) => o.status === "COMPLETED").length} completed, ${result.outcomes.filter((o) => o.status !== "COMPLETED").length} not completed.`); });
  async function previewImport() { await act(async () => { const rows = parseImport(importText, importFormat); setPreview({ rows, issues: precheckRows(rows) }); }); }
  async function submitImport(rows: ImportRow[], origin: "IMPORTED" | "HUMAN_AUTHOR") {
    if (!detail) return;
    await act(async () => {
      const result = await importQuestions({ market_id: detail.market_id, curriculum_id: detail.curriculum_id, source_document_ids: (detail.source_scope.source_document_ids as string[]) ?? [], campaign_id: detail.id, origin, rows, file_name: origin === "IMPORTED" ? "admin-import" : undefined });
      setNotice(`${result.inserted} question(s) entered review; ${result.rejected + result.row_errors.length} rejected; ${result.published} published.`); setPreview(null); await open(detail.id);
    });
  }
  const editable = detail && ["DRAFT", "READY"].includes(detail.status);

  return <>
    <div className="qb-page-head"><div><h1>Content Factory</h1><p>Plan, batch and govern curriculum question production. Every question enters SME review; nothing is published automatically.</p></div></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}

    <section className="qb-card"><h2>Campaigns</h2>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Campaign</th><th>Market</th><th>Status</th><th>Target</th><th>Generated</th><th>Approved</th><th>Jobs</th><th>Action</th></tr></thead>
        <tbody>{campaigns.map((c) => <tr key={c.id}><td>{c.name}<div className="qb-small qb-muted">{c.curriculum}</div></td><td>{c.market}</td><td><span className="qb-pill">{c.status}</span>{c.assignment_paused && <div className="qb-small qb-muted">assignment paused</div>}</td>
          <td>{c.target_question_count}</td><td>{c.generated_count}</td><td>{c.accepted_count}</td><td>{c.jobs.completed}/{c.jobs.total}{c.jobs.failed ? ` (${c.jobs.failed} failed)` : ""}</td>
          <td><button className="qb-btn secondary" onClick={() => setSelected(c.id)} aria-label={`Open ${c.name}`}>Open</button></td></tr>)}</tbody></table>
        {!campaigns.length && <p className="qb-muted">No campaigns yet.</p>}</div>
    </section>

    <details className="qb-card"><summary><strong>New generation campaign</strong></summary>
      <form className="qb-form" onSubmit={create}>
        <label>Campaign name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={3} maxLength={160}/></label>
        <div className="qb-content-filters">
          <label>Market<select value={form.market_id} onChange={(e) => setForm({ ...form, market_id: e.target.value, curriculum_id: "", sources: [] })} required><option value="">Select market</option>{options?.markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          <label>Curriculum<select value={form.curriculum_id} onChange={(e) => setForm({ ...form, curriculum_id: e.target.value, sources: [], subjects: [], grades: [], levels: [] })} required><option value="">Select active curriculum</option>{curricula.map((c) => <option key={c.id} value={c.id}>{c.code} ({c.authority})</option>)}</select></label>
          <label>Topic weighting<select value={form.weighting} onChange={(e) => setForm({ ...form, weighting: e.target.value })}><option value="equal">Equal per indicator</option><option value="coverage_gap">Favour indicators with less content</option></select></label>
        </div>
        <fieldset><legend>Approved curriculum sources ({form.market_id && form.curriculum_id ? sources.length : 0} available)</legend>
          {sources.map((s) => <label key={s.id}><input type="checkbox" checked={form.sources.includes(s.id)} onChange={() => toggle("sources", s.id)}/>{s.title}</label>)}
          {form.curriculum_id && !sources.length && <p className="qb-muted">No approved curriculum source for this curriculum. Approve one in Market Setup first.</p>}</fieldset>
        {(["levels", "grades", "subjects"] as const).map((key) => <fieldset key={key}><legend>{key === "levels" ? "Education levels" : key === "grades" ? "Grades" : "Subjects"} (none selected = all)</legend>
          {uniq(key === "levels" ? "level" : key === "grades" ? "grade" : "subject").map((v) => <label key={v}><input type="checkbox" checked={form[key].includes(v)} onChange={() => toggle(key, v)}/>{v}</label>)}</fieldset>)}
        <label>Restrict to strand / topic / indicator codes (optional, comma-separated)<input value={form.nodeCodes} onChange={(e) => setForm({ ...form, nodeCodes: e.target.value })} placeholder="e.g. B7.1.1.1.1, B7.1.2"/></label>
        <div className="qb-content-filters">
          <label>Target questions<input type="number" min={1} max={1000000} value={form.target} onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} required/></label>
          <label>Batch size (per job)<input type="number" min={1} max={100} value={form.batch} onChange={(e) => setForm({ ...form, batch: Number(e.target.value) })} required/></label>
          <label>Generation provider<input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} required/></label>
          <label>Generation model<input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required/></label>
        </div>
        {([["difficulty", DIFFICULTY, "Difficulty mix (%)"], ["cognitive", COGNITIVE, "Cognitive-level mix (%)"], ["types", TYPES, "Question types (%)"]] as const).map(([key, labels, legend]) =>
          <fieldset key={key}><legend>{legend}: total {sum(form[key])}%</legend><div className="qb-content-filters">{labels.map((l) =>
            <label key={l}>{l}<input type="number" min={0} max={100} value={form[key][l] ?? 0} onChange={(e) => setForm({ ...form, [key]: { ...form[key], [l]: Number(e.target.value) } })}/></label>)}</div></fieldset>)}
        <fieldset><legend>Review policy and safety limits</legend><div className="qb-content-filters">
          <label><input type="checkbox" checked={form.senior} onChange={(e) => setForm({ ...form, senior: e.target.checked })}/>Require independent senior review</label>
          <label>Campaign priority<input type="number" min={1} max={1000} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}/></label>
          <label>Max jobs per execution<input type="number" min={1} max={10} value={form.maxJobs} onChange={(e) => setForm({ ...form, maxJobs: Number(e.target.value) })}/></label>
          <label>Retry limit<input type="number" min={0} max={5} value={form.retry} onChange={(e) => setForm({ ...form, retry: Number(e.target.value) })}/></label>
          <label>Pause after consecutive failures<input type="number" min={1} max={100} value={form.pauseAfter} onChange={(e) => setForm({ ...form, pauseAfter: Number(e.target.value) })}/></label>
          <label>Large-campaign confirmation from<input type="number" min={1} value={form.largeThreshold} onChange={(e) => setForm({ ...form, largeThreshold: Number(e.target.value) })}/></label>
        </div></fieldset>
        <button className="qb-btn" disabled={busy || !form.sources.length}>Create draft campaign</button>
      </form>
    </details>

    {detail && <>
      <section className="qb-card"><h2>{detail.name}</h2>
        <p className="qb-muted">{detail.market} · {detail.curriculum} · <span className="qb-pill">{detail.status}</span> · priority {detail.priority}{detail.generation_paused ? " · generation paused" : ""}{detail.assignment_paused ? " · SME assignment stopped" : ""}</p>
        <div className="qb-content-filters">
          {editable && <button className="qb-btn secondary" disabled={busy} onClick={() => campaignAction("plan", {}, "Distribution plan generated. Review it before launch.")}>Generate distribution plan</button>}
          {detail.status === "RUNNING" && <><button className="qb-btn" disabled={busy || detail.generation_paused} onClick={runJobs}>Run next {detail.max_jobs_per_execution} job(s)</button><button className="qb-btn secondary" disabled={busy} onClick={() => campaignAction("pause", {}, "Generation paused.")}>Pause generation</button></>}
          {detail.status === "PAUSED" && <button className="qb-btn" disabled={busy} onClick={() => campaignAction("resume", {}, "Generation resumed.")}>Resume generation</button>}
          {!["DRAFT", "READY"].includes(detail.status) && (detail.assignment_paused
            ? <button className="qb-btn secondary" disabled={busy} onClick={() => campaignAction("resume_assignment", {}, "SME allocation resumed.")}>Resume review allocation</button>
            : <button className="qb-btn secondary" disabled={busy} onClick={() => campaignAction("stop_assignment", {}, "New SME assignment stopped.")}>Stop new SME assignment</button>)}
          {["DRAFT", "READY", "RUNNING", "PAUSED"].includes(detail.status) && <button className="qb-btn secondary" disabled={busy} onClick={() => window.confirm("Cancel remaining generation jobs? Generated and reviewed questions are kept.") && campaignAction("cancel", {}, "Remaining generation cancelled; existing work kept.")}>Cancel remaining generation</button>}
        </div>
      </section>

      <section className="qb-card"><h2>Estimate before launch</h2>
        <dl className="qb-stat-list">
          <div><dt>Target questions</dt><dd>{detail.estimate.target_questions}</dd></div><div><dt>Planned</dt><dd>{detail.estimate.allocated_questions}</dd></div>
          <div><dt>Indicators</dt><dd>{detail.estimate.indicators}</dd></div><div><dt>Generation jobs</dt><dd>{detail.estimate.expected_jobs} × ≤{detail.estimate.batch_size}</dd></div>
          <div><dt>Executions needed</dt><dd>{detail.estimate.executions_needed}</dd></div><div><dt>Provider / model</dt><dd>{detail.estimate.provider} / {detail.estimate.model}</dd></div>
          <div><dt>Estimated tokens</dt><dd>{detail.estimate.estimated_tokens ?? "Not available"}</dd></div><div><dt>SME reviews</dt><dd>{detail.estimate.estimated_primary_reviews} primary{detail.estimate.estimated_senior_reviews ? ` + ${detail.estimate.estimated_senior_reviews} senior` : ""}</dd></div>
        </dl>
        <p className="qb-small qb-muted">{detail.estimate.cost_note}</p>
        {detail.status === "READY" && <div className="qb-content-filters">
          {detail.estimate.confirmation_required && <label>Type the campaign name to confirm this large campaign<input value={confirm} onChange={(e) => setConfirm(e.target.value)}/></label>}
          <button className="qb-btn" disabled={busy || (detail.estimate.confirmation_required && confirm !== detail.name)} onClick={() => campaignAction("start", { confirm }, "Campaign started. Generation runs in bounded executions.")}>Start campaign</button>
        </div>}
        {detail.status === "DRAFT" && detail.plan_rows > 0 && <p className="qb-error">The plan totals {detail.allocated}, but the target is {detail.target_question_count}. Adjust the rows or sync the target.</p>}
      </section>

      {detail.plan_rows > 0 && <section className="qb-card"><h2>Distribution plan ({detail.plan_rows} rows)</h2>
        {editable && <div className="qb-content-filters"><button className="qb-btn secondary" disabled={busy || !Object.keys(edits).length} onClick={saveAdjustments}>Save adjustments</button>
          <button className="qb-btn secondary" disabled={busy || !Object.keys(edits).length} onClick={() => campaignAction("adjust", { sync_target: true, allocations: Object.entries(edits).map(([id, target_count]) => ({ id, target_count })) }, "Distribution updated and target synced.")}>Save and set target to plan total</button></div>}
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Subject</th><th>Level</th><th>Strand</th><th>Indicator</th><th>Difficulty</th><th>Cognitive</th><th>Type</th><th>Planned</th><th>Target</th></tr></thead>
          <tbody>{detail.plan.map((a: Allocation) => <tr key={a.id}><td>{a.subject_code}</td><td>{a.grade_code}</td><td>{a.strand_title ?? "-"}</td><td title={a.indicator_title}>{a.indicator_code}</td><td>{a.difficulty}</td><td>{a.cognitive_level}</td><td>{a.answer_type}</td><td>{a.planned_count}</td>
            <td>{editable ? <input aria-label={`Target for ${a.indicator_code} ${a.difficulty} ${a.cognitive_level}`} type="number" min={0} style={{ width: "5rem" }} value={edits[a.id] ?? a.target_count} onChange={(e) => setEdits({ ...edits, [a.id]: Number(e.target.value) })}/> : a.target_count}</td></tr>)}</tbody></table></div>
        {detail.plan_rows > detail.plan.length && <p className="qb-small qb-muted">Showing the first {detail.plan.length} rows.</p>}
      </section>}

      {ops && <section className="qb-card"><h2>Campaign operations</h2>
        <dl className="qb-stat-list">{([["Target", "target"], ["Generated", "generated"], ["Generation failed (questions)", "generation_failed_questions"], ["Awaiting review", "awaiting_review"], ["Under review", "under_review"], ["Approved", "approved"], ["Rejected", "rejected"],
          ["Duplicates flagged", "duplicates_flagged"], ["Exact duplicates not accepted", "duplicates_not_accepted"], ["Published", "published"], ["Indicator coverage %", "coverage_percent"], ["Target approved %", "target_percent"]] as const).map(([label, key]) =>
          <div key={key}><dt>{label}</dt><dd>{ops.totals[key] ?? 0}</dd></div>)}</dl>
        {([["By market", ops.by_market, ["market", "generated", "approved"]], ["By subject", ops.by_subject, ["subject", "target", "generated", "approved"]], ["By level", ops.by_level, ["level", "grade", "target", "generated", "approved"]],
          ["Largest coverage gaps (topic / indicator)", ops.indicators, ["subject", "grade", "strand", "indicator", "target", "generated", "approved", "gap"]], ["Source coverage", ops.sources, ["title", "jobs", "completed_jobs"]]] as const).map(([title, rows, cols]) =>
          <div key={title}><h3>{title}</h3><div className="qb-table-wrap"><table className="qb-table"><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{(rows ?? []).map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c] ?? "-")}</td>)}</tr>)}</tbody></table></div></div>)}
      </section>}

      {!editable && <section className="qb-card"><h2>Bulk import and manual authoring</h2>
        <p className="qb-muted">Rows are validated for market, curriculum, indicator, provenance and answer format, then enter SME review. Nothing is published from import.</p>
        <div className="qb-content-filters"><label>Format<select value={importFormat} onChange={(e) => setImportFormat(e.target.value as "csv" | "json")}><option value="csv">CSV</option><option value="json">JSON</option></select></label>
          <label>File<input type="file" accept=".csv,.json,text/csv,application/json" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setImportText(await file.text()); }}/></label></div>
        <label>Or paste rows<textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="indicator_code,subject,grade,question_text,answer_type,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,cognitive_level,source_reference"/></label>
        <button className="qb-btn secondary" disabled={busy || !importText.trim()} onClick={previewImport}>Check rows</button>
        {preview && <><p>{preview.rows.length} row(s); {preview.issues.length} issue(s).</p><ul>{preview.issues.slice(0, 20).map((i, k) => <li key={k}>Row {i.row}: {i.code}</li>)}</ul>
          <button className="qb-btn" disabled={busy || !preview.rows.length || preview.rows.length > 500} onClick={() => submitImport(preview.rows, "IMPORTED")}>Import into review</button></>}
        <h3>Author a question</h3>
        <form className="qb-form" onSubmit={(e) => { e.preventDefault(); void submitImport([manual], "HUMAN_AUTHOR"); }}>
          <div className="qb-content-filters">
            {(["indicator_code", "subject", "grade"] as const).map((k) => <label key={k}>{k.replace("_", " ")}<input value={manual[k] ?? ""} onChange={(e) => setManual({ ...manual, [k]: e.target.value })} required={k !== "grade"}/></label>)}
          </div>
          <label>Question<textarea rows={2} value={manual.question_text ?? ""} onChange={(e) => setManual({ ...manual, question_text: e.target.value })} required/></label>
          <div className="qb-content-filters">{(["option_a", "option_b", "option_c", "option_d"] as const).map((k) => <label key={k}>{k.replace("_", " ").toUpperCase()}<input value={manual[k] ?? ""} onChange={(e) => setManual({ ...manual, [k]: e.target.value })} required/></label>)}
            <label>Correct answer<select value={manual.correct_answer} onChange={(e) => setManual({ ...manual, correct_answer: e.target.value })}>{["A", "B", "C", "D"].map((o) => <option key={o}>{o}</option>)}</select></label>
            <label>Difficulty<select value={manual.difficulty} onChange={(e) => setManual({ ...manual, difficulty: e.target.value })}>{DIFFICULTY.map((o) => <option key={o}>{o}</option>)}</select></label>
            <label>Cognitive level<select value={manual.cognitive_level} onChange={(e) => setManual({ ...manual, cognitive_level: e.target.value })}>{COGNITIVE.map((o) => <option key={o}>{o}</option>)}</select></label></div>
          <label>Explanation<textarea rows={2} value={manual.explanation ?? ""} onChange={(e) => setManual({ ...manual, explanation: e.target.value })} required/></label>
          <label>Source reference (provenance)<input value={manual.source_reference ?? ""} onChange={(e) => setManual({ ...manual, source_reference: e.target.value })} required minLength={3}/></label>
          <button className="qb-btn" disabled={busy}>Submit for review</button>
        </form>
      </section>}

      <section className="qb-card"><h2>Recent campaign events</h2><ul>{detail.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString()} · {e.action}</li>)}</ul></section>
    </>}
  </>;
}
