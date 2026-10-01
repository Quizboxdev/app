"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getAttemptLearningSummary, getAttemptReview } from "@/lib/api/assessment";
import { classifyProficiency } from "@/lib/learning/proficiency";

export default function AttemptReviewPage() {
  const params = useParams<{ attemptId: string }>();
  const [review, setReview] = useState<any>(null), [summary, setSummary] = useState<any>(null), [error, setError] = useState("");
  useEffect(() => { Promise.all([getAttemptReview(params.attemptId), getAttemptLearningSummary(params.attemptId)]).then(([nextReview, nextSummary]) => { setReview(nextReview); setSummary(nextSummary); }).catch((reason) => setError(reason.message)); }, [params.attemptId]);
  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!review || !summary) return <div>Loading review...</div>;
  const result = summary.result ?? review.result ?? {}, percentage = Number(result.percentage ?? 0);
  const strengths = summary.indicators.filter((row: any) => row.percentage >= 68), weaknesses = summary.indicators.filter((row: any) => row.percentage < 54);
  return <>
    <div className="qb-page-head"><div><h1>Assessment Result</h1><p>Score: {result.score}/{result.total_marks} · {Math.round(percentage)}% · {classifyProficiency(percentage)}</p></div></div>
    <div className="qb-grid cols-4"><div className="qb-card"><strong>{result.correct_count ?? result.correct ?? 0}</strong><p>Correct</p></div><div className="qb-card"><strong>{result.incorrect_count ?? result.incorrect ?? 0}</strong><p>Incorrect</p></div><div className="qb-card"><strong>{result.unanswered_count ?? result.unanswered ?? 0}</strong><p>Unanswered</p></div><div className="qb-card"><strong>+{summary.xpEarned}</strong><p>XP earned</p></div></div>
    <div className="qb-grid cols-2"><div className="qb-card"><h2>Strengths</h2>{strengths.map((row: any) => <p key={row.code}>{row.code} · {Math.round(row.percentage)}%</p>)}{!strengths.length && <p className="qb-muted">More evidence is needed.</p>}</div><div className="qb-card"><h2>Review next</h2>{weaknesses.map((row: any) => <p key={row.code}>{row.code} · {row.title} · {Math.round(row.percentage)}%</p>)}{!weaknesses.length && <p className="qb-muted">No weak indicators in this attempt.</p>}</div></div>
    <div className="qb-list">{(review.questions ?? []).map((question: any, index: number) => <div className="qb-card" key={question.question_id}><div className="qb-question-number">QUESTION {index + 1}</div><div className="qb-question-text">{question.question_text}</div><p><strong>Your answer:</strong> {question.selected_answer ?? (question.selected_value ? JSON.stringify(question.selected_value) : "Unanswered")}</p><p><strong>Correct answer:</strong> {question.correct_answer ?? (question.answer_spec ? JSON.stringify(question.answer_spec) : "Not available")}</p><span className={`qb-pill ${question.is_correct ? "success" : "warning"}`}>{question.is_correct ? "Correct" : "Review"}</span></div>)}</div>
  </>;
}
