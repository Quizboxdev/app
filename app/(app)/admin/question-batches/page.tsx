"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, RotateCcw, Eye, Trash2 } from "lucide-react";
import { approveBatch, discardBatch, listBatchApprovals, listLoadBatches, previewBatch, revokeBatchApproval, type BatchApproval, type BatchPreview, type LoadBatch } from "@/lib/api/owner";
import { formatDate } from "@/lib/format";
import ExportLink from "@/components/admin/ExportLink";
import Link from "next/link";
import { batchView } from "@/lib/question-loading/queue";

// Owner-approved batches (the interim review step until reviewers are onboarded). Read the random sample, tick each question you checked,
// then approve. Approved questions are labelled OWNER_BATCH, never "reviewed by subject experts", and one click revokes the whole batch.
export default function QuestionBatchesPage() {
  const [batches, setBatches] = useState<LoadBatch[] | null>(null);
  const [approvals, setApprovals] = useState<BatchApproval[]>([]);
  const [open, setOpen] = useState<string>("");
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [read, setRead] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const load = () => Promise.all([listLoadBatches(), listBatchApprovals()]).then(([b, a]) => { setBatches(b); setApprovals(a); }).catch((e) => { setError(e.message); setBatches([]); });
  useEffect(() => { void load(); }, []);
  const activeApproval = (batchId: string) => approvals.find((a) => a.batch_id === batchId && a.status === "ACTIVE");

  async function openBatch(id: string) {
    setOpen(id); setPreview(null); setRead([]); setNote(""); setError(""); setDone("");
    try { setPreview(await previewBatch(id)); } catch (e: any) { setError(e.message); }
  }
  async function reshuffleSample() { if (open) await openBatch(open); }
  async function approve() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const r = await approveBatch(preview.batch_id, note, read.length);
      setDone(`Approved ${r.approved} questions (${r.skipped} left in review because they failed validation). They are live for learners now.`);
      setOpen(""); setPreview(null); await load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  async function revoke(a: BatchApproval) {
    const why = window.prompt("Why are you revoking this approval? (at least 10 characters)");
    if (!why) return;
    setBusy(true); setError("");
    try { const r = await revokeBatchApproval(a.id, why); setDone(`${r.returned_to_review} questions taken offline and returned to review.`); await load(); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  // A batch that cannot be finished, or is not wanted, is withdrawn here instead of sitting in review for ever. Its file can then be loaded again.
  async function discard(b: LoadBatch) {
    const why = window.prompt(`Discard "${b.file_name}"? Its ${b.rows_loaded} saved questions are withdrawn from review (nothing is deleted) and the file can be loaded again.

Why? (at least 10 characters)`);
    if (!why) return;
    setBusy(true); setError("");
    try { const r = await discardBatch(b.id, why); setDone(`Discarded. ${r.withdrawn} questions were withdrawn. The file can be loaded again from Load questions.`); await load(); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  const need = preview?.min_sample_required ?? 20;
  const canApprove = useMemo(() => !!preview && read.length >= need && note.trim().length >= 10 && preview.would_approve > 0, [preview, read, need, note]);

  return (
    <>
      <div className="qb-page-head"><div><h1>Question batches</h1>
        <p>Read a random sample of each loaded batch, then approve it to make its questions available to learners. You can revoke any approval.</p></div><ExportLink dataset="question_batches" /></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status"><CheckCircle2 size={16} aria-hidden="true" /> {done}</div>}

      <section className="qb-card">
        <h2>Loaded batches</h2>
        {batches === null ? <p className="qb-muted">Loading…</p> : !batches.length ? <p className="qb-muted">No batches loaded yet. Load a file on Load Questions first.</p> :
          <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>File</th><th>Loaded</th><th>Status</th><th>Approval</th><th>Action</th></tr></thead><tbody>
            {batches.map((b) => { const a = activeApproval(b.id), v = batchView(b, Boolean(a)); return <tr key={b.id}>
              <td>{b.file_name}<div className="qb-small qb-muted">{formatDate(b.created_at)}</div></td>
              <td>{v.progress}{b.rows_rejected ? ` (${b.rows_rejected} rejected)` : ""}</td>
              <td><span className={`qb-pill${v.tone === "ok" ? " success" : ""}`}>{v.label}</span><div className="qb-small qb-muted">{v.hint}</div></td>
              <td>{a ? <span className="qb-pill success">Approved: {a.questions_approved} live</span> : <span className="qb-pill">Not approved</span>}</td>
              <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {v.action === "revoke" && a && <button className="qb-btn secondary" disabled={busy} onClick={() => void revoke(a)}><RotateCcw size={14} aria-hidden="true" /> Revoke</button>}
                {v.action === "review" && <button className="qb-btn" disabled={busy} onClick={() => void openBatch(b.id)}><Eye size={14} aria-hidden="true" /> Review sample</button>}
                {v.action === "continue" && <Link className="qb-btn" href="/admin/question-loading">Continue loading</Link>}
                {["review", "continue", "discard"].includes(v.action) && <button className="qb-btn secondary" disabled={busy} onClick={() => void discard(b)}><Trash2 size={14} aria-hidden="true" /> Discard</button>}
                {v.action === "none" && <span className="qb-muted qb-small">Nothing more to do</span>}
              </td></tr>; })}
          </tbody></table></div>}
      </section>

      {open && <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="qb-sample">
        <h2 id="qb-sample">Sample from {preview?.file ?? "batch"}</h2>
        {!preview ? <p className="qb-muted">Drawing a random sample…</p> : <>
          <p className="qb-muted">{preview.questions_found} questions in this batch; {preview.would_approve} pass validation and will go live. Read each question below and tick it when you are satisfied
            the marked answer is certainly right and each wrong option is a believable mistake. You need {need} ticks.</p>
          <ol className="qb-task-list">
            {preview.sample.map((q, i) => <li key={q.id} style={{ marginBottom: 12 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input type="checkbox" checked={read.includes(q.id)} onChange={(e) => setRead(e.target.checked ? [...read, q.id] : read.filter((x) => x !== q.id))} style={{ marginTop: 4 }} />
                <span><strong>{i + 1}. {q.question}</strong> <span className="qb-muted qb-small">({q.difficulty ?? "?"})</span>
                  <span style={{ display: "block", marginTop: 4 }}>{(["a", "b", "c", "d"] as const).filter((k) => q[k]).map((k) =>
                    <span key={k} style={{ display: "block", fontWeight: q.correct === k.toUpperCase() ? 700 : 400, color: q.correct === k.toUpperCase() ? "var(--green, #15803d)" : undefined }}>
                      {k.toUpperCase()}. {q[k]}{q.correct === k.toUpperCase() ? "  ✓ marked correct" : ""}</span>)}</span></span>
              </label></li>)}
          </ol>
          <p className="qb-small">Ticked: {read.length} of {need} needed. <button type="button" className="qb-btn secondary" onClick={() => void reshuffleSample()} disabled={busy}>Draw a different sample</button></p>
          <label style={{ display: "block", marginTop: 8 }}>Approval note (what you checked)
            <textarea className="qb-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Read 20 questions; answers correct; options plausible." style={{ width: "100%" }} /></label>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="qb-btn" disabled={!canApprove || busy} onClick={() => void approve()}><CheckCircle2 size={14} aria-hidden="true" /> {busy ? "Approving…" : `Approve and publish ${preview.would_approve}`}</button>
            <button className="qb-btn secondary" onClick={() => { setOpen(""); setPreview(null); }}>Close</button>
          </div>
        </>}
      </section>}
    </>
  );
}
