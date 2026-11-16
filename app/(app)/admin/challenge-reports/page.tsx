"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { listReports, resolveReport, type ChallengeReport } from "@/lib/api/challenges";
import ExportLink from "@/components/admin/ExportLink";
import { Kpi, Segmented, num } from "@/components/admin/DataViz";

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
    <div className="dx-page">
      <div className="dx-head"><div><h1>Challenge reports</h1><p>People can report public challenges. Three different reporters hide a challenge until you decide.</p></div><div className="dx-actions"><ExportLink dataset="challenge_attempts" /></div></div>
      <div className="dx-kpis">
        <Kpi label={status === "OPEN" ? "Open reports" : status === "ACTIONED" ? "Taken down" : "Dismissed"} value={rows ? num(rows.length) : "—"} tone={status === "OPEN" && (rows?.length ?? 0) > 0 ? "warn" : "default"} />
        <Kpi label="Already hidden" value={rows ? num(rows.filter((r) => r.moderation_state !== "OK").length) : "—"} hint="in this view" />
      </div>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      <div className="dx-toolbar"><Segmented<string> label="Report status" value={status} onChange={setStatus} options={[{ value: "OPEN", label: "Open" }, { value: "ACTIONED", label: "Taken down" }, { value: "DISMISSED", label: "Dismissed" }]} /></div>
      <div className="dx-panel">
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
    </div>
  );
}
