"use client";
import { useCallback, useEffect, useState } from "react";
import { contentQuality } from "@/lib/api/platform";

type Signal = { question_id: string; question: string; subject: string; grade: string; status: string; responses: number; accuracy: number | null; started: number; abandoned: number; revisions: number; disputes: number; flags: string[] };
type QueueItem = { id: string; question_id: string; question: string; type: string; reason: string; created_at: string };

// Content operations. Signals only flag questions for human review; nothing is deleted or rewritten.
export default function ContentQualityPage() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null), [signals, setSignals] = useState<Signal[]>([]), [queue, setQueue] = useState<QueueItem[]>([]);
  const [flaggedOnly, setFlaggedOnly] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [s, g, q] = await Promise.all([contentQuality<Record<string, unknown>>("summary"), contentQuality<Signal[]>("signals", { flagged_only: flaggedOnly, min_responses: 5 }), contentQuality<QueueItem[]>("queue")]);
      setSummary(s); setSignals(g); setQueue(q);
    } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); }
  }, [flaggedOnly]);
  useEffect(() => { void load(); }, [load]);
  const act = async (work: () => Promise<unknown>, done: string) => { setBusy(true); try { await work(); setNotice(done); await load(); } catch (cause) { setError((cause as Error).message); } finally { setBusy(false); } };
  const pct = (v: number | null) => (v === null || v === undefined ? "-" : `${Math.round(Number(v) * 100)}%`);
  return <>
    <div className="qb-page-head"><div><h1>Content quality</h1><p>Lifecycle counts, quality signals and the review queue. Flags never change approved content.</p></div></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!summary && !error && <p className="qb-muted" role="status">Loading…</p>}
    {summary && <section className="qb-card"><h2>Lifecycle</h2><dl className="qb-stat-list">
      {["generated", "awaiting_review", "revision_required", "approved", "published", "rejected", "disputed", "quality_queue"].map((k) => <div key={k}><dt>{k.replaceAll("_", " ")}</dt><dd>{String(summary[k] ?? 0)}</dd></div>)}
    </dl></section>}
    <section className="qb-card"><h2>Quality-review queue</h2>
      {queue.length ? <ul className="qb-list">{queue.map((r) => <li key={r.id} className="qb-row"><div className="qb-row-main"><strong>{r.question}</strong><span>{r.type.replaceAll("_", " ")} · {r.reason}</span></div>
        <button className="qb-btn secondary" disabled={busy} onClick={() => void act(() => contentQuality("resolve", { report_id: r.id, note: "Reviewed" }), "Marked as reviewed.")}>Mark reviewed</button></li>)}</ul>
        : <p className="qb-muted">The queue is empty.</p>}
    </section>
    <section className="qb-card"><div className="qb-page-head"><h2>Quality signals</h2>
      <label><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)}/> Flagged only</label></div>
      <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Question</th><th>Subject / grade</th><th>Responses</th><th>Accuracy</th><th>Abandoned</th><th>Revisions</th><th>Disputes</th><th>Flags</th><th></th></tr></thead>
        <tbody>{signals.map((s) => <tr key={s.question_id}><td>{s.question}</td><td>{s.subject} / {s.grade ?? "-"}</td><td>{s.responses}</td><td>{pct(s.accuracy)}</td><td>{s.abandoned}/{s.started}</td><td>{s.revisions}</td><td>{s.disputes}</td>
          <td>{s.flags.map((f) => <div key={f}><small>{f.replaceAll("_", " ")}</small></div>)}</td>
          <td><button className="qb-btn secondary" disabled={busy} onClick={() => void act(() => contentQuality("flag", { question_id: s.question_id, reason: s.flags.join(", ") || "Manual quality review" }), "Added to the quality-review queue.")}>Flag for review</button></td></tr>)}</tbody></table>
        {!signals.length && <p className="qb-muted">{busy ? "Loading…" : "No questions match."}</p>}</div>
    </section>
  </>;
}
