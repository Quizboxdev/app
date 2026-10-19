"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getCampaignForEdit, publishCampaign, pullBank, setCampaignStatus, setQuestions } from "@/lib/api/challenges";
import { parseQuestionCsv } from "@/lib/challenges/csv";
import type { EditableQuestion } from "@/lib/challenges/types";

// Edit one challenge. Questions can be typed in, pasted as CSV, or snapshotted from the QuizBox bank. They are locked once the challenge goes live.
const GRADES = ["", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "SHS1", "SHS2", "SHS3"];
export default function CreatorEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [campaign, setCampaign] = useState<Record<string, any> | null>(null), [questions, setQ] = useState<EditableQuestion[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState(""), [subject, setSubject] = useState(""), [grade, setGrade] = useState(""), [count, setCount] = useState(10);
  const load = useCallback(() => getCampaignForEdit(id).then((r) => { setCampaign(r.campaign); setQ(r.questions); }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  const draft = campaign?.status === "DRAFT";

  async function run(work: () => Promise<string | void>) {
    setBusy(true); setError(""); setNotice("");
    try { const msg = await work(); if (msg) setNotice(msg); await load(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  const addFromCsv = () => run(async () => {
    const parsed = parseQuestionCsv(csv);
    if (parsed.errors.length) throw new Error(parsed.errors.slice(0, 3).join(" "));
    const r = await setQuestions(id, [...questions, ...parsed.questions]); setCsv(""); return `${r.count} questions saved.`;
  });
  const updateQ = (i: number, patch: Partial<EditableQuestion>) => setQ((qs) => qs.map((q, k) => (k === i ? { ...q, ...patch } : q)));

  if (!campaign) return <div className="qb-card" role="status">{error || "Loading…"}</div>;
  return (
    <>
      <div className="qb-page-head"><div><h1>{campaign.title}</h1><p>{campaign.status} · {questions.length} of {campaign.question_count} questions needed{campaign.visibility === "PRIVATE" ? ` · access code ${campaign.access_code}` : ""}</p></div>
        <div><Link className="qb-link" href="/creator">All challenges</Link>{campaign.status !== "DRAFT" && <> · <Link className="qb-link" href={`/challenges/${campaign.slug}`}>Public page</Link></>}</div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {notice && <div className="qb-card" role="status">{notice}</div>}

      <div className="qb-card qb-card-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {draft && <button className="qb-btn" disabled={busy || questions.length < campaign.question_count} onClick={() => run(async () => { await publishCampaign(id); return "The challenge is live."; })}>Publish</button>}
        {campaign.status === "PAUSED" && <button className="qb-btn" disabled={busy} onClick={() => run(async () => { await publishCampaign(id); return "The challenge is live again."; })}>Resume</button>}
        {campaign.status === "LIVE" && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => run(async () => { await setCampaignStatus(id, "PAUSED"); })}>Pause</button>}
        {["LIVE", "PAUSED"].includes(campaign.status) && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => { if (window.confirm("End this challenge? Nobody can play it afterwards, and the leaderboard stays.")) void run(async () => { await setCampaignStatus(id, "COMPLETED"); }); }}>End challenge</button>}
        {["DRAFT", "COMPLETED", "PAUSED"].includes(campaign.status) && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => { if (window.confirm("Archive this challenge?")) void run(async () => { await setCampaignStatus(id, "ARCHIVED"); }); }}>Archive</button>}
        {draft && questions.length < campaign.question_count && <span className="qb-muted">Add {campaign.question_count - questions.length} more question{campaign.question_count - questions.length === 1 ? "" : "s"} to publish.</span>}
      </div>

      {draft && (
        <>
          <div className="qb-card qb-form">
            <h2>Take questions from the QuizBox bank</h2>
            <p className="qb-muted">Random approved questions are copied into your challenge, so later changes to the bank never alter it. Use the subject code, for example MATH or ENG.</p>
            <div className="qb-grid cols-3">
              <label className="qb-field">Subject code<input value={subject} onChange={(e) => setSubject(e.target.value.trim().toUpperCase())} placeholder="MATH" /></label>
              <label className="qb-field">Grade<select value={grade} onChange={(e) => setGrade(e.target.value)}>{GRADES.map((g) => <option key={g} value={g}>{g || "Any"}</option>)}</select></label>
              <label className="qb-field">How many<input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
            </div>
            <button className="qb-btn" disabled={busy || !subject} onClick={() => run(async () => { const r = await pullBank(id, subject, grade || null, count); return r.added ? `${r.added} questions added (${r.total} in total).` : "No more matching questions were found."; })}>Add from the bank</button>
          </div>
          <div className="qb-card qb-form">
            <h2>Paste your own questions</h2>
            <p className="qb-muted">One question per line: question, option A, option B, option C, option D, correct letter (A to D), explanation (optional). Separate with commas or tabs; put a field in double quotes if it contains a comma. Two or three options also work.</p>
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
              {draft && <button className="qb-link-btn" disabled={busy} onClick={() => run(async () => { await setQuestions(id, questions.filter((_, k) => k !== i)); })}>Remove</button>}
              <ul className="qb-muted qb-small">{q.options.map((o, k) => <li key={k} style={k === q.correct_index ? { fontWeight: 700 } : undefined}>{String.fromCharCode(65 + k)}. {o}{k === q.correct_index ? " (correct)" : ""}</li>)}</ul>
            </li>))}</ol>
        )}
        {draft && questions.length > 0 && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => run(async () => { await setQuestions(id, questions); return "Changes saved."; })}>Save changes to wording</button>}
        {draft && questions.length > 0 && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => { if (window.confirm("Remove all questions?")) void run(async () => { await setQuestions(id, []); }); }}>Clear all</button>}
      </div>
    </>
  );
}
