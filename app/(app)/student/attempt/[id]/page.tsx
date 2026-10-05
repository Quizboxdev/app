"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import QuestionRenderer from "@/components/QuestionRenderer";
import AnswerInput, { AnswerState } from "@/components/AnswerInput";
import {
  getAttempt,
  getAttemptMode,
  listAvailableAssessments,
  savePracticeResponse,
  saveResponse,
  submitAttempt,
} from "@/lib/api/assessment";
import type { AttemptPayload } from "@/lib/types";
import { canRevealPracticeFeedback, type PracticeFeedback } from "@/lib/learning/feedback";
import ReportQuestion from "@/components/ReportQuestion";
import { sanitizeLabel } from "@/lib/learning/labels";
import { Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock } from "lucide-react";

// Option keys ("B", ["A","C"]) are shown with their option text where the question carries it.
function describeAnswer(question: AttemptPayload["questions"][number], raw: unknown): string {
  if (raw == null || raw === "") return "No answer";
  let keys: unknown[] = [raw];
  if (typeof raw === "string" && raw.trim().startsWith("[")) { try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) keys = parsed; } catch { /* keep raw text */ } }
  else if (Array.isArray(raw)) keys = raw;
  const q = question as any;
  return keys.map((key) => {
    const k = String(key);
    const text = q.options?.find((o: any) => o.option_key === k)?.content?.blocks?.map((b: any) => b.text ?? "").join(" ").trim() || q[`option_${k.toLowerCase()}`];
    return text && text !== k ? `${k}. ${text}` : k;
  }).join(", ");
}

export default function AttemptPage() {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const resultPath = `${pathname.startsWith('/competition/attempt/') ? '/competition' : '/student'}/results/${params.id}`;
  const router = useRouter();
  const [attempt, setAttempt] = useState<AttemptPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [index, setIndex] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const startTimes = useRef<Record<string, number>>({});
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const submitting = useRef(false);
  const [mode, setMode] = useState("ASSESSMENT");
  const [feedback, setFeedback] = useState<Record<string, PracticeFeedback>>({});
  const [confirming, setConfirming] = useState(false);
  const [submitConfirmation, setSubmitConfirmation] = useState(false);
  const [context, setContext] = useState("");

  useEffect(() => {
    Promise.all([getAttempt(params.id), getAttemptMode(params.id)])
      .then(([payload, attemptMode]) => {
        setMode(attemptMode);
        setAttempt(payload);
        setSeconds(Number(payload.remaining_seconds ?? 0));
        const saved: Record<string, AnswerState> = {};
        for (const response of payload.saved_responses ?? []) {
          saved[response.question_id] = {
            selectedAnswer: response.selected_answer ?? null,
            selectedValue: response.selected_value ?? null,
          };
        }
        setAnswers(saved);
      })
      .catch((e) => setError(e.message));
  }, [params.id]);

  // Subject and grade come from the assessment the student can already list; assigned or competition attempts that are not listed simply show no context.
  useEffect(() => {
    if (!attempt?.assessment_id) return;
    let active = true;
    listAvailableAssessments().then((rows: any[]) => {
      const row = rows.find((r) => r.id === attempt.assessment_id);
      if (active && row) setContext([sanitizeLabel(row.subject_name ?? row.subject_code), row.grade].filter(Boolean).join(" · "));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [attempt?.assessment_id]);

  useEffect(() => {
    if (!attempt) return;
    const timer = window.setInterval(() => {
      setSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attempt]);

  useEffect(() => {
    if (attempt && seconds === 0 && !submitting.current) {
      submitting.current = true;
      submitAttempt(params.id, "time_expired")
        .then(() => router.replace(resultPath))
        .catch((e) => { submitting.current = false; setError(e.message); });
    }
  }, [attempt, seconds, params.id, router, resultPath]);

  const question = attempt?.questions[index];
  const questionId = question?.question_id;

  useEffect(() => {
    if (questionId) {
      startTimes.current[questionId] = Date.now();
    }
  }, [questionId]);

  async function answer(value: AnswerState) {
    if (!question) return;
    setAnswers((prev) => ({ ...prev, [question.question_id]: value }));
    setFeedback((prev) => { const next = { ...prev }; delete next[question.question_id]; return next; });
    setSaving(true);

    const started = startTimes.current[question.question_id] ?? Date.now();
    const responseSeconds = Math.max(
      0,
      Math.round((Date.now() - started) / 1000)
    );

    try {
      const job = pendingSave.current.catch(() => {}).then(async () => { await saveResponse({
        attemptId: params.id,
        questionId: question.question_id,
        selectedAnswer: value.selectedAnswer ?? null,
        selectedValue: value.selectedValue ?? null,
        responseSeconds,
      }); });
      pendingSave.current = job;
      await job;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (submitting.current || saving || confirming) return;
    submitting.current = true;
    try {
      await pendingSave.current;
      await submitAttempt(params.id);
      router.replace(resultPath);
    } catch (e: any) {
      submitting.current = false;
      setError(e.message);
    }
  }

  async function confirmAnswer() {
    if (!question || confirming || saving) return;
    setConfirming(true);
    const questionId = question.question_id;
    try {
      await pendingSave.current;
      const value = answers[questionId] ?? {};
      const response = await savePracticeResponse({ attemptId: params.id, questionId, selectedAnswer: value.selectedAnswer, selectedValue: value.selectedValue });
      setFeedback((prev) => ({ ...prev, [questionId]: response }));
    } catch (reason: any) { setError(reason.message); }
    finally { setConfirming(false); }
  }

  if (error && !attempt) return <div className="qb-card qb-error" role="alert">{error}</div>;
  if (!attempt || !question) return <div className="qb-card qb-skeleton" aria-busy="true" aria-label="Loading questions" />;

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const total = attempt.questions.length;
  const isAnswered = (id: string) => (answers[id]?.selectedAnswer != null && answers[id]?.selectedAnswer !== "") || answers[id]?.selectedValue != null;
  const answeredCount = attempt.questions.filter((q) => isAnswered(q.question_id)).length;
  const practice = mode === "PRACTICE";
  const current = answers[question.question_id] ?? {};
  const shown = canRevealPracticeFeedback(mode, question.question_id, feedback[question.question_id]) ? feedback[question.question_id] : null;
  const last = index === total - 1;

  return (
    <div className="qb-player">
      <div className="qb-player-bar">
        <div className="qb-player-meta">
          <div className="qb-player-title">
            <strong>{practice ? "Practice" : "Assessment"}</strong>
            {context && <span className="qb-small qb-player-context">{context}</span>}
            <span className="qb-muted qb-small">Question {index + 1} of {total}{question.marks ? ` · ${question.marks} mark${Number(question.marks) === 1 ? "" : "s"}` : ""}{saving ? " · Saving…" : ""}</span>
          </div>
          <div className="qb-actions">
            {attempt.expires_at && <span className={`qb-pill ${seconds < 60 ? "danger" : "neutral"}`} role="timer" aria-label={`Time remaining ${mm}:${ss}`}><Clock size={13} aria-hidden="true" />{mm}:{ss}</span>}
            <ReportQuestion questionId={question.question_id} />
          </div>
        </div>
        <div className="qb-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answeredCount} aria-label="Questions answered"><div className="qb-progress-fill" style={{ width: `${(answeredCount / total) * 100}%` }} /></div>
      </div>

      {error && <div className="qb-card qb-error" role="alert">{error}</div>}

      <section className="qb-player-card" aria-label={`Question ${index + 1}`}>
        <QuestionRenderer question={question} />
        <AnswerInput question={question} value={current} onChange={answer} />

        {practice && !shown && <button className="qb-btn" disabled={saving || confirming || !isAnswered(question.question_id)} onClick={confirmAnswer}>{confirming ? "Checking…" : "Check answer"}</button>}
        {shown && <div role="status" className={`qb-feedback ${shown.is_correct ? "correct" : "incorrect"}`}>
          <h3>{shown.is_correct ? <CircleCheck size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />} {shown.is_correct ? "Correct" : "Not quite"}</h3>
          <p><strong>Your answer:</strong> {describeAnswer(question, shown.selected_answer ?? (typeof shown.selected_value === "string" ? shown.selected_value : shown.selected_value != null ? JSON.stringify(shown.selected_value) : null))}</p>
          {!shown.is_correct && <p><strong>Correct answer:</strong> {describeAnswer(question, shown.correct_answer)}</p>}
          {shown.explanation && <p><strong>Why:</strong> {shown.explanation}</p>}
          {shown.hint && !shown.is_correct && <p><strong>Hint:</strong> {shown.hint}</p>}
          <div className="qb-actions" style={{ marginTop: 10 }}>
            {last ? <button className="qb-btn" onClick={() => setSubmitConfirmation(true)}><Check size={16} aria-hidden="true" />Finish practice</button>
              : <button className="qb-btn" onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>Next question<ChevronRight size={16} aria-hidden="true" /></button>}
          </div>
        </div>}
      </section>

      <div className="qb-player-nav">
        <button className="qb-btn ghost" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}><ChevronLeft size={16} aria-hidden="true" />Previous</button>
        {last
          ? <button className="qb-btn" onClick={() => setSubmitConfirmation(true)}><Check size={16} aria-hidden="true" />{practice ? "Finish practice" : "Submit"}</button>
          : <button className="qb-btn" onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>{practice ? "Continue" : "Next"}<ChevronRight size={16} aria-hidden="true" /></button>}
      </div>

      {submitConfirmation && <div className="qb-confirm" role="dialog" aria-label="Confirm submission">
        <p>{answeredCount < total ? `You have answered ${answeredCount} of ${total} questions. Submit anyway?` : "Submit your answers now?"}</p>
        <div className="qb-actions">
          <button className="qb-btn" disabled={saving || confirming} onClick={submit}>Confirm submission</button>
          <button className="qb-btn secondary" onClick={() => setSubmitConfirmation(false)}>Keep working</button>
        </div>
      </div>}

      <nav className="qb-card" aria-label="Question navigator">
        <div className="qb-player-dots">
          {attempt.questions.map((q, i) => <button key={q.question_id} type="button" className={`qb-player-dot${isAnswered(q.question_id) ? " answered" : ""}`} aria-current={i === index ? "true" : undefined} aria-label={`Question ${i + 1}${isAnswered(q.question_id) ? ", answered" : ""}`} onClick={() => setIndex(i)}>{i + 1}</button>)}
        </div>
      </nav>
    </div>
  );
}
