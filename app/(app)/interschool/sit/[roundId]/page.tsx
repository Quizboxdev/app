"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { saveAnswers, startRound, submitRound } from "@/lib/api/interschool";
import { draftKey, payload, restore, secondsLeft, type Answers } from "@/lib/interschool/sitting";
import { formatDuration } from "@/lib/challenges/types";
import type { Sitting } from "@/lib/interschool/types";

// Taking one round. Each answer is kept on this device and sent to the server straight away (and again until it gets there), so a dropped connection or a closed tab loses nothing.
// The timer is the server's. No score or correct answer is ever sent here: results follow when the round closes.
export default function SitPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = use(params);
  const [sitting, setSitting] = useState<Sitting | null>(null), [answers, setAnswers] = useState<Answers>({}), [index, setIndex] = useState(0), [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [receipt, setReceipt] = useState<{ answered: number; late: boolean } | null>(null), [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const pending = useRef<Answers>({}), answersRef = useRef<Answers>({}), received = useRef(0), saving = useRef(false), sent = useRef(false);
  answersRef.current = answers;

  const flush = useCallback(async (s: Sitting) => {
    if (saving.current || sent.current) return;
    const batch = { ...pending.current };
    if (!Object.keys(batch).length) return;
    saving.current = true; setSaveState("saving");
    try {
      const r = await saveAnswers(s.sitting_id, payload(batch));
      if (r.saved) for (const [q, v] of Object.entries(batch)) if (pending.current[q] === v) delete pending.current[q];
      setSaveState(Object.keys(pending.current).length ? "saving" : "saved");
    } catch { setSaveState("offline"); }
    saving.current = false;
  }, []);

  async function begin() {
    setBusy(true); setError("");
    try {
      const s = await startRound(roundId);
      received.current = Date.now();
      let stored: string | null = null; try { stored = localStorage.getItem(draftKey(s.sitting_id)); } catch { /* private window */ }
      const r = restore(s.questions, stored, s.sitting_id);
      pending.current = r.unsaved; setAnswers(r.answers); setSitting(s); setIndex(0);
    } catch (e) { setError(e instanceof Error ? e.message : "The round could not be opened."); }
    setBusy(false);
  }

  const submit = useCallback(async (s: Sitting) => {
    if (sent.current) return; sent.current = true; setBusy(true); setError("");
    try {
      const r = await submitRound(s.sitting_id, payload(answersRef.current));
      try { localStorage.removeItem(draftKey(s.sitting_id)); } catch { /* private window */ }
      setReceipt({ answered: r.answered, late: Boolean(r.late_answers_ignored) }); setSitting(null);
    } catch (e) { sent.current = false; setError(`${e instanceof Error ? e.message : "Not sent."} Your answers are kept on this device. Press Submit again.`); }
    setBusy(false);
  }, []);

  useEffect(() => {
    if (!sitting) return;
    let tried = false;
    const tick = () => { const s = secondsLeft(sitting.expires_at, sitting.server_time, received.current, Date.now()); setLeft(s); if (s === 0 && !tried) { tried = true; void submit(sitting); } };
    tick(); const clock = setInterval(tick, 1000), saver = setInterval(() => void flush(sitting), 5000);
    const online = () => void flush(sitting);
    window.addEventListener("online", online);
    return () => { clearInterval(clock); clearInterval(saver); window.removeEventListener("online", online); };
  }, [sitting, submit, flush]);

  function choose(question: string, choice: number) {
    if (!sitting) return;
    const next = { ...answersRef.current, [question]: choice };
    setAnswers(next); answersRef.current = next; pending.current[question] = choice;
    try { localStorage.setItem(draftKey(sitting.sitting_id), JSON.stringify({ sitting: sitting.sitting_id, answers: next })); } catch { /* private window */ }
    void flush(sitting);
  }

  if (receipt) return <div className="qb-card" role="status"><h1>Round submitted</h1><p>{receipt.answered} answer{receipt.answered === 1 ? "" : "s"} received.{receipt.late ? " The time was up, so only answers saved in time count." : ""} Results are published when the round closes.</p><p><Link className="qb-btn" href="/interschool">Back to my competitions</Link></p></div>;
  if (!sitting) return (
    <>
      <div className="qb-page-head"><div><h1>Ready to start?</h1><p>You can take this round once. The timer starts when you press Start and cannot be paused. Your answers are saved as you go, so you can come back if your connection drops.</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <div className="qb-card"><button type="button" className="qb-btn" disabled={busy} onClick={() => void begin()}>{busy ? "Opening…" : "Start the round"}</button> <Link className="qb-link" href="/interschool">Not now</Link></div>
    </>
  );
  const q = sitting.questions[index], answered = Object.keys(answers).length;
  return (
    <>
      <div className="qb-page-head"><div><h1>{sitting.title}</h1><p>Question {index + 1} of {sitting.questions.length} · {answered} answered · <span role="status">{saveState === "offline" ? "Offline: kept on this device, will be sent when you reconnect" : saveState === "saving" ? "Saving…" : "Saved"}</span></p></div>
        <div className="qb-chip" role="timer" aria-live="off" style={left <= 60 ? { fontWeight: 700 } : undefined}>{formatDuration(left * 1000)} left</div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <div className="qb-card">
        <h2 style={{ fontSize: 18 }}>{q.question_text}</h2>
        <div role="radiogroup" aria-label="Answer options" style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {q.options.map((o, i) => (
            <button key={i} type="button" role="radio" aria-checked={answers[q.id] === i} className={`qb-btn ${answers[q.id] === i ? "" : "qb-btn-secondary"}`} style={{ textAlign: "left", minHeight: 48, height: "auto", width: "100%", whiteSpace: "normal", overflowWrap: "anywhere", padding: "10px 14px", justifyContent: "flex-start" }} onClick={() => choose(q.id, i)}>
              <strong>{String.fromCharCode(65 + i)}.</strong> {o}
            </button>))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="qb-btn qb-btn-secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</button>
        {index < sitting.questions.length - 1 && <button type="button" className="qb-btn" onClick={() => setIndex(index + 1)}>Next</button>}
        <button type="button" className={`qb-btn${index < sitting.questions.length - 1 ? " qb-btn-secondary" : ""}`} disabled={busy} onClick={() => { if (answered === sitting.questions.length ? window.confirm("Submit your answers? You cannot change them afterwards.") : window.confirm(`You have answered ${answered} of ${sitting.questions.length}. Submit anyway?`)) void submit(sitting); }}>{busy ? "Submitting…" : "Submit"}</button>
      </div>
      <nav aria-label="Questions" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 12 }}>
        {sitting.questions.map((x, i) => <button key={x.id} type="button" className={`qb-btn ${answers[x.id] !== undefined ? "" : "qb-btn-secondary"}`} aria-label={`Question ${i + 1}${answers[x.id] !== undefined ? ", answered" : ""}`} aria-current={i === index} style={{ minWidth: 36, padding: "4px 8px", outline: i === index ? "3px solid #f59e0b" : undefined }} onClick={() => setIndex(i)}>{i + 1}</button>)}
      </nav>
    </>
  );
}
