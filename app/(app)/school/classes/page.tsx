"use client";
import { useMemo, useState } from "react";
import StatusBadge from "@/components/StatusBadge";
import SchoolClassMembers from "@/components/SchoolClassMembers";
import { useSchool } from "@/components/SchoolProvider";
import { runSchoolAction } from "@/lib/api/school";
import { gradeCompare, isActiveClass, noGradeLabel } from "@/lib/school/insights";

export default function SchoolClassesPage() {
  const { overview, reload } = useSchool();
  const [query, setQuery] = useState(""), [grade, setGrade] = useState(""), [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const grades = useMemo(() => [...new Set(overview.classes.map((c) => noGradeLabel(c.grade)))].sort(gradeCompare), [overview]);
  const active = useMemo(() => overview.classes.filter(isActiveClass), [overview]);
  const rows = useMemo(() => overview.classes.filter((c) =>
    (!status || c.status === status) && (!grade || noGradeLabel(c.grade) === grade) && (!query.trim() || `${c.name} ${c.teacher ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
  ), [overview, query, grade, status]);

  async function act(action: string, data: Record<string, unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await runSchoolAction(action, data); setNotice(done); await reload(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return <>
    <div className="qb-page-head"><div><h1>Classes</h1><p>{active.length} active · {overview.classes.length - active.length} archived · {active.reduce((n, c) => n + c.students, 0)} enrolments</p></div></div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <section className="qb-card" aria-label="Class list">
      <div className="qb-content-filters">
        <div className="qb-field"><label htmlFor="cls-search">Search class or teacher</label><input id="cls-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="qb-field"><label htmlFor="cls-grade">Grade</label><select id="cls-grade" value={grade} onChange={(e) => setGrade(e.target.value)}><option value="">All grades</option>{grades.map((g) => <option key={g} value={g}>{g}</option>)}</select></div>
        <div className="qb-field"><label htmlFor="cls-status">Status</label><select id="cls-status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="archived">Archived</option><option value="">All</option></select></div>
      </div>
      {rows.length ? <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Class</th><th>Grade</th><th>Teacher</th><th>Learners</th><th>Status</th><th>Manage</th></tr></thead><tbody>
        {rows.map((c) => <tr key={c.id}><td><strong>{c.name}</strong></td><td>{noGradeLabel(c.grade)}</td>
          <td>{c.teacher ?? <StatusBadge status="danger" tone="danger" label="No teacher" />}</td><td>{c.students}</td><td><StatusBadge status={c.status} /></td>
          <td>{isActiveClass(c) && <div className="qb-content-filters">
            <label className="qb-sr-only" htmlFor={`t-${c.id}`}>Reassign teacher for {c.name}</label>
            <select id={`t-${c.id}`} defaultValue="" disabled={busy} onChange={(e) => e.target.value && void act("assign_teacher", { class_id: c.id, teacher_user_id: e.target.value }, "Teacher reassigned.")}>
              <option value="">Reassign teacher…</option>{overview.teachers.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}</select>
            <button type="button" className="qb-btn secondary" disabled={busy} onClick={() => window.confirm(`Archive ${c.name}? Results and history are kept.`) && void act("archive_class", { class_id: c.id }, "Class archived.")}>Archive</button>
            <SchoolClassMembers cls={c} targets={active.filter((x) => x.id !== c.id)} busy={busy} onTransfer={(m, to) => void act("transfer_student", { class_id: c.id, membership_id: m.id, to_class_id: to }, `${m.student_name} transferred.`)} />
          </div>}</td></tr>)}
      </tbody></table></div> : <div className="qb-empty"><strong>No classes match</strong>Clear the search or filters to see more classes.</div>}
    </section>
  </>;
}
