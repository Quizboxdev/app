"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { day, openSet, recordAttempt, sourceLine, type OpenSet } from "@/lib/api/marketplace";

// Practise a purchased set: one question at a time, the answer and the explanation after each, a score at the end. Only people inside their 90 days (and the seller and reviewers) can open it;
// the database refuses everyone else. The score is saved to the buyer's own history.
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export default function PlaySet({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [set, setSet] = useState<OpenSet | null>(null), [error, setError] = useState(""), [n, setN] = useState(0), [picked, setPicked] = useState<number | null>(null), [score, setScore] = useState(0), [done, setDone] = useState(false), [round, setRound] = useState(0);
  useEffect(() => { openSet(id).then(setSet).catch((e) => setError(e.message)); }, [id]);
  const order = useMemo(() => (set ? shuffle(set.questions.map((_, i) => i)) : []), [set, round]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="qb-card"><h2>You cannot open this set</h2><p className="qb-muted">{error}</p><Link className="qb-btn" href="/marketplace/mine">My question sets</Link></div>;
  if (!set) return <div className="qb-card qb-muted">Loading…</div>;
  const total = order.length, q = set.questions[order[n]];

  function choose(i: number) {
    if (picked !== null) return;
    setPicked(i); if (i === q.correct_index) setScore((s) => s + 1);
  }
  function next() {
    if (n + 1 >= total) { setDone(true); void recordAttempt(id, score, total).catch(() => undefined); return; }
    setN(n + 1); setPicked(null);
  }
  const again = () => { setN(0); setPicked(null); setScore(0); setDone(false); setRound((r) => r + 1); };

  return (
    <>
      <div className="qb-page-head"><div><p className="qb-small"><Link className="qb-link" href="/marketplace/mine">← My question sets</Link></p><h1>{set.title}</h1><p><span className="qb-pill teal">{sourceLine({ subject: set.subject, school: set.school, grade: set.grade, term: set.term })}</span></p></div></div>
      {set.expires_at && <p className="qb-small qb-muted">Yours until {day(set.expires_at)}.</p>}
      {done ? (
        <div className="qb-card" style={{ display: "grid", gap: 12, textAlign: "center" }}>
          <h2>You scored {score} out of {total}</h2>
          <p className="qb-muted">{Math.round((score / total) * 100)}%</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}><button className="qb-btn" onClick={again}>Practise again</button><Link className="qb-btn secondary" href="/marketplace/mine">My question sets</Link></div>
        </div>
      ) : (
        <div className="qb-card" style={{ display: "grid", gap: 14 }}>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>Question {n + 1} of {total}</p>
          <h3 style={{ margin: 0 }}>{q.question_text}</h3>
          <div style={{ display: "grid", gap: 8 }} role="group" aria-label="Answers">
            {q.options.map((o, i) => {
              const state = picked === null ? "" : i === q.correct_index ? "success" : i === picked ? "danger" : "";
              return <button key={i} className={`qb-btn secondary ${state}`} style={{ justifyContent: "flex-start", textAlign: "left", ...(state === "success" ? { borderColor: "var(--qb-success)" } : state === "danger" ? { borderColor: "var(--qb-danger)" } : {}) }} onClick={() => choose(i)} disabled={picked !== null && i !== picked && i !== q.correct_index}>
                <strong>{String.fromCharCode(65 + i)}.</strong>&nbsp;{o}</button>;
            })}
          </div>
          {picked !== null && <div role="status">
            <p className={picked === q.correct_index ? "qb-ok" : "qb-error"} style={{ margin: 0 }}>{picked === q.correct_index ? "Correct." : `Not quite. The answer is ${String.fromCharCode(65 + q.correct_index)}.`}</p>
            {q.explanation && <p className="qb-muted" style={{ margin: "6px 0 0" }}>{q.explanation}</p>}
            <button className="qb-btn" style={{ marginTop: 10 }} onClick={next}>{n + 1 >= total ? "See my score" : "Next question"}</button>
          </div>}
        </div>
      )}
    </>
  );
}
