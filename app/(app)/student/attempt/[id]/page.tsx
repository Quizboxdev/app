"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import QuestionRenderer from "@/components/QuestionRenderer";
import AnswerInput, { AnswerState } from "@/components/AnswerInput";
import {
  getAttempt,
  saveResponse,
  submitAttempt,
} from "@/lib/api/assessment";
import type { AttemptPayload } from "@/lib/types";

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

  useEffect(() => {
    getAttempt(params.id)
      .then((payload) => {
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
    if (attempt && seconds === 0) {
      submitAttempt(params.id, "time_expired")
        .then(() => router.replace(`/student/results/${params.id}`))
        .catch((e) => setError(e.message));
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
    setSaving(true);

    const started = startTimes.current[question.question_id] ?? Date.now();
    const responseSeconds = Math.max(
      0,
      Math.round((Date.now() - started) / 1000)
    );

    try {
      await saveResponse({
        attemptId: params.id,
        questionId: question.question_id,
        selectedAnswer: value.selectedAnswer ?? null,
        selectedValue: value.selectedValue ?? null,
        responseSeconds,
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    if (!confirm("Submit this assessment now?")) return;
    try {
      await submitAttempt(params.id);
      router.replace(`/student/results/${params.id}`);
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!attempt || !question) return <div>Loading assessment…</div>;

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Assessment</h1>
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
                Next
              </button>
            ) : (
              <button className="qb-btn" onClick={submit}>
                Submit assessment
              </button>
            )}
          </div>
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
