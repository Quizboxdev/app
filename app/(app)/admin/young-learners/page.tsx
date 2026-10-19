"use client";

import { useEffect, useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { eraseManagedLearner, erasureQueue, findManagedLearner, managedOverview, reassignManaged, setAutoErase, type FoundLearner, type ManagedOverview, type QueuedLearner } from "@/lib/api/erasure";
import { formatDate } from "@/lib/format";

// Owner: erase a young learner's personal data on a written request from a guardian or school, or in one pass for accounts past the 12-month retention
// period. Erasing removes the first name, username and school; learning records stay in a form that no longer identifies the child. It cannot be undone.
export default function YoungLearnersAdminPage() {
  const [queue, setQueue] = useState<QueuedLearner[] | null>(null), [username, setUsername] = useState(""), [found, setFound] = useState<FoundLearner[] | null>(null);
  const [overview, setOverview] = useState<ManagedOverview | null>(null), [fromEmail, setFromEmail] = useState(""), [toEmail, setToEmail] = useState(""), [moveClasses, setMoveClasses] = useState(true);
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");

  const loadQueue = () => erasureQueue().then(setQueue).catch((e) => { setError(e.message); setQueue([]); });
  const loadOverview = () => managedOverview().then(setOverview).catch((e) => setError(e.message));
  useEffect(() => { void loadQueue(); void loadOverview(); }, []);
  async function toggleAuto(on: boolean) {
    if (on && !window.confirm("Switch on automatic erasure? Every week, ended accounts past the retention period will have their personal data erased for good, with no further confirmation. Only switch this on once counsel has confirmed the retention rule.")) return;
    setBusy(true); setError(""); try { await setAutoErase(on); await loadOverview(); setDone(on ? "Automatic erasure is on." : "Automatic erasure is off."); } catch (e: any) { setError(e.message); } setBusy(false);
  }
  async function reassign() {
    if (!window.confirm(`Move every young learner of ${fromEmail.trim()}${moveClasses ? " and their classes" : ""} to ${toEmail.trim()}?`)) return;
    setBusy(true); setError(""); setDone("");
    try { const r = await reassignManaged(fromEmail, toEmail, moveClasses); setDone(`Moved ${r.learners} learner${r.learners === 1 ? "" : "s"} and ${r.classes} class${r.classes === 1 ? "" : "es"}.`); setFromEmail(""); setToEmail(""); void loadOverview(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }


  async function find() { setError(""); setDone(""); try { setFound(await findManagedLearner(username)); } catch (e: any) { setError(e.message); } }
  async function erase(l: { user_id: string; first_name: string; username: string }, why: string) {
    if (!window.confirm(`Erase ${l.first_name} (${l.username})? Their name, username and school are removed for good. This cannot be undone.`)) return;
    setBusy(true); setError(""); setDone("");
    try { const r = await eraseManagedLearner(l.user_id, why); setDone(r.already ? `${l.username} was already erased.` : `${l.username} erased.`); setFound(null); setReason(""); void loadQueue(); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  const queuedReason = `Retention period over: ended more than ${overview?.retention_months ?? 12} months ago`;

  return (
    <>
      <div className="qb-page-head"><div><h1>Young learners: privacy requests</h1><p>Erase a child&apos;s personal data when a guardian or school asks in writing, or when the 12-month retention period has passed.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {done && <div className="qb-card" role="status">{done}</div>}

      <section className="qb-card">
        <h2>All schools</h2>
        {overview === null ? <p className="qb-muted">Loading…</p> : overview.classes.length === 0 ? <p className="qb-muted">No young learners have been added yet.</p> : (
          <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>School</th><th>Class</th><th>Teacher</th><th>Active</th><th>Ended</th><th>Erased</th><th>Past retention</th></tr></thead><tbody>
            {overview.classes.map((c) => <tr key={c.class_id}><td>{c.school}</td><td>{c.class_name}</td><td>{c.teacher_name ?? ""} <span className="qb-muted qb-small">{c.teacher_email ?? ""}</span></td><td>{c.active}</td><td>{c.ended}</td><td>{c.erased}</td><td>{c.due}</td></tr>)}
          </tbody></table></div>)}
      </section>

      <section className="qb-card" style={{ marginTop: 16 }}>
        <h2>A teacher is leaving</h2>
        <p className="qb-muted">Move a teacher&apos;s young learners (and, if you tick the box, their classes) to another teacher. Both are found by their account email.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label>From teacher<input className="qb-input" type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} /></label>
          <label>To teacher<input className="qb-input" type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} /></label>
          <label className="qb-check"><input type="checkbox" checked={moveClasses} onChange={(e) => setMoveClasses(e.target.checked)} /> Move their classes too</label>
          <button className="qb-btn" disabled={busy || !fromEmail.includes("@") || !toEmail.includes("@")} onClick={() => void reassign()}>Move</button>
        </div>
      </section>

      <section className="qb-card" style={{ marginTop: 16 }}>
        <h2>Automatic erasure</h2>
        <p className="qb-muted">Ended accounts are kept for {overview?.retention_months ?? 12} months. When this is on, a weekly job erases anything past that, one batch at a time. It is off until counsel has confirmed the retention rule. It also needs CRON_SECRET to be set in Vercel.</p>
        <button className="qb-btn secondary" disabled={busy || overview === null} onClick={() => void toggleAuto(!overview?.auto_erase)}>{overview?.auto_erase ? "Switch off" : "Switch on"}</button> <strong>{overview?.auto_erase ? "On" : "Off"}</strong>
      </section>

      <section className="qb-card" style={{ marginTop: 16 }}>
        <h2>Erase on request</h2>
        <p className="qb-muted">Find the learner by their username (on their sign-in card), note who asked and why, then erase.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <label>Username<input className="qb-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ama.k7f2" /></label>
          <button className="qb-btn secondary" disabled={busy || username.trim().length < 4} onClick={() => void find()}><Search size={14} aria-hidden="true" /> Find</button>
        </div>
        {found && (found.length === 0 ? <p className="qb-muted" style={{ marginTop: 10 }}>No managed learner has that username.</p> : found.map((l) => <div key={l.user_id} className="qb-card" style={{ marginTop: 10 }}>
          <strong>{l.first_name}</strong> <code>{l.username}</code> · {l.school ?? "no school"} · {l.erased ? "already erased" : l.status}
          {!l.erased && <>
            <label style={{ display: "block", marginTop: 8 }}>Who asked, and why? (kept in the audit log)<input className="qb-input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} style={{ width: "100%" }} placeholder="Written request from the parent, 20 Oct 2026" /></label>
            <button className="qb-btn" style={{ marginTop: 8 }} disabled={busy || reason.trim().length < 5} onClick={() => void erase(l, reason.trim())}><Trash2 size={14} aria-hidden="true" /> Erase personal data</button></>}
        </div>))}
      </section>

      <section className="qb-card" style={{ marginTop: 16 }}>
        <h2>Past the retention period</h2>
        {queue === null ? <p className="qb-muted">Loading…</p> : !queue.length ? <p className="qb-muted">Nothing is past the retention period yet.</p> : <>
          <p className="qb-muted">{queue.length} ended account{queue.length === 1 ? "" : "s"} ended over 12 months ago.</p>
          <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>First name</th><th>Username</th><th>Ended</th><th /></tr></thead><tbody>
            {queue.map((l) => <tr key={l.user_id}><td>{l.first_name}</td><td><code>{l.username}</code></td><td>{formatDate(l.ended_at)}</td>
              <td><button className="qb-btn secondary" disabled={busy} onClick={() => void erase(l, queuedReason)}><Trash2 size={14} aria-hidden="true" /> Erase</button></td></tr>)}
          </tbody></table></div></>}
      </section>
    </>
  );
}
