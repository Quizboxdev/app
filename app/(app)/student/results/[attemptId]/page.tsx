"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getAttemptReview } from "@/lib/api/assessment";

export default function AttemptReviewPage() {
  const params = useParams<{ attemptId: string }>();
  const [review, setReview] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getAttemptReview(params.attemptId)
      .then(setReview)
      .catch((e) => setError(e.message));
  }, [params.attemptId]);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!review) return <div>Loading review…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Assessment Review</h1>
          <p>
            Score: {review.result?.score}/{review.result?.total_marks} ·{" "}
            {Math.round(Number(review.result?.percentage ?? 0))}%
          </p>
        </div>
      </div>

      <div className="qb-list">
        {(review.questions ?? []).map((q: any, index: number) => (
          <div className="qb-card" key={q.question_id}>
            <div className="qb-question-number">QUESTION {index + 1}</div>
            <div className="qb-question-text">{q.question_text}</div>
            <p>
              <strong>Your answer:</strong>{" "}
              {q.selected_answer ??
                (q.selected_value
                  ? JSON.stringify(q.selected_value)
                  : "Unanswered")}
            </p>
            <p>
              <strong>Correct answer:</strong>{" "}
              {q.correct_answer ??
                (q.answer_spec ? JSON.stringify(q.answer_spec) : "—")}
            </p>
            <span className={`qb-pill ${q.is_correct ? "success" : "warning"}`}>
              {q.is_correct ? "Correct" : "Review"}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
