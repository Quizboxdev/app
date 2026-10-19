"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { getLeaderboard, myProgress, startChallenge, submitChallenge } from "@/lib/api/challenges";
import { formatDuration, readableText, type AttemptResult, type ChallengeCard, type LeaderRow, type StageProgress, type StartedAttempt } from "@/lib/challenges/types";

// The challenge player. The questions arrive without answers; the server scores the attempt when it is submitted (or when time runs out) and only then reveals the answers.
export default function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [card, setCard] = useState<ChallengeCard | null | undefined>(undefined);
  const [code, setCode] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<StartedAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({}), [index, setIndex] = useState(0), [left, setLeft] = useState(0);
  const [result, setResult] = useState<AttemptResult | null>(null), [board, setBoard] = useState<LeaderRow[]>([]);
  const [progress, setProgress] = useState<StageProgress[]>([]), [stage, setStage] = useState(1);
  const sent = useRef(false);

  useEffect(() => { void Promise.resolve(getSupabaseBrowserClient().rpc("challenge_public_get", { p_slug: slug })).then(({ data }) => setCard((data as ChallengeCard) ?? null), () => setCard(null)); }, [slug]);

  const loadProgress = useCallback(() => { myProgress(slug).then((p) => { setProgress(p); const open = p.find((s) => s.state === "OPEN"); if (open) setStage(open.stage_no); }).catch(() => setProgress([])); }, [slug]);
  useEffect(() => { loadProgress(); }, [loadProgress]);

  const finish = useCallback(async (a: StartedAttempt, given: Record<string, number>) => {
    if (sent.current) return; sent.current = true; setBusy(true); setError("");
    try {
      const r = await submitChallenge(a.attempt_id, a.questions.map((q) => ({ question_id: q.id, chosen_index: given[q.id] ?? null })));
      setResult(r); setAttempt(null); setBoard(await getLeaderboard(slug).catch(() => [])); loadProgress();
    } catch (e: any) { sent.current = false; setError(e.message); }
    setBusy(false);
  }, [slug, loadProgress]);

  useEffect(() => {
    if (!attempt) return;
    const tick = () => { const s = Math.max(0, Math.round((new Date(attempt.expires_at).getTime() - Date.now()) / 1000)); setLeft(s); if (s === 0) void finish(attempt, answers); };
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [attempt, answers, finish]);

  async function start() {
    setBusy(true); setError(""); sent.current = false;
    try { const a = await startChallenge(slug, code, stage); setAttempt(a); setAnswers({}); setIndex(0); setResult(null); } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  const accent = card?.brand?.accent;
  const brandBtn = accent ? { background: accent, color: readableText(accent), borderColor: accent } : undefined;
  if (card === undefined) return <div className="qb-card" role="status">Loading…</div>;
  if (card === null) return <div className="qb-card"><h1>Challenge not found</h1><p><Link className="qb-link" href="/challenges">See open challenges</Link></p></div>;

  if (result) {
    return (
      <>
        <div className="qb-page-head"><div><h1>{result.expired ? "Time was up" : `You scored ${result.score} out of ${result.max_score}`}</h1>
          <p>{result.expired ? "This attempt was submitted after the time limit, so it does not count." : `Finished in ${formatDuration(result.duration_ms ?? 0)}.`}</p></div></div>
        {result.review && <div className="qb-card"><h2>Your answers</h2><ol className="qb-list">{result.review.map((r, i) => (
          <li key={r.question_id}>{r.is_correct ? "Correct" : r.chosen_index === null ? "Not answered" : "Incorrect"}{r.explanation ? `. ${r.explanation}` : ""}<span className="qb-muted qb-small"> (question {i + 1}; the correct option was {String.fromCharCode(65 + r.correct_index)})</span></li>))}</ol></div>}
        <div className="qb-card"><h2>Leaderboard</h2>{board.length === 0 ? <p className="qb-muted">No ranked attempts yet.</p> : <ol className="qb-list">{board.map((b) => <li key={b.rank} style={b.is_me ? { fontWeight: 700 } : undefined}>{b.rank}. {b.name} <span className="qb-muted">{b.score}/{b.max_score} in {formatDuration(b.duration_ms)}</span></li>)}</ol>}</div>
        <p><Link className="qb-btn qb-btn-secondary" href={`/challenges/${slug}`}>Back to the challenge</Link>{" "}{!result.expired && <button className="qb-btn" style={brandBtn} onClick={() => { setResult(null); sent.current = false; }}>Play again</button>}</p>
      </>
    );
  }

  if (attempt) {
    const q = attempt.questions[index];
    const answered = Object.keys(answers).length;
    return (
      <>
        <div className="qb-page-head"><div><h1>{attempt.title}</h1><p>{(attempt.stage_count ?? 1) > 1 ? `${attempt.stage_title ?? `Round ${attempt.stage_no}`} · ` : ""}Question {index + 1} of {attempt.questions.length} · {answered} answered</p></div>
          <div className="qb-chip" role="timer" aria-live="off" style={left <= 30 ? { fontWeight: 700 } : undefined}>{formatDuration(left * 1000)} left</div></div>
        {error && <div className="qb-card qb-error" role="alert">{error}</div>}
        <div className="qb-card">
          <h2 style={{ fontSize: 18 }}>{q.question_text}</h2>
          <div role="radiogroup" aria-label="Answer options" style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {q.options.map((o, i) => (
              <button key={i} role="radio" aria-checked={answers[q.id] === i} className={`qb-btn ${answers[q.id] === i ? "" : "qb-btn-secondary"}`} style={{ textAlign: "left", minHeight: 48, ...(answers[q.id] === i ? brandBtn : {}) }} onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))}>
                <strong>{String.fromCharCode(65 + i)}.</strong> {o}
              </button>
            ))}
          </div>
        </div>
        <div className="qb-card-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="qb-btn qb-btn-secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</button>
          {index < attempt.questions.length - 1 ? <button className="qb-btn" onClick={() => setIndex(index + 1)}>Next</button>
            : <button className="qb-btn" style={brandBtn} disabled={busy} onClick={() => { if (answered === attempt.questions.length || window.confirm(`You have answered ${answered} of ${attempt.questions.length}. Submit anyway?`)) void finish(attempt, answers); }}>{busy ? "Submitting…" : "Submit"}</button>}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="qb-page-head" style={accent ? { borderTop: `6px solid ${accent}` } : undefined}><div>{card.brand?.organiser_name && <p className="qb-eyebrow">{card.brand.organiser_name}{card.brand.tagline ? ` · ${card.brand.tagline}` : ""}</p>}<h1>{card.title}</h1><p>{card.private ? "This is a private challenge. Enter the access code you were given." : card.summary}</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      <div className="qb-card">
        {!card.private && <p>{card.question_count} questions · {formatDuration(card.time_limit_seconds * 1000)} · {card.max_attempts} attempt{card.max_attempts === 1 ? "" : "s"}. The timer starts when you press Start, and answers are scored on the server.</p>}
        {(card.private || card.visibility === "PRIVATE") && <label className="qb-field">Access code<input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label>}
        {progress.length > 1 && (
          <div role="radiogroup" aria-label="Rounds" style={{ display: "grid", gap: 8, margin: "12px 0" }}>
            {progress.map((s) => (
              <label key={s.stage_no} className="qb-check" style={{ opacity: s.state === "OPEN" ? 1 : 0.6 }}>
                <input type="radio" name="stage" disabled={s.state !== "OPEN"} checked={stage === s.stage_no} onChange={() => setStage(s.stage_no)} />
                {" "}<strong>{s.title}</strong> · {s.question_count} questions · {formatDuration(s.time_limit_seconds * 1000)}
                {" "}<span className="qb-muted">{s.state === "LOCKED" ? `Locked: score ${progress[s.stage_no - 2]?.pass_percent ?? 0}% or more in the round before` : s.state === "USED" ? "No attempts left" : s.state === "NOT_OPEN" ? "Not open yet" : s.state === "CLOSED" ? "Closed" : s.best_score !== null ? `Best so far ${s.best_score}/${s.best_max}` : ""}</span>
              </label>))}
          </div>)}
        {card.brand?.welcome && <p>{card.brand.welcome}</p>}
        <p className="qb-muted qb-small">If you win a prize, the organiser may contact you at your account email.</p>
        {card.live ? <button className="qb-btn" style={brandBtn} disabled={busy || (progress.length > 0 && !progress.some((s) => s.stage_no === stage && s.state === "OPEN"))} onClick={start}>{busy ? "Starting…" : "Start"}</button> : <p className="qb-muted">This challenge is not open right now.</p>}
      </div>
    </>
  );
}
