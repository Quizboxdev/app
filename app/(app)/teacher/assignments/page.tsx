"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { listTeacherAssignments, listTeacherClasses, publishAssignment } from "@/lib/api/teacher";
import { getQuestionAvailability, listCurriculumNodes } from "@/lib/api/curriculum";

export default function TeacherAssignmentsPage() {
  const [ctx, setCtx] = useState<any>(null), [classes, setClasses] = useState<any[]>([]), [rows, setRows] = useState<any[]>([]), [objectives, setObjectives] = useState<any[]>([]), [availability, setAvailability] = useState<any>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [classId, setClassId] = useState(""), [nodeId, setNodeId] = useState(""), [title, setTitle] = useState(""), [description, setDescription] = useState(""), [difficulty, setDifficulty] = useState(""), [count, setCount] = useState(5), [attempts, setAttempts] = useState(1), [minutes, setMinutes] = useState(30), [dueAt, setDueAt] = useState(""), [mode, setMode] = useState<"PRACTICE"|"ASSESSMENT">("ASSESSMENT");
  const selectedClass = useMemo(() => classes.find((row) => row.id === classId), [classes, classId]);

  async function refresh(context: any) { const teacherId = String(context.teacherProfile?.id ?? ""); const [classRows, assignmentRows] = await Promise.all([listTeacherClasses(teacherId), listTeacherAssignments(teacherId, context.userId)]); setClasses(classRows); setRows(assignmentRows); }
  useEffect(() => { bootstrapUser().then(async (context) => { setCtx(context); await refresh(context); }).catch((reason) => setError(reason.message)); }, []);
  useEffect(() => {
    setNodeId(""); setAvailability(null); setObjectives([]);
    if (!selectedClass?.curriculum_id) return;
    const subject = selectedClass.curriculum_nodes?.title ?? selectedClass.curriculum_nodes?.subject_code;
    Promise.all([
      listCurriculumNodes({ curriculumId: selectedClass.curriculum_id, gradeCode: selectedClass.grade, subjectCode: subject, nodeType: "learning_indicator" }),
      listCurriculumNodes({ curriculumId: selectedClass.curriculum_id, gradeCode: selectedClass.grade, subjectCode: subject, nodeType: "learning_objective" }),
    ]).then(([indicators, goals]) => setObjectives([...indicators, ...goals])).catch((reason) => setError(reason.message));
  }, [selectedClass]);
  useEffect(() => { if (!nodeId) return setAvailability(null); getQuestionAvailability([nodeId], selectedClass?.grade).then((rows) => setAvailability(rows[0] ?? { approved_count: 0, easy_count: 0, medium_count: 0, hard_count: 0, multiple_choice_count: 0, true_false_count: 0 })).catch((reason) => setError(reason.message)); }, [nodeId, selectedClass?.grade]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      if (!ctx || !nodeId || Number(availability?.approved_count ?? 0) < count) throw new Error("There are not enough approved active questions for this objective.");
      await publishAssignment({ classId, title, description, curriculumNodeIds: [nodeId], questionCount: count, difficulty: difficulty || undefined, selectionMode: "AUTOMATIC", mode, attemptsAllowed: attempts, timeLimitMinutes: minutes, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined });
      setNotice("Assignment published to enrolled learners."); setTitle(""); await refresh(ctx);
    } catch (reason: any) { setError(reason.message); }
  }

  return <>
    <div className="qb-page-head"><div><h1>Assignments</h1><p>Publish work from approved curriculum-aligned questions.</p></div></div>
    {error && <div className="qb-card qb-error">{error}</div>}{notice && <div className="qb-card">{notice}</div>}
    <div className="qb-grid cols-2"><form className="qb-card qb-form" onSubmit={submit}><h2>Create assignment</h2>
      <div className="qb-field"><label>Class</label><select value={classId} onChange={(e) => setClassId(e.target.value)} required><option value="">Select class</option>{classes.map((row) => <option key={row.id} value={row.id}>{row.class_name} · {row.grade}</option>)}</select></div>
      <div className="qb-field"><label>Curriculum objective</label><select value={nodeId} onChange={(e) => setNodeId(e.target.value)} required><option value="">Select objective</option>{objectives.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.title}</option>)}</select></div>
      {availability && <div className="qb-card"><strong>{availability.approved_count} approved questions available</strong><p className="qb-muted">Easy {availability.easy_count} · Medium {availability.medium_count} · Hard {availability.hard_count} · MCQ {availability.multiple_choice_count} · True/false {availability.true_false_count}</p></div>}
      <div className="qb-field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
      <div className="qb-field"><label>Description</label><textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      <div className="qb-grid cols-2"><div className="qb-field"><label>Mode</label><select value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="ASSESSMENT">Assessment</option><option value="PRACTICE">Practice</option></select></div><div className="qb-field"><label>Difficulty</label><select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div></div>
      <div className="qb-grid cols-2"><div className="qb-field"><label>Questions</label><input type="number" min="1" max="100" value={count} onChange={(e) => setCount(Number(e.target.value))} /></div><div className="qb-field"><label>Attempts</label><input type="number" min="1" value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} /></div><div className="qb-field"><label>Time limit (minutes)</label><input type="number" min="1" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></div><div className="qb-field"><label>Due date</label><input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div></div>
      <button className="qb-btn" type="submit" disabled={!availability || Number(availability.approved_count) < count}>Preview and publish</button>
    </form><div className="qb-card"><h2>Existing assignments</h2><div className="qb-list">{rows.map((row) => <div className="qb-row" key={row.id}><div className="qb-row-main"><strong>{row.title}</strong><span>{row.classes?.class_name} · {row.mode ?? "ASSESSMENT"} · {row.status}</span></div><span className="qb-pill">{row.question_count ?? 0} questions</span></div>)}{!rows.length && <div className="qb-muted">No assignments published.</div>}</div></div></div>
  </>;
}
