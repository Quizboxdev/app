"use client";

import ReportQuestion from "@/components/ReportQuestion";
import MasteryBadge from "@/components/MasteryBadge";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getAttemptLearningSummary, getAttemptReview, startAttempt } from "@/lib/api/assessment";
import { classifyProficiency } from "@/lib/learning/proficiency";
import { masteryLevel } from "@/lib/learning/mastery";
import { practiseHref } from "@/lib/learning/labels";

type Indicator = { code: string; title: string; percentage: number; correct: number; total: number };

export default function AttemptResultPage() {
  const params = useParams<{ attemptId: string }>();
  const router = useRouter();
  const [review, setReview] = useState<any>(null), [summary, setSummary] = useState<any>(null), [error, setError] = useState(""), [retrying, setRetrying] = useState(false);
  useEffect(() => {
    Promise.all([getAttemptReview(params.attemptId), getAttemptLearningSummary(params.attemptId)])
      .then(([nextReview, nextSummary]) => { setReview(nextReview); setSummary(nextSummary); })
      .catch((reason) => setError(reason.message));
  }, [params.attemptId]);

  if (error && !review) return <div className="qb-card qb-error" role="alert">{error}</div>;
  if (!review || !summary) return <div className="qb-card qb-skeleton" aria-busy="true" aria-label="Loading result" />;

  const result = summary.result ?? review.result ?? {};
  const percentage = Number(result.percentage ?? 0);
  const indicators: Indicator[] = [...summary.indicators].filter((row: Indicator) => row.total > 0).sort((a: Indicator, b: Indicator) => b.percentage - a.percentage);
  const strongest = indicators[0];
  const weakest = indicators.length > 1 ? indicators[indicators.length - 1] : indicators[0]?.percentage < 68 ? indicators[0] : undefined;
  const assessmentId = result.assessment_id ?? review.assessment_id;
  const questions: any[] = review.questions ?? [];
  const stat = (value: unknown) => Number(value ?? 0);
  const answeredTotal = stat(result.correct_count ?? result.correct) + stat(result.incorrect_count ?? result.incorrect);
  const needsWork = weakest && weakest.percentage < 68;

  async function tryAgain() {
    setRetrying(true); setError("");
    try { router.push(`/student/attempt/${((await startAttempt({ assessmentId })) as any).attempt_id}`); }
    catch (e: any) { setError(e.message); setRetrying(false); }
  }

  return (
    <>
      <div className="qb-page-head"><div><h1>Your result</h1><p>{result.passed === true ? "You passed this assessment." : result.passed === false ? "Not passed yet. Every attempt builds mastery." : "Here is how you did."}</p></div></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}

      <section className="qb-card qb-result-hero" aria-labelledby="rs-score">
        <div>
          <div className="qb-result-score" id="rs-score">{Math.round(percentage)}%</div>
          <p className="qb-muted qb-small">{result.score}/{result.total_marks} marks</p>
          <div className="qb-actions" style={{ marginTop: 8 }}>
            <span className="qb-pill" title="Official proficiency band">{classifyProficiency(percentage)}</span>
            <MasteryBadge percentage={percentage} evidence={answeredTotal || undefined} />
          </div>
          <p className="qb-muted qb-small" style={{ margin: "6px 0 0" }}>Proficiency is the official band; mastery reflects QuizBox practice. They are measured separately.</p>
        </div>
        <dl className="qb-result-stats">
          <div><dt>Correct</dt><dd>{stat(result.correct_count ?? result.correct)}</dd></div>
          <div><dt>Incorrect</dt><dd>{stat(result.incorrect_count ?? result.incorrect)}</dd></div>
          <div><dt>Unanswered</dt><dd>{stat(result.unanswered_count ?? result.unanswered)}</dd></div>
          <div><dt>XP earned</dt><dd>+{stat(summary.xpEarned)}</dd></div>
        </dl>
      </section>

      <div className="qb-grid cols-2" style={{ marginTop: 16 }}>
        <section className="qb-card" aria-labelledby="rs-strong">
          <h2 id="rs-strong">Strongest area</h2>
          {strongest ? <><p><strong>{strongest.title}</strong>{strongest.code ? <span className="qb-muted"> · {strongest.code}</span> : null}</p><p className="qb-muted">{Math.round(strongest.percentage)}% ({strongest.correct}/{strongest.total} correct) · <MasteryBadge percentage={strongest.percentage} evidence={strongest.total} /></p></> : <p className="qb-muted">Not enough curriculum-tagged questions to show this yet.</p>}
        </section>
        <section className="qb-card" aria-labelledby="rs-weak">
          <h2 id="rs-weak">Area to work on</h2>
          {weakest && needsWork ? <><p><strong>{weakest.title}</strong>{weakest.code ? <span className="qb-muted"> · {weakest.code}</span> : null}</p><p className="qb-muted">{Math.round(weakest.percentage)}% ({weakest.correct}/{weakest.total} correct) · {masteryLevel(weakest.percentage, weakest.total)}</p></> : <p className="qb-muted">{indicators.length ? "No weak areas in this attempt. Nice work." : "Not enough curriculum-tagged questions to show this yet."}</p>}
        </section>
      </div>

      <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="rs-next">
        <h2 id="rs-next">What next?</h2>
        <p className="qb-muted">{needsWork ? `Practise ${weakest!.title} to lift your mastery.` : percentage >= 85 ? "You are mastering this. Try a competition or a harder set." : "Keep practising to build consistency."}</p>
        <div className="qb-actions">
          <a className="qb-btn secondary" href="#review">Review answers</a>
          <Link className="qb-btn" href={practiseHref()}>Practise weak areas</Link>
          {assessmentId && <button className="qb-btn secondary" disabled={retrying} onClick={() => void tryAgain()}>{retrying ? "Starting…" : "Try again"}</button>}
          <Link className="qb-btn ghost" href="/student">Return home</Link>
        </div>
      </section>

      <section id="review" style={{ marginTop: 16 }} aria-labelledby="rs-review">
        <h2 id="rs-review">Review answers</h2>
        <div className="qb-list">
          {questions.map((question: any, index: number) => {
            const answered = question.selected_answer ?? (question.selected_value ? JSON.stringify(question.selected_value) : null);
            return <div className={`qb-card qb-answer-item ${question.is_correct ? "right" : "wrong"}`} key={question.question_id}>
              <div className="qb-actions" style={{ justifyContent: "space-between" }}>
                <span className="qb-question-number" style={{ margin: 0 }}>Question {index + 1} <span className={`qb-pill ${question.is_correct ? "success" : "amber"}`}>{question.is_correct ? "Correct" : answered ? "Incorrect" : "Unanswered"}</span></span>
                <ReportQuestion questionId={question.question_id} />
              </div>
              <div className="qb-question-text">{question.question_text}</div>
              <p><strong>Your answer:</strong> {answered ?? "Unanswered"}</p>
              {!question.is_correct && <p><strong>Correct answer:</strong> {question.correct_answer ?? (question.answer_spec ? JSON.stringify(question.answer_spec) : "Not available")}</p>}
            </div>;
          })}
        </div>
      </section>
    </>
  );
}
