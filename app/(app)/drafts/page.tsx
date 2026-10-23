"use client";

import HelpLink from "@/components/help/HelpLink";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { discardDraft, keepDraft, listDrafts, type DraftRow } from "@/lib/api/drafts";
import { DRAFT_LABEL, expiresSoon, timeLeft } from "@/lib/drafts/format";
import { formatDateTime } from "@/lib/format";

// Unfinished work waiting to be completed. Each draft is deleted 24 hours after its last change; you are warned in the app, on your phone and by email two hours before.
export default function DraftsPage() {
  const [rows, setRows] = useState<DraftRow[] | null>(null), [error, setError] = useState(""), [now, setNow] = useState(() => Date.now()), [busy, setBusy] = useState("");
  const load = useCallback(() => listDrafts().then(setRows).catch(() => { setRows([]); setError("Drafts are not available right now."); }), []);
  useEffect(() => { void load(); const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, [load]);
  async function act(id: string, work: () => Promise<unknown>) { setBusy(id); setError(""); try { await work(); await load(); } catch { setError("That did not work. Please try again."); } setBusy(""); }
  return (
    <>
      <div className="qb-page-head"><div><h1>Unfinished work</h1><p>Whatever you were setting up is saved here so you can finish it. Each draft is deleted 24 hours after your last change, and you are warned two hours before.</p></div><HelpLink slug="unfinished-work" label="How drafts work" /></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <div className="qb-card">
        {rows === null ? <p className="qb-muted">Loading…</p> : rows.length === 0 ? <div className="qb-empty"><strong>Nothing unfinished</strong>When you start something and leave before finishing, it appears here.</div> : (
          <table className="qb-table"><thead><tr><th>Draft</th><th>Type</th><th>Last saved</th><th>Deleted in</th><th /></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.title || "Untitled"}</td><td>{DRAFT_LABEL[r.kind] ?? "work"}</td><td>{formatDateTime(r.updated_at)}</td>
                <td style={expiresSoon(r.expires_at, now) ? { fontWeight: 700 } : undefined}>{timeLeft(r.expires_at, now)}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {r.path && <Link className="qb-btn" href={r.path}>Continue</Link>}
                  <button className="qb-btn qb-btn-secondary" disabled={busy === r.id} onClick={() => void act(r.id, () => keepDraft(r.id))}>Keep 24 more hours</button>
                  <button className="qb-link-btn" disabled={busy === r.id} onClick={() => { if (window.confirm("Discard this draft? It cannot be recovered.")) void act(r.id, () => discardDraft(r.id)); }}>Discard</button>
                </td>
              </tr>))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
