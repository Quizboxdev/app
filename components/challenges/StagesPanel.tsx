"use client";

import { useEffect, useState } from "react";
import { setStages } from "@/lib/api/challenges";
import type { StageInfo } from "@/lib/challenges/types";

type Row = { title: string; question_count: number; minutes: number; pass_percent: number };
const fromStages = (stages: StageInfo[], fallback: { question_count: number; time_limit_seconds: number }): Row[] =>
  stages.length ? stages.map((s) => ({ title: s.title, question_count: s.question_count, minutes: Math.max(1, Math.round(s.time_limit_seconds / 60)), pass_percent: s.pass_percent }))
    : [{ title: "Round 1", question_count: fallback.question_count, minutes: Math.max(1, Math.round(fallback.time_limit_seconds / 60)), pass_percent: 0 }];

// Rounds: players move through them in order. A round unlocks when the player reaches the previous round's pass mark; the leaderboard adds the best score from every round.
export default function StagesPanel({ id, draft, stages, base, onChanged, onError }: { id: string; draft: boolean; stages: StageInfo[]; base: { question_count: number; time_limit_seconds: number }; onChanged: () => void; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Row[]>(() => fromStages(stages, base));
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(fromStages(stages, base)); }, [stages, base.question_count, base.time_limit_seconds]);   // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  async function save() {
    setBusy(true); onError("");
    try { await setStages(id, rows.map((r, i) => ({ title: r.title.trim() || `Round ${i + 1}`, question_count: r.question_count, time_limit_seconds: r.minutes * 60, pass_percent: r.pass_percent }))); onChanged(); } catch (e: any) { onError(e.message); }
    setBusy(false);
  }
  return (
    <div className="qb-card qb-form">
      <h2>Rounds</h2>
      <p className="qb-muted">One round is a simple quiz. Add more for a qualifier and a final: a player reaches the next round by scoring at least the pass mark in the one before. Each round has its own questions.</p>
      {rows.map((r, i) => (
        <div key={i} className="qb-grid cols-3" style={{ alignItems: "end" }}>
          <label className="qb-field">Round {i + 1} name<input disabled={!draft} value={r.title} maxLength={80} onChange={(e) => set(i, { title: e.target.value })} /></label>
          <label className="qb-field">Questions<input disabled={!draft} type="number" min={3} max={100} value={r.question_count} onChange={(e) => set(i, { question_count: Number(e.target.value) })} /></label>
          <label className="qb-field">Minutes<input disabled={!draft} type="number" min={1} max={120} value={r.minutes} onChange={(e) => set(i, { minutes: Number(e.target.value) })} /></label>
          <label className="qb-field">{i < rows.length - 1 ? "Pass mark to unlock the next round (%)" : "Pass mark (not used for the last round)"}<input disabled={!draft || i === rows.length - 1} type="number" min={0} max={100} value={r.pass_percent} onChange={(e) => set(i, { pass_percent: Number(e.target.value) })} /></label>
          {draft && rows.length > 1 && <button type="button" className="qb-link-btn" onClick={() => setRows((x) => x.filter((_, k) => k !== i))}>Remove round {i + 1}</button>}
        </div>
      ))}
      {draft ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {rows.length < 6 && <button type="button" className="qb-btn qb-btn-secondary" onClick={() => setRows((x) => [...x, { title: `Round ${x.length + 1}`, question_count: 10, minutes: 10, pass_percent: 60 }])}>Add a round</button>}
          <button type="button" className="qb-btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save rounds"}</button>
        </div>
      ) : <p className="qb-muted">Rounds are locked once the challenge has gone live.</p>}
    </div>
  );
}
