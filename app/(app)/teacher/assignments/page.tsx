"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { listTeacherAssignments, listTeacherClasses, publishAssignment } from "@/lib/api/teacher";
import { getQuestionAvailability, listApprovedQuestionsForNode, listCurriculumNodes } from "@/lib/api/curriculum";

export default function TeacherAssignmentsPage() {
  const [ctx, setCtx] = useState<any>(null), [classes, setClasses] = useState<any[]>([]), [rows, setRows] = useState<any[]>([]), [objectives, setObjectives] = useState<any[]>([]), [availability, setAvailability] = useState<any>(null), [questions, setQuestions] = useState<any[]>([]), [selectedIds, setSelectedIds] = useState<string[]>([]), [preview, setPreview] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [classId, setClassId] = useState(""), [nodeId, setNodeId] = useState(""), [title, setTitle] = useState(""), [description, setDescription] = useState(""), [difficulty, setDifficulty] = useState(""), [count, setCount] = useState(5), [attempts, setAttempts] = useState(1), [minutes, setMinutes] = useState(30), [dueAt, setDueAt] = useState(""), [mode, setMode] = useState<"PRACTICE"|"ASSESSMENT">("ASSESSMENT"), [selectionMode, setSelectionMode] = useState<"AUTOMATIC"|"MANUAL">("AUTOMATIC");
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
  useEffect(() => { if (!nodeId) { setAvailability(null); setQuestions([]); return; } Promise.all([getQuestionAvailability([nodeId], selectedClass?.grade), listApprovedQuestionsForNode(nodeId, selectedClass?.grade)]).then(([available, approved]) => { setAvailability(available[0] ?? { approved_count: 0, easy_count: 0, medium_count: 0, hard_count: 0, multiple_choice_count: 0, true_false_count: 0 }); setQuestions(approved); setSelectedIds([]); }).catch((reason) => setError(reason.message)); }, [nodeId, selectedClass?.grade]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      if (!ctx || !nodeId || Number(availability?.approved_count ?? 0) < count) throw new Error("There are not enough approved active questions for this objective.");
      if (selectionMode === "MANUAL" && selectedIds.length !== count) throw new Error(`Select exactly ${count} questions before publishing.`);
      await publishAssignment({ classId, title, description, curriculumNodeIds: [nodeId], questionCount: selectionMode === "MANUAL" ? selectedIds.length : count, questionIds: selectionMode === "MANUAL" ? selectedIds : undefined, difficulty: difficulty || undefined, selectionMode, mode, attemptsAllowed: attempts, timeLimitMinutes: minutes, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined });
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
      <div className="qb-grid cols-2"><div className="qb-field"><label>Mode</label><select value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="ASSESSMENT">Assessment</option><option value="PRACTICE">Practice</option></select></div><div className="qb-field"><label>Selection</label><select value={selectionMode} onChange={(e) => setSelectionMode(e.target.value as any)}><option value="AUTOMATIC">Automatic</option><option value="MANUAL">Manual</option></select></div><div className="qb-field"><label>Difficulty</label><select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div></div>
      <div className="qb-grid cols-2"><div className="qb-field"><label>Questions</label><input type="number" min="1" max="100" value={count} onChange={(e) => setCount(Number(e.target.value))} /></div><div className="qb-field"><label>Attempts</label><input type="number" min="1" value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} /></div><div className="qb-field"><label>Time limit (minutes)</label><input type="number" min="1" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></div><div className="qb-field"><label>Due date</label><input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div></div>
      {selectionMode === "MANUAL" && <div className="qb-card"><strong>Choose questions ({selectedIds.length}/{count})</strong>{questions.map((question) => <label className="qb-row" key={question.id}><input type="checkbox" checked={selectedIds.includes(question.id)} disabled={!selectedIds.includes(question.id) && selectedIds.length >= count} onChange={() => setSelectedIds((current) => current.includes(question.id) ? current.filter((id) => id !== question.id) : [...current, question.id])} /><span><strong>{question.question_code}</strong> · {question.difficulty_label} · {question.question_text}</span></label>)}</div>}
      <button className="qb-btn" type="button" disabled={!availability || (selectionMode === "MANUAL" && selectedIds.length !== count) || (selectionMode === "AUTOMATIC" && Number(availability.approved_count) < count)} onClick={() => setPreview(true)}>Preview</button>
      {preview && <div className="qb-card"><h3>Assignment preview</h3><p>{title || "Untitled assignment"} · {selectionMode === "MANUAL" ? selectedIds.length : count} questions · {mode}</p><ol>{(selectionMode === "MANUAL" ? questions.filter((q) => selectedIds.includes(q.id)) : questions.slice(0, count)).map((q) => <li key={q.id}>{q.question_text}</li>)}</ol><button className="qb-btn" type="submit">Confirm and publish</button><button className="qb-btn secondary" type="button" onClick={() => setPreview(false)}>Back to edit</button></div>}
    </form><div className="qb-card"><h2>Existing assignments</h2><div className="qb-list">{rows.map((row) => <div className="qb-row" key={row.id}><div className="qb-row-main"><strong>{row.title}</strong><span>{row.classes?.class_name} · {row.mode ?? "ASSESSMENT"} · {row.status}</span></div><span className="qb-pill">{row.question_count ?? 0} questions</span></div>)}{!rows.length && <div className="qb-muted">No assignments published.</div>}</div></div></div>
  </>;
}
