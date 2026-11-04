"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAttemptBreakdown, type AttemptBreakdown } from "@/lib/api/blueprint";
import { breakdownBand } from "@/lib/learning/blueprint";
import { practiseHref } from "@/lib/learning/labels";

// A learner's own result by subject and topic: what they did well and where to do better. Shown only when there is something to compare
// (several subjects, or several topics in one). It is best-effort: if the breakdown cannot be read, the rest of the result page is unaffected.
export default function ResultBreakdown({ attemptId }: { attemptId: string }) {
  const [data, setData] = useState<AttemptBreakdown | null>(null);
  useEffect(() => { getAttemptBreakdown(attemptId).then(setData).catch(() => setData(null)); }, [attemptId]);
  if (!data || data.subjects.length === 0) return null;
  const worthShowing = data.subjects.length > 1 || (data.subjects[0]?.topics.length ?? 0) > 1;
  if (!worthShowing) return null;
  return <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="rs-breakdown">
    <h2 id="rs-breakdown">{data.subjects.length > 1 ? "How you did in each subject" : "How you did in each topic"}</h2>
    <div className="qb-list">
      {data.subjects.map((s) => { const band = breakdownBand(s.percent);
        return <div key={s.subject} className="qb-answer-item">
          <div className="qb-actions" style={{ justifyContent: "space-between" }}>
            <strong>{s.subject}</strong>
            <span>{s.correct}/{s.total} · {Math.round(s.percent)}% <span className={`qb-pill ${band.tone === "success" ? "success" : band.tone === "amber" ? "amber" : ""}`.trim()}>{band.label}</span></span>
          </div>
          <div className="qb-progress-track" role="img" aria-label={`${s.subject}: ${s.correct} of ${s.total} correct`}><div className="qb-progress-fill" style={{ width: `${Math.max(2, Math.min(100, s.percent))}%` }} /></div>
          {s.topics.length > 0 && <ul className="qb-small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {s.topics.map((t) => <li key={t.topic_id}>{t.title}: {t.correct}/{t.total}{t.percent < 68 ? <span className="qb-muted"> · needs more practice</span> : null}</li>)}
          </ul>}
        </div>; })}
    </div>
    {data.weakest.length > 0 && <>
      <h3 style={{ marginTop: 16 }}>Where to do better</h3>
      <p className="qb-muted">These are the topics to practise first. Every attempt builds mastery.</p>
      <ul>{data.weakest.map((w) => <li key={w.topic_id}><strong>{w.title}</strong> <span className="qb-muted">({w.subject}, {w.correct}/{w.total})</span>{" "}
        <Link className="qb-link" href={practiseHref(w.subject)}>Practise {w.subject}</Link></li>)}</ul>
    </>}
  </section>;
}
