"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { bootstrapUser } from "@/lib/auth";
import { listGradebook } from "@/lib/api/teacher";
import { classifyProficiency } from "@/lib/learning/proficiency";

export default function TeacherGradebookPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [classId, setClassId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const teacherId = String((ctx.teacherProfile as any)?.id ?? "");
        if (!teacherId) throw new Error("Teacher profile not found.");
        return listGradebook(teacherId);
      })
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  const visible = rows.filter((row) => (!classId || row.class_id === classId) && (!assignmentId || row.assignment_id === assignmentId));

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Gradebook</h1>
          <p>Assessment outcomes across your classes.</p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}
      <div className="qb-actions"><select aria-label="Filter class" value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">All classes</option>{[...new Set(rows.map((row) => row.class_id).filter(Boolean))].map((id) => <option key={id} value={id}>{id}</option>)}</select><select aria-label="Filter assignment" value={assignmentId} onChange={(event) => setAssignmentId(event.target.value)}><option value="">All assignments</option>{[...new Set(rows.map((row) => row.assignment_id).filter(Boolean))].map((id) => <option key={id} value={id}>{id}</option>)}</select></div>

      <div className="qb-card qb-table-wrap">
        <table className="qb-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Score</th>
              <th>Percentage</th>
              <th>Status</th>
              <th>Proficiency</th>
              <th>Graded</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <td>{row.student_name ?? row.student_email ?? "Student"}</td>
                <td>
                  {row.score}/{row.total_marks}
                </td>
                <td>{Math.round(Number(row.percentage ?? 0))}%</td>
                <td>{row.status ?? ""}</td>
                <td>{classifyProficiency(Number(row.percentage ?? 0))}</td>
                <td>
                  {row.graded_at
                    ? new Date(row.graded_at).toLocaleString()
                    : ""}
                </td>
                <td><Link href={`/teacher/submissions/${row.attempt_id}`}>View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
