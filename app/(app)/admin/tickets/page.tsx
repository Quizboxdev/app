"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { adminRequests, CATEGORIES, deleteRequest, requestDetail, setRequest, staffReply, STATUS, type AdminRow, type RequestDetail, type Status } from "@/lib/api/support";
import { AttachPicker, StatusChip, Thread, when } from "@/components/support/parts";
import ExportLink from "@/components/admin/ExportLink";

// Support queue for owners, admins, super admins and support staff. Pick a request, read the conversation, answer the person, or leave an internal note only staff see. A public answer is emailed
// (a signed-in person is told there is a reply; a visitor gets the text). Resolved or closed requests can be deleted with their files, as the Privacy Notice's retention period requires.
const FILTERS: { id: string; label: string }[] = [{ id: "", label: "All" }, { id: "open", label: "Open" }, { id: "waiting_for_user", label: "Waiting for the person" }, { id: "resolved", label: "Resolved" }, { id: "closed", label: "Closed" }];

function Panel({ id, onChanged, onError }: { id: string; onChanged: () => void; onError: (m: string) => void }) {
  const [d, setD] = useState<RequestDetail | null>(null), [body, setBody] = useState(""), [internal, setInternal] = useState(false), [status, setStatus] = useState<Status | "">(""), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState("");
  const load = useCallback(() => { requestDetail(id).then(setD).catch((e) => onError(e.message)); }, [id, onError]);
  useEffect(() => { setD(null); load(); }, [load]);
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); onError(""); try { await fn(); } catch (e: any) { onError(e.message); } setBusy(""); };
  if (!d) return <div className="qb-card"><p className="qb-muted">Loading…</p></div>;
  const r = d.request;
  return (
    <div className="qb-card" style={{ display: "grid", gap: 12 }}>
      <div>
        <h2 style={{ margin: 0 }}>{r.subject}</h2>
        <p className="qb-muted qb-small" style={{ margin: "4px 0 0" }}>{r.reference} · {CATEGORIES[r.category]} · {r.requester_name} &lt;{r.requester_email}&gt; · {r.source === "contact_form" ? "visitor (contact form)" : "signed in"} · opened {when(r.created_at)}{r.context ? ` · from: ${r.context}` : ""}</p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label className="qb-field" style={{ margin: 0 }}>Status<select value={r.status} disabled={!!busy} onChange={(e) => void run("set", async () => { await setRequest(id, e.target.value as Status, r.priority, r.assigned_to); load(); onChanged(); })}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="qb-field" style={{ margin: 0 }}>Priority<select value={r.priority} disabled={!!busy} onChange={(e) => void run("set", async () => { await setRequest(id, r.status, e.target.value, r.assigned_to); load(); onChanged(); })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
        {(r.status === "resolved" || r.status === "closed") && <button className="qb-btn ghost" disabled={!!busy} onClick={() => { if (window.confirm("Delete this request and its files for good? This cannot be undone.")) void run("delete", async () => { await deleteRequest(id); onChanged(); }); }}>Delete request and files</button>}
        {r.category === "payment" && <Link className="qb-btn qb-btn-secondary" href="/admin/refunds">Open Refunds</Link>}
      </div>
      <Thread messages={d.messages} looseFiles={d.loose_files} staffView onError={onError} />
      <form onSubmit={(e) => { e.preventDefault(); void run("reply", async () => { await staffReply(id, body.trim(), internal, status || null, files); setBody(""); setFiles([]); setStatus(""); load(); onChanged(); }); }} className="qb-form" style={{ display: "grid", gap: 8 }}>
        <label className="qb-field">{internal ? "Internal note (the person never sees this)" : "Your answer to the person"}<textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={5000} required /></label>
        <AttachPicker files={files} onChange={setFiles} disabled={!!busy || internal} />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label><input type="checkbox" checked={internal} onChange={(e) => { setInternal(e.target.checked); if (e.target.checked) setFiles([]); }} /> Internal note only</label>
          {!internal && <label>Then set status to <select value={status} onChange={(e) => setStatus(e.target.value as Status | "")}><option value="">Waiting for the person</option><option value="resolved">Resolved</option><option value="open">Keep open</option><option value="closed">Closed</option></select></label>}
          <button className="qb-btn" disabled={!!busy || !body.trim()}>{busy === "reply" ? "Sending…" : internal ? "Save note" : "Send answer"}</button>
        </div>
      </form>
    </div>
  );
}

export default function AdminTicketsPage() {
  const [filter, setFilter] = useState(""), [rows, setRows] = useState<AdminRow[] | null>(null), [sel, setSel] = useState(""), [error, setError] = useState("");
  const load = useCallback(() => { adminRequests(filter || null).then((r) => { setRows(r); setSel((s) => (r.some((x) => x.id === s) ? s : "")); }).catch((e) => { setError(e.message); setRows([]); }); }, [filter]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <div className="qb-page-head"><div><h1>Support requests</h1><p>Answer people who asked for help in the app or through the contact form. Payment questions: use <Link className="qb-link" href="/admin/refunds">Refunds</Link>.</p></div><ExportLink dataset="support_requests" /></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <nav aria-label="Filter by status" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{FILTERS.map((f) => <button key={f.id} className={`qb-btn${filter === f.id ? "" : " qb-btn-secondary"}`} onClick={() => { setFilter(f.id); setSel(""); }}>{f.label}</button>)}</nav>
      <div className="qb-card">
        {rows === null ? <p className="qb-muted">Loading…</p> : rows.length === 0 ? <p className="qb-muted">No requests here.</p> : (
          <table className="qb-table"><thead><tr><th>Reference</th><th>About</th><th>From</th><th>Status</th><th>Priority</th><th>Last update</th><th /></tr></thead><tbody>
            {rows.map((r) => <tr key={r.id} style={r.id === sel ? { outline: "2px solid #2563eb" } : undefined}><td>{r.reference}</td><td>{r.subject}<span className="qb-muted qb-small" style={{ display: "block" }}>{CATEGORIES[r.category]} · {r.messages} message{r.messages === 1 ? "" : "s"}</span></td><td>{r.requester}<span className="qb-muted qb-small" style={{ display: "block" }}>{r.signed_in ? "signed in" : "visitor"}</span></td><td><StatusChip status={r.status} /></td><td>{r.priority}</td><td>{when(r.last_message_at)}</td><td><button className="qb-btn qb-btn-secondary" onClick={() => setSel(r.id)}>Open</button></td></tr>)}
          </tbody></table>
        )}
      </div>
      {sel && <Panel key={sel} id={sel} onChanged={() => { load(); }} onError={setError} />}
    </>
  );
}
