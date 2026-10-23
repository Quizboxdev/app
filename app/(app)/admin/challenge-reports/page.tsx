"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listReports, resolveReport, type ChallengeReport } from "@/lib/api/challenges";
import ExportLink from "@/components/admin/ExportLink";

// Reports on public challenges. Dismiss clears every open report on that challenge and unhides it; take down removes it for good (the organiser is told); restore reverses a take-down.
const LABEL: Record<string, string> = { inappropriate: "Inappropriate or harmful", misleading: "Misleading or a scam", copyright: "Copyright", wrong_answers: "Wrong answers", spam: "Spam", other: "Other" };
export default function ChallengeReportsPage() {
  const [status, setStatus] = useState("OPEN"), [rows, setRows] = useState<ChallengeReport[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(() => listReports(status).then(setRows).catch((e) => { setError(e.message); setRows([]); }), [status]);
  useEffect(() => { setRows(null); void load(); }, [load]);
  async function act(r: ChallengeReport, action: "DISMISS" | "TAKE_DOWN" | "RESTORE") {
    if (action === "TAKE_DOWN" && !window.confirm(`Take down "${r.title}"? Players will no longer see it and the organiser is told.`)) return;
    setBusy(true); setError("");
    try { await resolveReport(r.id, action, notes[r.id]); await load(); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  return (
    <>
      <div className="qb-page-head"><div><h1>Challenge reports</h1><p>People can report public challenges. Three different reporters hide a challenge until you decide.</p></div><ExportLink dataset="challenge_attempts" /></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <div role="tablist" style={{ display: "flex", gap: 6 }}>{["OPEN", "ACTIONED", "DISMISSED"].map((s) => <button key={s} role="tab" aria-selected={status === s} className={`qb-btn ${status === s ? "" : "qb-btn-secondary"}`} onClick={() => setStatus(s)}>{s === "OPEN" ? "Open" : s === "ACTIONED" ? "Taken down" : "Dismissed"}</button>)}</div>
      <div className="qb-card">
        {rows === null ? <p className="qb-muted">Loading…</p> : rows.length === 0 ? <p className="qb-muted">Nothing here.</p> : (
          <ul className="qb-list">{rows.map((r) => (
            <li key={r.id} style={{ paddingBottom: 12 }}>
              <strong><Link className="qb-link" href={`/challenges/${r.slug}`}>{r.title}</Link></strong> <span className="qb-muted">by {r.owner_name ?? "unknown"} · {r.campaign_status.toLowerCase()} · {r.moderation_state === "OK" ? "visible" : r.moderation_state === "UNDER_REVIEW" ? "hidden for review" : "taken down"} · {r.open_reports} open report{r.open_reports === 1 ? "" : "s"}</span>
              <div>{LABEL[r.reason] ?? r.reason}{r.details ? `: ${r.details}` : ""} <span className="qb-muted qb-small">{new Date(r.created_at).toLocaleString("en-GB")}</span></div>
              {r.handled_note && <div className="qb-muted qb-small">Note: {r.handled_note}</div>}
              {status === "OPEN" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  <input aria-label="Note" placeholder="Note (shown to the organiser on a take-down)" maxLength={400} value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} style={{ flex: "1 1 240px" }} />
                  <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => act(r, "DISMISS")}>Dismiss</button>
                  <button className="qb-btn" disabled={busy} onClick={() => act(r, "TAKE_DOWN")}>Take down</button>
                </div>)}
              {status === "ACTIONED" && r.moderation_state === "TAKEN_DOWN" && <button className="qb-btn qb-btn-secondary" disabled={busy} onClick={() => act(r, "RESTORE")}>Restore</button>}
            </li>))}</ul>
        )}
      </div>
    </>
  );
}
