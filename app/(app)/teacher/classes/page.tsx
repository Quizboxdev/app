"use client";

import { FormEvent, useEffect, useState } from "react";
import { bootstrapUser } from "@/lib/auth";
import { archiveClass, createClass, listTeacherClasses } from "@/lib/api/teacher";
import { CurriculumSelector, type CurriculumSelection } from "@/components/CurriculumSelector";

const newJoinCode = (grade: string) => `QB${grade.replace(/\D/g, "").slice(-2)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

export default function TeacherClassesPage() {
  const [ctx, setCtx] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [term, setTerm] = useState("1");
  const [selection, setSelection] = useState<Partial<CurriculumSelection>>({});

  async function refresh(context: any) { setRows(await listTeacherClasses(String(context.teacherProfile?.id ?? ""))); }
  useEffect(() => { bootstrapUser().then(async (context) => { setCtx(context); await refresh(context); }).catch((reason) => setError(reason.message)); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setNotice("");
    try {
      if (!ctx || !selection.curriculumId || !selection.subjectNodeId || !selection.gradeCode) throw new Error("Complete the curriculum selection.");
      await createClass({
        class_name: name, grade: selection.gradeCode, grade_label: selection.gradeCode,
        academic_year: year, term, teacher_id: ctx.teacherProfile.id, teacher_user_id: ctx.userId,
        primary_teacher_id: ctx.teacherProfile.id, status: "active", join_code: newJoinCode(selection.gradeCode),
        curriculum_id: selection.curriculumId, education_level: selection.educationLevel,
        subject_node_id: selection.subjectNodeId,
      });
      setName(""); setNotice("Class created. Share its join code with learners."); await refresh(ctx);
    } catch (reason: any) { setError(reason.message); }
  }

  return <>
    <div className="qb-page-head"><div><h1>Classes</h1><p>Create curriculum-linked classes and manage enrollment.</p></div></div>
    {error && <div className="qb-card qb-error">{error}</div>}{notice && <div className="qb-card">{notice}</div>}
    <div className="qb-grid cols-2">
      <form className="qb-card qb-form" onSubmit={submit}><h2>Create class</h2>
        <CurriculumSelector value={selection} onChange={setSelection} />
        <div className="qb-field"><label htmlFor="class-name">Class name</label><input id="class-name" value={name} onChange={(event) => setName(event.target.value)} required /></div>
        <div className="qb-grid cols-2"><div className="qb-field"><label htmlFor="class-year">Academic year</label><input id="class-year" value={year} onChange={(event) => setYear(event.target.value)} required /></div><div className="qb-field"><label htmlFor="class-term">Term</label><select id="class-term" value={term} onChange={(event) => setTerm(event.target.value)}><option value="1">Term 1</option><option value="2">Term 2</option><option value="3">Term 3</option></select></div></div>
        <button className="qb-btn" type="submit">Create class</button>
      </form>
      <div className="qb-card"><h2>Your classes</h2><div className="qb-list">{rows.map((row) => <div className="qb-row" key={row.id}><div className="qb-row-main"><strong>{row.class_name}</strong><span>{row.grade} · {row.academic_year} · {row.status}</span><span>Join code: <strong>{row.join_code}</strong></span></div><div className="qb-actions"><button className="qb-btn qb-btn-secondary" type="button" onClick={() => navigator.clipboard.writeText(row.join_code)}>Copy code</button>{row.status !== "archived" && <button className="qb-btn qb-btn-secondary" type="button" onClick={async () => { await archiveClass(row.id); await refresh(ctx); }}>Archive</button>}</div></div>)}{!rows.length && <div className="qb-muted">Create your first curriculum-linked class.</div>}</div></div>
    </div>
  </>;
}
