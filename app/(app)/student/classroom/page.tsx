"use client";

import { FormEvent, useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import { formatDateTime, isUuid } from "@/lib/format";
import { bootstrapUser } from "@/lib/auth";
import { getStudentClassroom, joinClass } from "@/lib/api/student";

export default function StudentClassroomPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [studentId, setStudentId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh(id: string) {
    setData(await getStudentClassroom(id));
  }

  useEffect(() => {
    bootstrapUser()
      .then((ctx) => {
        const studentId = String((ctx.studentProfile as any)?.id ?? "");
        if (!studentId) throw new Error("Student profile not found.");
        setStudentId(studentId);
        return getStudentClassroom(studentId);
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  async function submitJoin(event: FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    try {
      const result: any = await joinClass(joinCode);
      setNotice(`Joined ${result.class_name}.`);
      setJoinCode("");
      await refresh(studentId);
    } catch (reason: any) {
      setError(reason.message === "INVALID_CLASS_CODE" ? "That class code was not found." : reason.message);
    }
  }

  if (error && !data) return <div className="qb-card qb-error" role="alert">{error}</div>;
  if (!data) return <div className="qb-card qb-empty" aria-busy="true">Loading classroom…</div>;

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Classroom</h1>
          <p>Your joined classes and teacher assignments.</p>
        </div>
      </div>

      <form className="qb-card qb-form" onSubmit={submitJoin}>
        {error && <p className="qb-error" role="alert">{error}</p>}
        <h2>Join a class</h2>
        <div className="qb-actions">
          <input aria-label="Class join code" placeholder="QB7-X4T9" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} required />
          <button className="qb-btn" type="submit">Join class</button>
        </div>
        {notice && <p>{notice}</p>}
      </form>

      <div className="qb-grid cols-2">
        <div className="qb-card">
          <h2>My classes</h2>
          <div className="qb-list">
            {data.memberships.map((row: any) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.classes?.class_name ?? "Class"}</strong>
                  <span>{row.classes?.grade ?? "Class"}</span>
                </div>
                <StatusBadge status={row.status} />
              </div>
            ))}
            {!data.memberships.length && (
              <div className="qb-empty"><strong>No classes yet</strong>Enter the join code your teacher gave you.</div>
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
                  <span>{[isUuid(row.subject_code) ? null : row.subject_code, row.due_at ? `Due ${formatDateTime(row.due_at)}` : "No due date"].filter(Boolean).join(" · ")}</span>
                </div>
              </div>
            ))}
            {!data.assignments.length && (
              <div className="qb-empty"><strong>No assignments yet</strong>Assignments from your classes appear here.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
