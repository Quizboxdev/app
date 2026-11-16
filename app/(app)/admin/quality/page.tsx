"use client";
import { useCallback, useEffect, useState } from "react";
import { contentQuality } from "@/lib/api/platform";
import ExportLink from "@/components/admin/ExportLink";
import { Kpi, Panel, RankedBars, SERIES, num } from "@/components/admin/DataViz";

type Signal = { question_id: string; question: string; subject: string; grade: string; status: string; responses: number; accuracy: number | null; started: number; abandoned: number; revisions: number; disputes: number; flags: string[] };
type QueueItem = { id: string; question_id: string; question: string; type: string; reason: string; created_at: string };

const STAGES = ["generated", "awaiting_review", "revision_required", "approved", "published", "rejected", "disputed", "quality_queue"];
const label = (k: string) => { const s = k.replaceAll("_", " "); return s.charAt(0).toUpperCase() + s.slice(1); };

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
  const n = (k: string) => Number(summary?.[k] ?? 0);
  const rows = STAGES.map((k) => ({ key: k, label: label(k), segments: [{ value: n(k), color: k === "rejected" || k === "disputed" ? SERIES.b : SERIES.a, name: label(k) }] }));
  return <div className="dx-page">
    <div className="dx-head"><div><h1>Content quality</h1><p>Lifecycle counts, quality signals and the review queue. Flags never change approved content.</p></div><div className="dx-actions"><ExportLink dataset="question_bank" /></div></div>
    {error && <div className="dx-alert error" role="alert">{error}</div>}{notice && <div className="dx-alert ok" role="status">{notice}</div>}
    {!summary && !error && <p className="dx-muted" role="status">Loading…</p>}
    {summary && <>
      <div className="dx-kpis">
        <Kpi label="Awaiting review" value={num(n("awaiting_review"))} tone={n("awaiting_review") > 0 ? "warn" : "default"} />
        <Kpi label="Revision required" value={num(n("revision_required"))} tone={n("revision_required") > 0 ? "warn" : "default"} />
        <Kpi label="Approved" value={num(n("approved"))} />
        <Kpi label="Published" value={num(n("published"))} />
        <Kpi label="Disputed" value={num(n("disputed"))} tone={n("disputed") > 0 ? "warn" : "default"} />
        <Kpi label="Quality queue" value={num(queue.length)} hint="waiting for a human" tone={queue.length > 0 ? "warn" : "default"} />
      </div>
      <Panel title="Lifecycle" subtitle="Questions at each stage"><RankedBars rows={rows} unit="questions" limit={8} /></Panel>
    </>}
    <Panel title="Quality-review queue">
      {queue.length ? <div className="dx-table-wrap" style={{ maxHeight: 320 }}><table className="dx-table"><thead><tr><th>Question</th><th>Type</th><th>Reason</th><th aria-label="Action" /></tr></thead><tbody>
        {queue.map((r) => <tr key={r.id}><td className="name" style={{ whiteSpace: "normal", minWidth: 240 }}>{r.question}</td><td><span className="dx-pill">{r.type.replaceAll("_", " ")}</span></td><td className="dx-muted" style={{ whiteSpace: "normal" }}>{r.reason}</td>
          <td><button className="dx-btn sm" disabled={busy} onClick={() => void act(() => contentQuality("resolve", { report_id: r.id, note: "Reviewed" }), "Marked as reviewed.")}>Mark reviewed</button></td></tr>)}</tbody></table></div>
        : <p className="dx-muted dx-note">The queue is empty.</p>}
    </Panel>
    <div className="dx-toolbar"><strong style={{ fontSize: 13 }}>Quality signals</strong>
      <label className="dx-check"><input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only</label></div>
    <div className="dx-table-wrap"><table className="dx-table"><thead><tr><th>Question</th><th>Subject / grade</th><th className="num">Responses</th><th className="num">Accuracy</th><th className="num">Abandoned</th><th className="num">Revisions</th><th className="num">Disputes</th><th>Flags</th><th aria-label="Action" /></tr></thead>
      <tbody>{signals.map((s) => <tr key={s.question_id}><td className="name" style={{ whiteSpace: "normal", minWidth: 240 }}>{s.question}</td><td>{s.subject} / {s.grade ?? "-"}</td><td className="num">{s.responses}</td><td className="num">{pct(s.accuracy)}</td><td className="num">{s.abandoned}/{s.started}</td><td className="num">{s.revisions}</td><td className="num">{s.disputes}</td>
        <td>{s.flags.map((f) => <span key={f} className="dx-pill warn" style={{ marginInlineEnd: 4 }}>{f.replaceAll("_", " ")}</span>)}</td>
        <td><button className="dx-btn sm" disabled={busy} onClick={() => void act(() => contentQuality("flag", { question_id: s.question_id, reason: s.flags.join(", ") || "Manual quality review" }), "Added to the quality-review queue.")}>Flag for review</button></td></tr>)}
        {!signals.length && <tr><td colSpan={9} className="dx-muted">{busy ? "Loading…" : "No questions match."}</td></tr>}</tbody></table></div>
    <div className="dx-pager"><span>{num(signals.length)} questions shown</span></div>
  </div>;
}
