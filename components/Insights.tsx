"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { studentInsights, teacherInsights } from "@/lib/api/platform";

// Server-derived analytics only; the client formats but never computes official figures.
function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState("");
  useEffect(() => { load().then(setData).catch((cause) => setError((cause as Error).message)); }, [load]);
  return { data, error };
}
const Table = ({ head, rows, empty }: { head: string[]; rows: Array<Array<React.ReactNode>>; empty: string }) => rows.length
  ? <div className="qb-table-wrap"><table className="qb-table"><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
  : <p className="qb-muted">{empty}</p>;

export function StudentInsights() {
  const { data, error } = useLoad<Record<string, any>>(studentInsights);
  if (error) return <p className="qb-error" role="alert">{error}</p>;
  if (!data) return <p className="qb-muted" role="status">Loading insights…</p>;
  return <section className="qb-card" aria-labelledby="student-insights"><h2 id="student-insights">My progress</h2>
    <p>{data.recent_improvement === null || data.recent_improvement === undefined ? "Complete more assessments to see your trend." : `Recent change: ${data.recent_improvement > 0 ? "+" : ""}${data.recent_improvement} points versus your previous five results.`}</p>
    <h3>Mastery by subject</h3><Table head={["Subject", "Mastery", "Topics"]} rows={(data.by_subject ?? []).map((s: any) => [s.subject, `${s.mastery}%`, s.topics])} empty="No mastery data yet."/>
    <h3>Weak areas</h3><Table head={["Topic", "Mastery"]} rows={(data.weak_topics ?? []).map((w: any) => [w.topic, `${w.mastery}%`])} empty="No weak areas identified."/>
    <h3>Attempt history</h3><Table head={["Subject", "Score", "Submitted"]} rows={(data.history ?? []).map((h: any) => [<Link key={h.attempt_id} href={`/student/results/${h.attempt_id}`}>{h.subject || "Assessment"}</Link>, `${h.percentage}%`, new Date(h.submitted_at).toLocaleDateString()])} empty="No attempts yet."/>
  </section>;
}

export function TeacherInsights() {
  const { data, error } = useLoad<Record<string, any>>(teacherInsights);
  if (error) return <p className="qb-error" role="alert">{error}</p>;
  if (!data) return <p className="qb-muted" role="status">Loading insights…</p>;
  return <section className="qb-card" aria-labelledby="teacher-insights"><h2 id="teacher-insights">Class insights</h2>
    <h3>Assignment completion</h3><Table head={["Assignment", "Class", "Submitted", "Due"]} rows={(data.assignment_completion ?? []).map((a: any) => [a.assignment, a.class ?? "-", `${a.submitted}/${a.targets}`, a.due_at ? new Date(a.due_at).toLocaleDateString() : "-"])} empty="No published assignments."/>
    <h3>Student progress</h3><Table head={["Student", "Results", "Average", "Latest"]} rows={(data.student_progress ?? []).map((s: any) => [s.student, s.results, `${s.average}%`, `${s.last}%`])} empty="No results yet."/>
    <h3>Hardest questions</h3><Table head={["Question", "Responses", "Accuracy"]} rows={(data.question_difficulty ?? []).map((q: any) => [q.question, q.responses, `${q.accuracy}%`])} empty="Not enough responses yet."/>
  </section>;
}
