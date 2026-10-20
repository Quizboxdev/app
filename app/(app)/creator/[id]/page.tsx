"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getCampaignForEdit, publishCampaign, pullBank, setCampaignStatus, setQuestions } from "@/lib/api/challenges";
import { parseQuestionCsv } from "@/lib/challenges/csv";
import type { EditableQuestion, Passage, Prize, StageInfo } from "@/lib/challenges/types";
import StagesPanel from "@/components/challenges/StagesPanel";
import SourcePanel from "@/components/challenges/SourcePanel";
import PrizesPanel from "@/components/challenges/PrizesPanel";
import BrandPanel from "@/components/challenges/BrandPanel";
import AnalyticsPanel from "@/components/challenges/AnalyticsPanel";
import AudiencePanel from "@/components/challenges/AudiencePanel";
import ShareBar from "@/components/challenges/ShareBar";
import { FORMATS, formatOf } from "@/lib/challenges/types";
import { humanize } from "@/lib/format";

// Edit one challenge. Questions can be typed in, pasted as CSV, or snapshotted from the QuizBox bank; they are locked once the challenge goes live.
const GRADES = ["", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "SHS1", "SHS2", "SHS3"];
const TABS = ["Questions", "Rounds", "Share", "Source", "Prizes", "Look and feel", "Results"] as const;
type Tab = (typeof TABS)[number];

export default function CreatorEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tab, setTab] = useState<Tab>("Questions");
  const [campaign, setCampaign] = useState<Record<string, any> | null>(null), [questions, setQ] = useState<EditableQuestion[]>([]), [stages, setStagesState] = useState<StageInfo[]>([]), [prizes, setPrizesState] = useState<Prize[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState(""), [subject, setSubject] = useState(""), [grade, setGrade] = useState(""), [count, setCount] = useState(10), [stage, setStage] = useState(1), [passage, setPassage] = useState<Passage | null>(null);
  const load = useCallback(() => getCampaignForEdit(id).then((r) => { setCampaign(r.campaign); setQ(r.questions); setStagesState(r.stages); setPrizesState(r.prizes); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const draft = campaign?.status === "DRAFT";
  const fmt = FORMATS[formatOf(campaign?.format)], isComp = formatOf(campaign?.format) === "COMPETITION";
  const stageCount: number = campaign?.stage_count ?? 1;
  const needed = (g: number) => stages.find((s) => s.stage_no === g)?.question_count ?? campaign?.question_count ?? 0;
  const have = (g: number) => questions.filter((q) => (q.stage_no ?? 1) === g).length;
  const missing = Array.from({ length: stageCount }, (_, i) => i + 1).reduce((n, g) => n + Math.max(0, needed(g) - have(g)), 0);
  const onError = useCallback((m: string) => setError(m), []);

  async function run(work: () => Promise<string | void>) {
    setBusy(true); setError(""); setNotice("");
    try { const msg = await work(); if (msg) setNotice(msg); await load(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  const addFromCsv = () => run(async () => {
    const parsed = parseQuestionCsv(csv);
    if (parsed.errors.length) throw new Error(parsed.errors.slice(0, 3).join(" "));
    if (!passage && parsed.questions.some((q) => q.source_quote)) throw new Error("These questions have source quotes. Pick the passage they come from on the Source tab first.");
    if (!passage && campaign?.category === "book") throw new Error("Pick the passage these questions come from on the Source tab first.");
    const added = parsed.questions.map((q) => ({ ...q, stage_no: stage, ...(passage ? { source_chunk_id: passage.id } : {}) }));
    const r = await setQuestions(id, [...questions, ...added]); setCsv(""); return `${r.count} questions saved.`;
  });
  const updateQ = (i: number, patch: Partial<EditableQuestion>) => setQ((qs) => qs.map((q, k) => (k === i ? { ...q, ...patch } : q)));

  if (!campaign) return <div className="qb-card" role="status">{error || "Loading…"}</div>;
  return (
    <>
      <div className="qb-page-head"><div><h1>{campaign.title}</h1><p>{humanize(campaign.status)}{campaign.visibility === "PRIVATE" ? ` · access code ${campaign.access_code}` : ""}{missing > 0 && draft ? ` · ${missing} more question${missing === 1 ? "" : "s"} needed` : ""}</p></div>
        <div><Link className="qb-link" href={isComp ? "/creator?format=competition" : "/creator"}>All {fmt.plural}</Link>{campaign.status !== "DRAFT" && <> · <Link className="qb-link" href={`${fmt.base}/${campaign.slug}`}>Public page</Link></>}</div></div>
      {campaign.moderation_state && campaign.moderation_state !== "OK" && <div className="qb-card qb-error" role="alert"><strong>{campaign.moderation_state === "TAKEN_DOWN" ? "This challenge was taken down." : "This challenge is hidden while reports are reviewed."}</strong>{campaign.moderation_note ? ` ${campaign.moderation_note}` : ""} Players cannot see it.</div>}
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {notice && <div className="qb-card" role="status">{notice}</div>}

      <div className="qb-card qb-card-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {draft && <button className="qb-btn" disabled={busy || missing > 0} onClick={() => run(async () => { await publishCampaign(id); return `The ${fmt.noun} is live.`; })}>Publish</button>}
        {campaign.status === "PAUSED" && <button className="qb-btn" disabled={busy} onClick={() => run(async () => { await publishCampaign(id); return `The ${fmt.noun} is live again.`; })}>Resume</button>}
        {campaign.status === "LIVE" && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => run(async () => { await setCampaignStatus(id, "PAUSED"); })}>Pause</button>}
        {["LIVE", "PAUSED"].includes(campaign.status) && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => { if (window.confirm(`End this ${fmt.noun}? Nobody can play it afterwards, and the leaderboard stays.`)) void run(async () => { await setCampaignStatus(id, "COMPLETED"); }); }}>End {fmt.noun}</button>}
        {["DRAFT", "COMPLETED", "PAUSED"].includes(campaign.status) && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => { if (window.confirm(`Archive this ${fmt.noun}?`)) void run(async () => { await setCampaignStatus(id, "ARCHIVED"); }); }}>Archive</button>}
      </div>

      <div role="tablist" aria-label="Sections" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.filter((t) => t !== "Rounds" || isComp || stageCount > 1).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`qb-btn ${tab === t ? "" : "qb-btn-secondary"}`} onClick={() => setTab(t)}>{t}</button>)}
      </div>

      {tab === "Questions" && (
        <>
          {stageCount > 1 && <div className="qb-card"><strong>Rounds:</strong> {Array.from({ length: stageCount }, (_, i) => i + 1).map((g) => <span key={g} style={{ marginRight: 12 }}>Round {g}: {have(g)}/{needed(g)}</span>)}</div>}
          {draft && (
            <>
              <div className="qb-card qb-form">
                <h2>Add questions</h2>
                {stageCount > 1 && <label className="qb-field">Add to round<select value={stage} onChange={(e) => setStage(Number(e.target.value))}>{Array.from({ length: stageCount }, (_, i) => i + 1).map((g) => <option key={g} value={g}>Round {g}{stages.find((s) => s.stage_no === g) ? `: ${stages.find((s) => s.stage_no === g)!.title}` : ""}</option>)}</select></label>}
                <h3>From the QuizBox bank</h3>
                <p className="qb-muted">Random approved questions are copied in, so later changes to the bank never alter your challenge. Use the subject code, for example MATH or ENG.</p>
                <div className="qb-grid cols-3">
                  <label className="qb-field">Subject code<input value={subject} onChange={(e) => setSubject(e.target.value.trim().toUpperCase())} placeholder="MATH" /></label>
                  <label className="qb-field">Grade<select value={grade} onChange={(e) => setGrade(e.target.value)}>{GRADES.map((g) => <option key={g} value={g}>{g || "Any"}</option>)}</select></label>
                  <label className="qb-field">How many<input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
                </div>
                <button className="qb-btn" disabled={busy || !subject} onClick={() => run(async () => { const r = await pullBank(id, subject, grade || null, count, stage); return r.added ? `${r.added} questions added (${r.total} in total).` : "No more matching questions were found."; })}>Add from the bank</button>
              </div>
              <div className="qb-card qb-form">
                <h3>Paste your own questions</h3>
                <p className="qb-muted">One question per line: question, option A, B, C, D, correct letter (A to D), explanation (optional){campaign.category === "book" ? ", source quote (word for word from the passage)" : ", source quote (optional)"}. Separate with commas or tabs; put a field in double quotes if it contains a comma. Two or three options also work.</p>
                {passage ? <p role="status"><strong>Citing passage {passage.position}</strong>{passage.heading ? ` (${passage.heading})` : ""}. <button className="qb-link-btn" onClick={() => setPassage(null)}>Clear</button></p> : campaign.category === "book" ? <p className="qb-muted">Pick a passage on the Source tab first: every question in a book challenge must cite one.</p> : null}
                <textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'What is 7 x 8?,54,56,58,64,B,7 x 8 = 56'} />
                <button className="qb-btn" disabled={busy || !csv.trim()} onClick={addFromCsv}>Add these questions</button>
              </div>
            </>
          )}
          <div className="qb-card">
            <h2>Questions ({questions.length})</h2>
            {questions.length === 0 ? <p className="qb-muted">None yet.</p> : (
              <ol className="qb-list">{questions.map((q, i) => (
                <li key={q.id ?? i}>
                  {draft ? <input aria-label={`Question ${i + 1}`} style={{ width: "100%" }} value={q.question_text} onChange={(e) => updateQ(i, { question_text: e.target.value })} /> : <strong>{q.question_text}</strong>}
                  {stageCount > 1 && <span className="qb-muted qb-small"> · Round {q.stage_no ?? 1}</span>}
                  {q.source_quote && <span className="qb-muted qb-small"> · cites “{q.source_quote.length > 60 ? `${q.source_quote.slice(0, 60)}…` : q.source_quote}”</span>}
                  {draft && <button className="qb-link-btn" disabled={busy} onClick={() => run(async () => { await setQuestions(id, questions.filter((_, k) => k !== i)); })}>Remove</button>}
                  <ul className="qb-muted qb-small">{q.options.map((o, k) => <li key={k} style={k === q.correct_index ? { fontWeight: 700 } : undefined}>{String.fromCharCode(65 + k)}. {o}{k === q.correct_index ? " (correct)" : ""}</li>)}</ul>
                </li>))}</ol>
            )}
            {draft && questions.length > 0 && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => run(async () => { await setQuestions(id, questions); return "Changes saved."; })}>Save changes to wording</button>}
            {draft && questions.length > 0 && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => { if (window.confirm("Remove all questions?")) void run(async () => { await setQuestions(id, []); }); }}>Clear all</button>}
          </div>
        </>
      )}
      {tab === "Share" && <>
        {campaign.status === "LIVE" && campaign.visibility !== "PRIVATE" && !campaign.audience_class_id && !campaign.audience_institution_id
          ? <ShareBar slug={campaign.slug} title={campaign.title} format={campaign.format} />
          : campaign.status === "LIVE" && campaign.visibility === "PRIVATE" ? <ShareBar slug={campaign.slug} title={campaign.title} format={campaign.format} code={campaign.access_code} />
          : <div className="qb-card" role="note">{campaign.audience_class_id || campaign.audience_institution_id ? `This ${fmt.noun} is for one class or school, so there is no public link to share. Those people are told when you publish.` : `Sharing opens when the ${fmt.noun} is live.`}</div>}
        <AudiencePanel id={id} draft={!!draft} format={campaign.format} current={{ class: campaign.audience_class_id, institution: campaign.audience_institution_id }} onChanged={() => void load()} onError={onError} />
      </>}
      {tab === "Rounds" && <StagesPanel id={id} draft={!!draft} stages={stages} base={{ question_count: campaign.question_count, time_limit_seconds: campaign.time_limit_seconds }} onChanged={() => void load()} onError={onError} />}
      {tab === "Source" && <SourcePanel campaignId={id} reader={{ enabled: !!campaign.reader_enabled, closes: campaign.reader_closes === "START" ? "START" : "END" }} hasOpeningTime={!!campaign.starts_at} onChanged={() => void load()} picked={passage} onPick={(p) => { setPassage(p); if (p) setNotice("Passage selected. Go to the Questions tab to paste questions that cite it."); }} onError={onError} />}
      {tab === "Prizes" && <PrizesPanel id={id} status={campaign.status} finalized={!!campaign.finalized_at} prizes={prizes} onChanged={() => void load()} onError={onError} />}
      {tab === "Look and feel" && <BrandPanel id={id} brand={campaign.brand ?? {}} onChanged={() => void load()} onError={onError} />}
      {tab === "Results" && <AnalyticsPanel id={id} onError={onError} />}
    </>
  );
}
