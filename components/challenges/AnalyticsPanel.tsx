"use client";

import { useEffect, useState } from "react";
import { getAnalytics } from "@/lib/api/challenges";
import { formatDuration, type Analytics } from "@/lib/challenges/types";

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : "–");
const Bar = ({ value, max, label }: { value: number; max: number; label: string }) => (
  <div style={{ display: "grid", gridTemplateColumns: "88px 1fr 40px", gap: 8, alignItems: "center", fontSize: 13 }}>
    <span className="qb-muted">{label}</span>
    <div style={{ background: "rgba(127,127,127,.2)", borderRadius: 4, height: 10 }}><div style={{ width: `${max ? Math.max(2, (100 * value) / max) : 0}%`, height: 10, borderRadius: 4, background: "currentColor", opacity: 0.55 }} /></div>
    <span>{value}</span>
  </div>
);

// Results for the organiser: reach, completion, score spread, each round's funnel and which questions were hardest. Page views are approximate (anyone opening the public page counts once per visit).
export default function AnalyticsPanel({ id, onError }: { id: string; onError: (m: string) => void }) {
  const [a, setA] = useState<Analytics | null>(null);
  useEffect(() => { getAnalytics(id).then(setA).catch((e) => onError(e.message)); }, [id, onError]);
  if (!a) return <div className="qb-card" role="status">Loading results…</div>;
  const maxBand = Math.max(1, ...a.distribution.map((d) => d.count)), maxDay = Math.max(1, ...a.daily.map((d) => d.starts));
  return (
    <>
      <div className="qb-grid cols-3">
        {[["Page views", a.views], ["Players", a.players], ["Attempts started", a.started], ["Attempts finished", a.completed], ["Finish rate", pct(a.completed, a.started)], ["Average score", a.avg_score_percent === null ? "–" : `${a.avg_score_percent}%`], ["Average time", a.avg_duration_ms === null ? "–" : formatDuration(a.avg_duration_ms)], ["Timed out", a.expired]].map(([k, v]) => (
          <div className="qb-card" key={String(k)}><div className="qb-muted qb-small">{k}</div><div style={{ fontSize: 26, fontWeight: 700 }}>{v}</div></div>))}
      </div>
      <div className="qb-card"><h2>Score spread</h2>{a.distribution.length === 0 ? <p className="qb-muted">No finished attempts yet.</p> : [0, 20, 40, 60, 80].map((b) => <Bar key={b} label={b === 80 ? "80–100%" : `${b}–${b + 19}%`} value={a.distribution.find((d) => d.band === b)?.count ?? 0} max={maxBand} />)}</div>
      {a.stages.length > 1 && <div className="qb-card"><h2>Rounds</h2><table className="qb-table"><thead><tr><th>Round</th><th>Players</th><th>Started</th><th>Finished</th></tr></thead><tbody>{a.stages.map((s) => <tr key={s.stage_no}><td>{s.stage_no}</td><td>{s.players}</td><td>{s.started}</td><td>{s.completed}</td></tr>)}</tbody></table></div>}
      <div className="qb-card"><h2>Questions</h2>{a.questions.length === 0 ? <p className="qb-muted">No questions.</p> : (
        <table className="qb-table"><thead><tr><th>#</th><th>Question</th><th>Answered</th><th>Correct</th></tr></thead><tbody>{a.questions.map((q) => <tr key={q.position}><td>{q.position}</td><td>{q.text}</td><td>{q.answered}</td><td>{q.percent_correct === null ? "–" : `${q.percent_correct}%`}</td></tr>)}</tbody></table>)}
        <p className="qb-muted qb-small">Questions that few people get right may be too hard or unclear.</p></div>
      <div className="qb-card"><h2>Last 30 days</h2>{a.daily.length === 0 ? <p className="qb-muted">No attempts yet.</p> : a.daily.map((d) => <Bar key={d.day} label={d.day.slice(5)} value={d.starts} max={maxDay} />)}</div>
    </>
  );
}
