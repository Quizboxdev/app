"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import QuestionRenderer from "@/components/QuestionRenderer";
import AnswerInput, { AnswerState } from "@/components/AnswerInput";
import {
  getAttempt,
  getAttemptMode,
  savePracticeResponse,
  saveResponse,
  submitAttempt,
} from "@/lib/api/assessment";
import type { AttemptPayload } from "@/lib/types";
import { canRevealPracticeFeedback, type PracticeFeedback } from "@/lib/learning/feedback";

export default function AttemptPage() {
  const params = useParams<{ id: string }>();
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
        .then(() => router.replace(`/student/results/${params.id}`))
        .catch((e) => { submitting.current = false; setError(e.message); });
    }
  }, [attempt, seconds, params.id, router]);

  const question = attempt?.questions[index];
  const questionId = question?.question_id;

  useEffect(() => {
    if (questionId) {
      startTimes.current[questionId] = Date.now();
    }
  }, [questionId]);

  const progress = useMemo(() => {
    if (!attempt?.questions.length) return 0;
    return ((index + 1) / attempt.questions.length) * 100;
  }, [attempt, index]);

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
      router.replace(`/student/results/${params.id}`);
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

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!attempt || !question) return <div>Loading assessment…</div>;

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>{mode === "PRACTICE" ? "Practice" : "Assessment"}</h1>
          <p>
            Question {index + 1} of {attempt.questions.length}
          </p>
        </div>
        <div className={`qb-timer ${seconds < 60 ? "danger" : ""}`}>
          {mm}:{ss}
        </div>
      </div>

      <div className="qb-progress-track">
        <div className="qb-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div style={{ height: 18 }} />

      <div className="qb-attempt-layout">
        <div className="qb-question-card">
          <div className="qb-question-number">
            QUESTION {index + 1}
            {saving ? " · Saving…" : ""}
          </div>

          <QuestionRenderer question={question} />

          <AnswerInput
            question={question}
            value={answers[question.question_id] ?? {}}
            onChange={answer}
          />

          {mode === "PRACTICE" && <button className="qb-btn" disabled={saving || confirming || (!answers[question.question_id]?.selectedAnswer && answers[question.question_id]?.selectedValue == null)} onClick={confirmAnswer}>{confirming ? "Checking..." : "Confirm answer"}</button>}
          {canRevealPracticeFeedback(mode, question.question_id, feedback[question.question_id]) && <div role="status" className="qb-feedback">
            <h3>{feedback[question.question_id].is_correct ? "Correct" : "Incorrect"}</h3>
            <p>Your answer: {feedback[question.question_id].selected_answer ?? JSON.stringify(feedback[question.question_id].selected_value)}</p>
            <p>Correct answer: {feedback[question.question_id].correct_answer}</p>
            {feedback[question.question_id].explanation && <p>{feedback[question.question_id].explanation}</p>}
            {feedback[question.question_id].hint && <p>Hint: {feedback[question.question_id].hint}</p>}
          </div>}

          <div
            style={{
              display: "flex",
              gap: 10,
              justifyContent: "space-between",
              marginTop: 20,
            }}
          >
            <button
              className="qb-btn secondary"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              Previous
            </button>

            {index < attempt.questions.length - 1 ? (
              <button
                className="qb-btn"
                onClick={() =>
                  setIndex((i) =>
                    Math.min(attempt.questions.length - 1, i + 1)
                  )
                }
              >
                {mode === "PRACTICE" ? "Continue" : "Next"}
              </button>
            ) : (
              <button className="qb-btn" onClick={() => setSubmitConfirmation(true)}>
                {mode === "PRACTICE" ? "Submit practice" : "Submit assessment"}
              </button>
            )}
          </div>
          {submitConfirmation && <div role="dialog" aria-label="Confirm submission"><p>Submit your answers now?</p><button className="qb-btn" disabled={saving || confirming} onClick={submit}>Confirm submission</button><button className="qb-btn secondary" onClick={() => setSubmitConfirmation(false)}>Keep working</button></div>}
        </div>

        <aside className="qb-card">
          <h3>Questions</h3>
          <div className="qb-grid cols-4">
            {attempt.questions.map((q, i) => {
              const answered = Boolean(
                answers[q.question_id]?.selectedAnswer ||
                  answers[q.question_id]?.selectedValue
              );
              return (
                <button
                  key={q.question_id}
                  className={`qb-btn ${
                    i === index ? "" : answered ? "secondary" : "ghost"
                  }`}
                  onClick={() => setIndex(i)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    </>
  );
}
