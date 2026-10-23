"use client";

import { Suspense, use, useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CATEGORIES, replyToRequest, requestDetail, type RequestDetail } from "@/lib/api/support";
import { AttachPicker, StatusChip, Thread, when } from "@/components/support/parts";

// One request: the conversation, files, and a box to reply. A closed request cannot be answered; open a new one instead.
function Detail({ id }: { id: string }) {
  const params = useSearchParams();
  const [d, setD] = useState<RequestDetail | null>(null), [error, setError] = useState(""), [body, setBody] = useState(""), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false);
  const load = useCallback(() => { requestDetail(id).then(setD).catch((e) => setError(e.message)); }, [id]);
  useEffect(() => { load(); }, [load]);
  async function send(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await replyToRequest(id, body.trim(), files); setBody(""); setFiles([]); load(); } catch (err: any) { setError(err.message); }
    setBusy(false);
  }
  if (error && !d) return <div className="qb-card qb-error" role="alert">{error} <Link className="qb-link" href="/support">Back to your requests</Link></div>;
  if (!d) return <p className="qb-muted">Loading…</p>;
  const r = d.request, closed = r.status === "closed";
  return (
    <>
      <div className="qb-page-head"><div><h1>{r.subject}</h1><p>{r.reference} · {CATEGORIES[r.category]} · opened {when(r.created_at)} · <StatusChip status={r.status} /> · <Link className="qb-link" href="/support">All requests</Link></p></div></div>
      {params.get("files") === "failed" && <div className="qb-card" role="status">Your request was sent, but we could not save the files. You can attach them again below.</div>}
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <Thread messages={d.messages} looseFiles={d.loose_files} onError={setError} />
      {closed ? <div className="qb-card"><p>This request is closed. <Link className="qb-link" href={`/support/new?context=${encodeURIComponent(`Follow-up to ${r.reference}`)}`}>Open a new request</Link> if you still need help.</p></div> : (
        <form className="qb-card qb-form" onSubmit={send}>
          <label className="qb-field">{r.status === "waiting_for_user" ? "Your reply" : "Add to this request"}<textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} required /></label>
          <AttachPicker files={files} onChange={setFiles} disabled={busy} />
          <div><button className="qb-btn" disabled={busy || !body.trim()}>{busy ? "Sending…" : "Send reply"}</button></div>
        </form>
      )}
    </>
  );
}
export default function RequestPage({ params }: { params: Promise<{ id: string }> }) { const { id } = use(params); return <Suspense fallback={<p className="qb-muted">Loading…</p>}><Detail id={id} /></Suspense>; }
