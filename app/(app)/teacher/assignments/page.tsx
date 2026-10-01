"use client";

import { FormEvent, useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import {
  createAssignment,
  listTeacherAssignments,
  listTeacherClasses,
} from "@/lib/api/teacher";
import { listAvailableAssessments } from "@/lib/api/assessment";

export default function TeacherAssignmentsPage() {
  const [ctx, setCtx] = useState<any>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [classId, setClassId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [instructions, setInstructions] = useState("");

  async function refresh(userContext: any) {
    const teacherId = String(userContext.teacherProfile?.id ?? "");
    const [classRows, assignmentRows, assessmentRows] = await Promise.all([
      listTeacherClasses(teacherId),
      listTeacherAssignments(teacherId, userContext.userId),
      listAvailableAssessments(),
    ]);
    setClasses(classRows);
    setRows(assignmentRows);
    setAssessments(assessmentRows);
  }

  useEffect(() => {
    bootstrapUser()
      .then(async (context) => {
        setCtx(context);
        await refresh(context);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ctx) return;

    try {
      const teacherId = String(ctx.teacherProfile?.id ?? "");
      await createAssignment({
        assessment_id: assessmentId || null,
        class_id: classId,
        teacher_id: teacherId,
        teacher_user_id: ctx.userId,
        title,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        instructions,
        status: "DRAFT",
        created_at: new Date().toISOString(),
      });
      setTitle("");
      setDueAt("");
      setInstructions("");
      await refresh(ctx);
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="qb-page-head">
        <div>
          <h1>Assignments</h1>
          <p>Create and manage class assessment work.</p>
        </div>
      </div>

      {error && <div className="qb-card qb-error">{error}</div>}

      <div className="qb-grid cols-2">
        <form className="qb-card qb-form" onSubmit={submit}>
          <h2>Create assignment</h2>

          <div className="qb-field">
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>

          <div className="qb-field">
            <label>Class</label>
            <select value={classId} onChange={(e) => setClassId(e.target.value)} required>
              <option value="">Select class</option>
              {classes.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.class_name}
                </option>
              ))}
            </select>
          </div>

          <div className="qb-field">
            <label>Assessment</label>
            <select
              value={assessmentId}
              onChange={(e) => setAssessmentId(e.target.value)}
            >
              <option value="">Select assessment</option>
              {assessments.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title ?? row.subject_code ?? row.id}
                </option>
              ))}
            </select>
          </div>

          <div className="qb-field">
            <label>Due date</label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>

          <div className="qb-field">
            <label>Instructions</label>
            <textarea
              rows={4}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <button className="qb-btn" type="submit">
            Create draft assignment
          </button>
        </form>

        <div className="qb-card">
          <h2>Existing assignments</h2>
          <div className="qb-list">
            {rows.map((row) => (
              <div className="qb-row" key={row.id}>
                <div className="qb-row-main">
                  <strong>{row.title ?? "Assignment"}</strong>
                  <span>
                    {row.classes?.class_name ?? ""} · {row.status ?? ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
