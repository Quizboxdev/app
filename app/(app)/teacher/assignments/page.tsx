"use client";

import { useEffect, useMemo, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { listTeacherAssignments, listTeacherClasses, publishAssignment } from "@/lib/api/teacher";
import { setAssignmentGradeOverride } from "@/lib/api/markets";
import WorkflowStepper from "@/components/WorkflowStepper";
import StatusBadge from "@/components/StatusBadge";
import CurriculumBrowser from "@/components/CurriculumBrowser";
import { assignmentPhase } from "@/lib/learning/analytics";
import { getQuestionAvailability, listApprovedQuestionsForNode, listCurriculumNodes } from "@/lib/api/curriculum";

export default function TeacherAssignmentsPage() {
  const [ctx, setCtx] = useState<any>(null), [classes, setClasses] = useState<any[]>([]), [rows, setRows] = useState<any[]>([]), [objectives, setObjectives] = useState<any[]>([]), [availability, setAvailability] = useState<any>(null), [questions, setQuestions] = useState<any[]>([]), [selectedIds, setSelectedIds] = useState<string[]>([]), [publishing, setPublishing] = useState(false), [run, setRun] = useState(0);
  const [gradeOverride, setGradeOverride] = useState(false), [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [classId, setClassId] = useState(""), [nodeId, setNodeId] = useState(""), [title, setTitle] = useState(""), [description, setDescription] = useState(""), [difficulty, setDifficulty] = useState(""), [count, setCount] = useState(5), [attempts, setAttempts] = useState(1), [minutes, setMinutes] = useState(30), [dueAt, setDueAt] = useState(""), [mode, setMode] = useState<"PRACTICE"|"ASSESSMENT">("ASSESSMENT"), [selectionMode, setSelectionMode] = useState<"AUTOMATIC"|"MANUAL">("AUTOMATIC");
  const selectedClass = useMemo(() => classes.find((row) => row.id === classId), [classes, classId]);

  async function refresh(context: any) { const teacherId = String(context.teacherProfile?.id ?? ""); const [classRows, assignmentRows] = await Promise.all([listTeacherClasses(teacherId), listTeacherAssignments(teacherId, context.userId)]); setClasses(classRows); setRows(assignmentRows); }
  useEffect(() => { bootstrapUser().then(async (context) => { setCtx(context); await refresh(context); }).catch((reason) => setError(reason.message)); }, []);
  useEffect(() => {
    setNodeId(""); setAvailability(null); setObjectives([]);
    if (!selectedClass?.curriculum_id) return;
    // Filter by the subject node's code and the class's market grade code (titles and legacy grades vary by market).
    const subject = selectedClass.curriculum_nodes?.subject_code ?? selectedClass.curriculum_nodes?.title; const gradeCode = selectedClass.grade_code ?? selectedClass.grade;
    Promise.all([
      listCurriculumNodes({ curriculumId: selectedClass.curriculum_id, gradeCode, subjectCode: subject, nodeType: "learning_indicator" }),
      listCurriculumNodes({ curriculumId: selectedClass.curriculum_id, gradeCode, subjectCode: subject, nodeType: "learning_objective" }),
    ]).then(([indicators, goals]) => setObjectives([...indicators, ...goals])).catch((reason) => setError(reason.message));
  }, [selectedClass]);
  useEffect(() => { if (!nodeId) { setAvailability(null); setQuestions([]); return; } Promise.all([getQuestionAvailability([nodeId], selectedClass?.grade), listApprovedQuestionsForNode(nodeId, selectedClass?.grade)]).then(([available, approved]) => { setAvailability(available[0] ?? { approved_count: 0, easy_count: 0, medium_count: 0, hard_count: 0, multiple_choice_count: 0, true_false_count: 0 }); setQuestions(approved); setSelectedIds([]); }).catch((reason) => setError(reason.message)); }, [nodeId, selectedClass?.grade]);

  async function publish() {
    setError(""); setNotice(""); setPublishing(true);
    try {
      if (!ctx || !nodeId || Number(availability?.approved_count ?? 0) < count) throw new Error("There are not enough approved active questions for this objective.");
      if (selectionMode === "MANUAL" && selectedIds.length !== count) throw new Error(`Select exactly ${count} questions before publishing.`);
      if (gradeOverride && overrideReason.trim().length < 5) throw new Error("Enter a reason (at least 5 characters) for assigning outside the class grade.");
      const published: any = await publishAssignment({ classId, title, description, curriculumNodeIds: [nodeId], questionCount: selectionMode === "MANUAL" ? selectedIds.length : count, questionIds: selectionMode === "MANUAL" ? selectedIds : undefined, difficulty: difficulty || undefined, selectionMode, mode, attemptsAllowed: attempts, timeLimitMinutes: minutes, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined });
      // Cross-grade work is never implicit: the override is a separate, audited server action.
      if (gradeOverride) await setAssignmentGradeOverride(published?.assignment_id ?? published?.id, overrideReason);
      setNotice(gradeOverride ? "Assignment published with an audited grade override." : "Assignment published to enrolled learners."); setTitle(""); setDescription(""); setNodeId(""); setSelectedIds([]); setGradeOverride(false); setOverrideReason(""); setRun((n) => n + 1); await refresh(ctx);
    } catch (reason: any) { setError(reason.message); } finally { setPublishing(false); }
  }

  const enough = Boolean(availability) && (selectionMode === "MANUAL" ? selectedIds.length === count : Number(availability.approved_count) >= count);
  const subjectRoot = selectedClass?.subject_node_id && selectedClass?.curriculum_id
    ? { id: selectedClass.subject_node_id, node_type: "subject", code: null, title: selectedClass.curriculum_nodes?.title ?? "Class subject", source_terminology: null, subject_code: selectedClass.curriculum_nodes?.subject_code ?? null, grade_code: null }
    : null;
  const chosen = selectionMode === "MANUAL" ? questions.filter((q) => selectedIds.includes(q.id)) : questions.slice(0, count);

  const steps = [
    { id: "class", title: "Class", description: "Who is this for?", isValid: Boolean(classId), content:
      <div className="qb-field"><label htmlFor="asg-class">Class</label><select id="asg-class" value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Select class</option>{classes.map((row) => <option key={row.id} value={row.id}>{row.class_name} · {row.grade}</option>)}</select></div> },
    { id: "scope", title: "Scope", description: "Choose the curriculum objective the questions come from.", isValid: Boolean(nodeId), content: !selectedClass ? <p className="qb-muted">Select a class first.</p> : subjectRoot ? (
      <>
        <CurriculumBrowser curriculumId={selectedClass.curriculum_id} root={subjectRoot} rootLabel={subjectRoot.title}
          renderLeaf={(leaf, { available }) => <div className="qb-launch"><p className="qb-overline">{leaf.code ?? "Objective"}</p><h3>{leaf.title}</h3><p className="qb-muted">{available} approved question{available === 1 ? "" : "s"}</p>
            <button type="button" className="qb-btn" disabled={!available} aria-pressed={nodeId === leaf.id} onClick={() => setNodeId(leaf.id)}>{nodeId === leaf.id ? "Selected" : "Use this objective"}</button>{!available && <p className="qb-muted qb-small">No approved questions here yet.</p>}</div>} />
        {nodeId && availability && <p className="qb-muted" role="status">{availability.approved_count} approved questions available · Easy {availability.easy_count} · Medium {availability.medium_count} · Hard {availability.hard_count}</p>}
      </>
    ) : (
      <div className="qb-field"><label htmlFor="asg-curriculum-objective">Curriculum objective</label><select id="asg-curriculum-objective" value={nodeId} onChange={(e) => setNodeId(e.target.value)}><option value="">Select objective</option>{objectives.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.title}</option>)}</select>
        {availability && <p className="qb-muted">{availability.approved_count} approved questions available · Easy {availability.easy_count} · Medium {availability.medium_count} · Hard {availability.hard_count}</p>}</div>
    ) },
    { id: "questions", title: "Questions", description: "How many, how hard, and who picks them.", isValid: enough, content:
      <div className="qb-form">
        <div className="qb-grid cols-2">
          <div className="qb-field"><label htmlFor="asg-selection">Selection</label><select id="asg-selection" value={selectionMode} onChange={(e) => setSelectionMode(e.target.value as any)}><option value="AUTOMATIC">Automatic</option><option value="MANUAL">Manual</option></select></div>
          <div className="qb-field"><label htmlFor="asg-difficulty">Difficulty</label><select id="asg-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="">Mixed</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></div>
          <div className="qb-field"><label htmlFor="asg-questions">Questions</label><input id="asg-questions" type="number" min="1" max="100" value={count} onChange={(e) => setCount(Number(e.target.value))} /></div>
        </div>
        {availability && Number(availability.approved_count) < count && <p className="qb-error" role="alert">Only {availability.approved_count} approved questions are available for this objective.</p>}
        {selectionMode === "MANUAL" && <div className="qb-list"><strong>Choose questions ({selectedIds.length}/{count})</strong>{questions.map((question) => <label className="qb-row" key={question.id}><input type="checkbox" checked={selectedIds.includes(question.id)} disabled={!selectedIds.includes(question.id) && selectedIds.length >= count} onChange={() => setSelectedIds((current) => current.includes(question.id) ? current.filter((id) => id !== question.id) : [...current, question.id])} /><span><strong>{question.question_code}</strong> · {question.difficulty_label} · {question.question_text}</span></label>)}</div>}
      </div> },
    { id: "configure", title: "Configure", description: "Title, mode and timing.", isValid: title.trim().length > 0, content:
      <div className="qb-form">
        <div className="qb-field"><label htmlFor="asg-title">Title</label><input id="asg-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="qb-field"><label htmlFor="asg-description">Description</label><textarea id="asg-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="qb-grid cols-2">
          <div className="qb-field"><label htmlFor="asg-mode">Mode</label><select id="asg-mode" value={mode} onChange={(e) => setMode(e.target.value as any)}><option value="ASSESSMENT">Assessment</option><option value="PRACTICE">Practice</option></select></div>
          <div className="qb-field"><label htmlFor="asg-attempts">Attempts</label><input id="asg-attempts" type="number" min="1" value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} /></div>
          <div className="qb-field"><label htmlFor="asg-time-limit-minutes">Time limit (minutes)</label><input id="asg-time-limit-minutes" type="number" min="1" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></div>
          <div className="qb-field"><label htmlFor="asg-due-date">Due date</label><input id="asg-due-date" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div>
        </div>
      </div> },
    { id: "review", title: "Review & publish", description: "Check everything, then publish to enrolled learners.", isValid: !gradeOverride || overrideReason.trim().length >= 5, content:
      <div className="qb-form">
        <dl className="qb-result-stats">
          <div><dt>Class</dt><dd>{selectedClass?.class_name}</dd></div>
          <div><dt>Questions</dt><dd>{selectionMode === "MANUAL" ? selectedIds.length : count}</dd></div>
          <div><dt>Mode</dt><dd>{mode === "PRACTICE" ? "Practice" : "Assessment"}</dd></div>
          <div><dt>Due</dt><dd>{dueAt ? new Date(dueAt).toLocaleDateString() : "No due date"}</dd></div>
        </dl>
        <p><strong>{title || "Untitled assignment"}</strong></p>
        <ol>{chosen.map((q) => <li key={q.id}>{q.question_text}</li>)}</ol>
        {selectionMode === "AUTOMATIC" && <p className="qb-muted qb-small">Questions shown are a sample; the server selects the final set from approved questions.</p>}
        <label><input type="checkbox" checked={gradeOverride} onChange={(e) => setGradeOverride(e.target.checked)} /> Assign outside the class grade (recorded in the audit log)</label>
        {gradeOverride && <div className="qb-field"><label htmlFor="asg-override">Reason</label><input id="asg-override" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} minLength={5} /></div>}
      </div> },
  ];

  return <>
    <div className="qb-page-head"><div><h1>Assignments</h1><p>Publish work from approved curriculum-aligned questions.</p></div></div>
    {error && <div className="qb-card qb-error" role="alert">{error}</div>}{notice && <div className="qb-card" role="status">{notice}</div>}
    <WorkflowStepper key={run} steps={steps} onComplete={() => void publish()} completeLabel="Publish assignment" busy={publishing} />
    <section className="qb-card" style={{ marginTop: 16 }} aria-labelledby="asg-existing"><h2 id="asg-existing">Existing assignments</h2>
      <div className="qb-list">{rows.map((row) => <div className="qb-row" key={row.id}><div className="qb-row-main"><strong>{row.title}</strong><span>{row.classes?.class_name} · {row.mode ?? "ASSESSMENT"} · {row.question_count ?? 0} questions</span></div><StatusBadge status={assignmentPhase(row)} /></div>)}{!rows.length && <div className="qb-empty"><strong>No assignments yet</strong>Published work appears here.</div>}</div>
    </section>
  </>;
}
