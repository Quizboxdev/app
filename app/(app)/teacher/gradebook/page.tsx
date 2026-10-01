"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { listGradebook } from "@/lib/api/teacher";

export default function TeacherGradebookPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");

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

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Gradebook</h1>
          <p>Assessment outcomes across your classes.</p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

      <div className="qb-card qb-table-wrap">
        <table className="qb-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Score</th>
              <th>Percentage</th>
              <th>Status</th>
              <th>Graded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.student_name ?? row.student_email ?? "Student"}</td>
                <td>
                  {row.score}/{row.total_marks}
                </td>
                <td>{Math.round(Number(row.percentage ?? 0))}%</td>
                <td>{row.status ?? ""}</td>
                <td>
                  {row.graded_at
                    ? new Date(row.graded_at).toLocaleString()
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
