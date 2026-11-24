"use client";

import { useEffect, useState } from "react";
import { adminMockListing, type AdminMockListing as Detail } from "@/lib/api/mock-exams";
import { gradeLabel } from "@/lib/mock-exams/grades";
import { purposeLabel } from "@/lib/mock-exams/purposes";

// For the staff who approve Marketplace listings: a mock exam has no question copy of its own, so the generic review shows no questions. This shows what the exam really contains, with its answers, and warns if a
// question has changed since the version was published (such a version cannot be opened for a new buyer).
export default function AdminMockListing({ itemId }: { itemId: string }) {
  const [d, setD] = useState<Detail | null | undefined>(undefined);
  useEffect(() => { setD(undefined); adminMockListing(itemId).then(setD).catch(() => setD(null)); }, [itemId]);
  if (!d) return d === undefined ? <p className="qb-muted qb-small" role="status">Checking for a mock exam…</p> : null;
  return (
    <div className="qb-card" style={{ display: "grid", gap: 8 }} aria-label="Mock exam contents">
      <strong>This listing is a mock exam (version {d.version_no})</strong>
      <p className="qb-small qb-muted" style={{ margin: 0 }}>{purposeLabel(d.purpose)} · target {gradeLabel(d.target_grade)} · {d.question_count} questions · {d.total_marks} marks · {d.time_limit_minutes} minutes · {d.attempts_allowed} attempt{d.attempts_allowed === 1 ? "" : "s"}.
        Check that the questions are suitable for the target year before approving. QuizBox holds no WAEC syllabus mapping, so a “BECE” or “WASSCE” label is the seller’s own description.</p>
      {d.stale_questions > 0 && <p className="qb-error" role="alert">{d.stale_questions} question{d.stale_questions === 1 ? " has" : "s have"} changed or been withdrawn since this version was published. Do not approve it; ask the seller to publish a new version.</p>}
      <ul className="qb-list" style={{ margin: 0 }}>{d.rounds.map((r, i) => <li key={i}>{gradeLabel(r.grade_code)} · {r.subject_label} · {r.topic_title} · {r.selected} questions</li>)}</ul>
      <details><summary>Show all {d.questions.length} questions with answers</summary>
        <ol className="qb-list">{d.questions.map((q) => <li key={q.position} value={q.position}>{q.question_text}<div className="qb-small qb-muted">{q.answer_type.replaceAll("_", " ").toLowerCase()} · {gradeLabel(q.grade_code)} · correct: {q.correct_answer}</div></li>)}</ol></details>
    </div>
  );
}
