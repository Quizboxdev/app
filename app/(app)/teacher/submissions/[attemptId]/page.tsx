"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getTeacherSubmission } from "@/lib/api/teacher";
import { classifyProficiency } from "@/lib/learning/proficiency";

export default function TeacherSubmissionPage() {
  const params = useParams<{ attemptId: string }>();
  const [data, setData] = useState<any>(null), [error, setError] = useState("");
  useEffect(() => { getTeacherSubmission(params.attemptId).then(setData).catch((reason) => setError(reason.message)); }, [params.attemptId]);
  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!data) return <div>Loading submission...</div>;
  const grade = data.grade;
  return <><div className="qb-page-head"><div><h1>{grade.student_name ?? grade.student_email ?? "Student"}</h1><p>{grade.score}/{grade.total_marks} · {Math.round(Number(grade.percentage))}% · {classifyProficiency(Number(grade.percentage))}</p></div></div><div className="qb-card"><h2>Indicator evidence</h2><div className="qb-list">{data.events.map((event: any, index: number) => { const node = Array.isArray(event.curriculum_nodes) ? event.curriculum_nodes[0] : event.curriculum_nodes; return <div className="qb-row" key={index}><div className="qb-row-main"><strong>{node?.code ?? "Unmapped"}</strong><span>{node?.title ?? "Curriculum mapping unavailable"} · {event.response_seconds}s</span></div><span className={`qb-pill ${event.is_correct ? "success" : "warning"}`}>{event.is_correct ? "Correct" : "Needs support"}</span></div>; })}</div></div></>;
}
