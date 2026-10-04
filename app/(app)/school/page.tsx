"use client";
import { useCallback, useEffect, useState } from "react";
import { schoolAction } from "@/lib/api/platform";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import StatusBadge from "@/components/StatusBadge";
import DashboardHero from "@/components/DashboardHero";
import StatCard from "@/components/StatCard";

type School = { id: string; name: string; role: string };
type Overview = { institution: string; teachers: Array<{ user_id: string; name: string; role: string }>; classes: Array<{ id: string; name: string; grade: string | null; status: string; teacher: string | null; students: number }> };
type Member = { id: string; student_name: string };

// School administration for institution admins: classes, teachers, transfers and history. Not an SIS.
export default function SchoolPage() {
  const [schools, setSchools] = useState<School[] | null>(null), [school, setSchool] = useState(""), [overview, setOverview] = useState<Overview | null>(null), [history, setHistory] = useState<Array<Record<string, string>>>([]);
  const [members, setMembers] = useState<Record<string, Member[]>>({}), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => { schoolAction<School[]>("my_schools").then((rows) => { setSchools(rows); if (rows[0]) setSchool(rows[0].id); }).catch((e) => setError(e.message)); }, []);
  const load = useCallback(async () => {
    if (!school) return;
    const o = await schoolAction<Overview>("overview", { institution_id: school }); setOverview(o); setHistory(await schoolAction("history", { institution_id: school }));
    const { data } = await getSupabaseBrowserClient().from("class_memberships").select("id,class_id,student_name").in("class_id", o.classes.map((c) => c.id)).eq("status", "active");
    const grouped: Record<string, Member[]> = {}; for (const m of data ?? []) (grouped[m.class_id] ??= []).push(m); setMembers(grouped);
  }, [school]);
  useEffect(() => { void load().catch((e) => setError(e.message)); }, [load]);
  async function act(action: string, data: Record<string, unknown>, done: string) {
    setBusy(true); setError(""); setNotice("");
    try { await schoolAction(action, data); setNotice(done); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (schools === null) return error ? <p className="qb-error" role="alert">{error}</p> : <p className="qb-muted" role="status">Loading…</p>;
  if (!schools.length) return <>
    <div className="qb-page-head"><div><h1>School</h1><p>Classes, teachers and student class membership for institutions you administer.</p></div></div>
    <div className="qb-card qb-empty"><strong>No school linked to your account</strong>School administrators see their classes, teachers and transfers here. Ask your school or QuizBox support to add you as an institution administrator.</div>
  </>;
  const active = overview?.classes.filter((c) => c.status === "active") ?? [];
  return <>
    <div className="qb-page-head"><div><h1>{overview?.institution ?? "School"}</h1><p>Classes, teachers and student class membership.</p></div>
      {schools.length > 1 && <label>School<select value={school} onChange={(e) => setSchool(e.target.value)}>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}</div>
    {error && <p className="qb-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <DashboardHero eyebrow="School workspace" title="One view across your institution." description="Monitor classes, teachers and learner membership across your school." primary={{ label: "Manage classes", href: "#school-classes" }} secondary={{ label: "View account", href: "/account" }} />
    <div className="qb-grid cols-4">
      <StatCard label="Teachers" value={overview?.teachers.length} />
      <StatCard label="Classes" value={overview?.classes.length} />
      <StatCard label="Active classes" value={overview ? active.length : null} />
      <StatCard label="Class enrollments" value={overview ? overview.classes.reduce((sum, c) => sum + c.students, 0) : null} hint="Includes membership in multiple classes" />
    </div>
    <section id="school-classes" className="qb-card qb-anchor"><h2>Classes</h2><div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Class</th><th>Grade</th><th>Teacher</th><th>Students</th><th>Status</th><th><span className="qb-sr-only">Actions</span></th></tr></thead><tbody>
      {(overview?.classes ?? []).map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.grade ?? "-"}</td><td>{c.teacher ?? "-"}</td><td>{c.students}</td><td><StatusBadge status={c.status} /></td><td>
        {c.status === "active" && <div className="qb-content-filters">
          <label className="qb-sr-only" htmlFor={`t-${c.id}`}>Reassign teacher for {c.name}</label>
          <select id={`t-${c.id}`} defaultValue="" disabled={busy} onChange={(e) => e.target.value && void act("assign_teacher", { class_id: c.id, teacher_user_id: e.target.value }, "Teacher reassigned.")}>
            <option value="">Reassign teacher…</option>{overview?.teachers.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}</select>
          <button className="qb-btn secondary" disabled={busy} onClick={() => window.confirm(`Archive ${c.name}? Results and history are kept.`) && void act("archive_class", { class_id: c.id }, "Class archived.")}>Archive</button>
        </div>}
        {(members[c.id] ?? []).map((m) => <div key={m.id} className="qb-small">{m.student_name}{" "}
          <label className="qb-sr-only" htmlFor={`m-${m.id}`}>Transfer {m.student_name}</label>
          <select id={`m-${m.id}`} defaultValue="" disabled={busy} onChange={(e) => e.target.value && void act("transfer_student", { class_id: c.id, membership_id: m.id, to_class_id: e.target.value }, `${m.student_name} transferred.`)}>
            <option value="">Transfer to…</option>{active.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>)}
      </td></tr>)}</tbody></table></div></section>
    <section className="qb-card"><h2>Membership history</h2>{history.length ? <ul className="qb-plain-list">{history.slice(0, 50).map((h, i) => <li key={i}>{h.student} · {h.class} · {h.status} · joined {new Date(h.joined_at).toLocaleDateString()}{h.left_at ? ` · left ${new Date(h.left_at).toLocaleDateString()}` : ""}</li>)}</ul> : <p className="qb-muted">No history yet.</p>}</section>
  </>;
}
