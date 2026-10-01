"use client";

import { useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { getStudentClassroom } from "@/lib/api/student";

export default function StudentClassroomPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const studentId = String((ctx.studentProfile as any)?.id ?? "");
        if (!studentId) throw new Error("Student profile not found.");
        return getStudentClassroom(studentId);
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="qb-card qb-error">{error}</div>;
  if (!data) return <div>Loading classroom…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Classroom</h1>
          <p>Your joined classes and teacher assignments.</p>
        </div>
      </div>

      <div className="qb-grid cols-2">
        <div className="qb-card">
          <h2>My classes</h2>
          <div className="qb-list">
            {data.memberships.map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.classes?.class_name ?? "Class"}</strong>
                  <span>
                    {row.classes?.grade ?? ""} · {row.status}
                  </span>
                </div>
              </div>
            ))}
            {!data.memberships.length && (
              <div className="qb-muted">No classes joined.</div>
            )}
          </div>
        </div>

        <div className="qb-card">
          <h2>Assignments</h2>
          <div className="qb-list">
            {data.assignments.map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.title ?? "Assignment"}</strong>
                  <span>
                    {row.subject_code ?? ""}{" "}
                    {row.due_at
                      ? `· Due ${new Date(row.due_at).toLocaleString()}`
                      : ""}
                  </span>
                </div>
              </div>
            ))}
            {!data.assignments.length && (
              <div className="qb-muted">No assignments available.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
