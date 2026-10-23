"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORIES, createRequest, type Category } from "@/lib/api/support";
import { AttachPicker } from "@/components/support/parts";

// A new support request. The Help centre and other screens link here with ?context=... (the guide or page the person came from), so support knows where they were stuck.
function NewRequest() {
  const router = useRouter(), params = useSearchParams();
  const context = (params.get("context") ?? "").slice(0, 300), wanted = params.get("category") as Category | null;
  const [category, setCategory] = useState<Category>(wanted && wanted in CATEGORIES ? wanted : "other"), [subject, setSubject] = useState(""), [message, setMessage] = useState(""), [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const r = await createRequest(category, subject.trim(), message.trim(), context, files);
      router.replace(`/support/${r.id}${r.filesFailed ? "?files=failed" : ""}`);
    } catch (err: any) { setError(err.message); setBusy(false); }
  }
  return (
    <>
      <div className="qb-page-head"><div><h1>Send a support request</h1><p>Tell us what happened and what you expected. A screenshot helps. <Link className="qb-link" href="/support">Back to your requests</Link>.</p></div></div>
      <form className="qb-card qb-form" onSubmit={submit}>
        {context && <p className="qb-muted qb-small">About: {context}</p>}
        <label className="qb-field">What is it about?<select value={category} onChange={(e) => setCategory(e.target.value as Category)}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="qb-field">A short title<input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} required minLength={3} placeholder="e.g. My class code says it has expired" /></label>
        <label className="qb-field">Tell us more<textarea rows={7} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={5000} required minLength={10} placeholder="What happened? What did you try? For a payment, include the date and the reference from your receipt." /></label>
        <AttachPicker files={files} onChange={setFiles} disabled={busy} />
        {error && <p role="alert" className="qb-error">{error}</p>}
        <div><button className="qb-btn" disabled={busy || subject.trim().length < 3 || message.trim().length < 10}>{busy ? "Sending…" : "Send request"}</button></div>
        <p className="qb-muted qb-small">Please do not send passwords. We never ask for your password.</p>
      </form>
    </>
  );
}
export default function NewRequestPage() { return <Suspense fallback={<p className="qb-muted">Loading…</p>}><NewRequest /></Suspense>; }
