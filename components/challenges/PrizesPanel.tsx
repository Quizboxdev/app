"use client";

import { useCallback, useEffect, useState } from "react";
import { awardsList, finalizeChallenge, setPrizes, updateAward } from "@/lib/api/challenges";
import type { Award, Prize } from "@/lib/challenges/types";
import { humanize } from "@/lib/format";

const KINDS: Prize["kind"][] = ["recognition", "certificate", "goods", "voucher", "cash"];
const STATUSES = ["PENDING", "CONTACTED", "FULFILLED", "FORFEITED"] as const;

// Prizes are set before the end. When the challenge is ended, "Work out winners" fixes the final ranking and creates a list of awards; the organiser delivers each prize and marks it here.
// QuizBox does not move money or goods. Winners' names and emails are shown only to the organiser, and players are told so before they start.
export default function PrizesPanel({ id, status, finalized, prizes, onChanged, onError }: { id: string; status: string; finalized: boolean; prizes: Prize[]; onChanged: () => void; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Prize[]>(prizes), [busy, setBusy] = useState(false), [awards, setAwards] = useState<Award[]>([]), [notes, setNotes] = useState<Record<string, string>>({});
  const locked = ["COMPLETED", "ARCHIVED"].includes(status) || finalized;
  useEffect(() => { setRows(prizes); }, [prizes]);
  const loadAwards = useCallback(() => { if (finalized) awardsList(id).then(setAwards).catch((e) => onError(e.message)); }, [id, finalized, onError]);
  useEffect(() => { loadAwards(); }, [loadAwards]);
  const set = (i: number, patch: Partial<Prize>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const run = async (work: () => Promise<unknown>) => { setBusy(true); onError(""); try { await work(); } catch (e: any) { onError(e.message); } setBusy(false); };

  return (
    <>
      <div className="qb-card qb-form">
        <h2>Prizes</h2>
        <p className="qb-muted">Each prize covers a range of final ranks, for example 1 to 1, or 2 to 3. Ranking is by rounds completed, then total score, then total time.</p>
        {rows.length === 0 && <p className="qb-muted">No prizes yet.</p>}
        {rows.map((r, i) => (
          <div key={i} className="qb-grid cols-3" style={{ alignItems: "end" }}>
            <label className="qb-field">Ranks from<input disabled={locked} type="number" min={1} max={100} value={r.rank_from} onChange={(e) => set(i, { rank_from: Number(e.target.value), rank_to: Math.max(Number(e.target.value), r.rank_to) })} /></label>
            <label className="qb-field">to<input disabled={locked} type="number" min={r.rank_from} max={100} value={r.rank_to} onChange={(e) => set(i, { rank_to: Number(e.target.value) })} /></label>
            <label className="qb-field">Kind<select disabled={locked} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Prize["kind"] })}>{KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</select></label>
            <label className="qb-field">Prize<input disabled={locked} maxLength={120} value={r.title} onChange={(e) => set(i, { title: e.target.value })} /></label>
            <label className="qb-field">Details (optional)<input disabled={locked} maxLength={400} value={r.details ?? ""} onChange={(e) => set(i, { details: e.target.value })} /></label>
            {!locked && <button type="button" className="qb-link-btn" onClick={() => setRows((x) => x.filter((_, k) => k !== i))}>Remove</button>}
          </div>
        ))}
        {!locked && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {rows.length < 20 && <button type="button" className="qb-btn qb-btn-secondary" onClick={() => setRows((x) => [...x, { rank_from: (x.at(-1)?.rank_to ?? 0) + 1, rank_to: (x.at(-1)?.rank_to ?? 0) + 1, kind: "recognition", title: "", details: "" }])}>Add a prize</button>}
          <button type="button" className="qb-btn" disabled={busy || rows.some((r) => r.title.trim().length < 2)} onClick={() => run(async () => { await setPrizes(id, rows.map((r) => ({ ...r, title: r.title.trim() }))); onChanged(); })}>Save prizes</button>
        </div>}
        {locked && <p className="qb-muted">Prizes are locked once the challenge has ended.</p>}
      </div>

      {status === "COMPLETED" && (
        <div className="qb-card">
          <h2>Winners</h2>
          {!finalized ? (
            <>
              <p className="qb-muted">The challenge has ended. Work out the winners to fix the final ranking and create the list of prizes to deliver. This cannot be undone.</p>
              <button className="qb-btn" disabled={busy || prizes.length === 0} onClick={() => run(async () => { await finalizeChallenge(id); onChanged(); })}>Work out winners</button>
              {prizes.length === 0 && <p className="qb-muted">Add at least one prize first.</p>}
            </>
          ) : awards.length === 0 ? <p className="qb-muted">No one ranked within the prize ranges.</p> : (
            <table className="qb-table"><thead><tr><th>Rank</th><th>Prize</th><th>Winner</th><th>Email</th><th>Delivery</th><th>Note</th></tr></thead><tbody>
              {awards.map((a) => (
                <tr key={a.award_id}><td>{a.rank}</td><td>{a.prize}</td><td>{a.name}</td><td>{a.email ?? ""}</td>
                  <td><select value={a.status} onChange={(e) => run(async () => { await updateAward(a.award_id, e.target.value, notes[a.award_id] ?? a.note ?? ""); loadAwards(); })}>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></td>
                  <td><input aria-label={`Note for rank ${a.rank}`} maxLength={400} defaultValue={a.note ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [a.award_id]: e.target.value }))} onBlur={() => run(async () => { await updateAward(a.award_id, a.status, notes[a.award_id] ?? a.note ?? ""); loadAwards(); })} /></td></tr>))}
            </tbody></table>
          )}
        </div>
      )}
    </>
  );
}
