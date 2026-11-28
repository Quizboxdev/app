"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createCompetition, duplicateCompetition, manageList } from "@/lib/api/interschool";
import { Head, Loading, Notice, Table, useAction, useLoad } from "@/components/interschool/ui";
import { day, humanStatus } from "@/lib/interschool/text";

// Competitions you organise, and a new one. Only administrators, staff of verified schools and verified sponsors can create.
export default function ManagePage() {
  const router = useRouter();
  const list = useLoad(manageList);
  const act = useAction();
  const [title, setTitle] = useState(""), [host, setHost] = useState("");
  if (!list.data) return <><Head title="Organise competitions" /><Loading error={list.error} /></>;
  const can = list.data.can_create, allowed = can.admin || can.sponsor || can.schools.length > 0;
  return (
    <>
      <Head title="Organise competitions" lead="One competition can be head to head or many schools, open or by invitation, for one class level or several."><Link className="qb-btn qb-btn-secondary" href="/interschool">Back</Link></Head>
      <Notice error={act.error} />
      {allowed ? (
        <form className="qb-card" onSubmit={(e) => { e.preventDefault(); void act.run(async () => { const c = await createCompetition({ title }, host || (!can.admin && !can.sponsor ? can.schools[0]?.id : null) || null); router.push(`/interschool/manage/${c.id}`); }); }}>
          <h2>New competition</h2>
          <label className="qb-field">Title<input value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={140} required /></label>
          {can.schools.length > 0 && <label className="qb-field">Organising school<select value={host} onChange={(e) => setHost(e.target.value)}>{(can.admin || can.sponsor) && <option value="">None</option>}{can.schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
          <p><button className="qb-btn" disabled={act.busy || title.trim().length < 3}>Save draft</button></p>
          {!can.admin && <p className="qb-muted qb-small">Invited competitions run by a school can be published straight away. Open, sponsored, regional or national competitions are checked by QuizBox first.</p>}
        </form>
      ) : <div className="qb-card"><p>To organise a competition you need to be staff of a verified school or a verified sponsor. <Link className="qb-link" href="/support">Ask QuizBox to verify you</Link>.</p></div>}
      <div className="qb-card">{list.data.competitions.length === 0 ? <p className="qb-muted">Nothing yet.</p> : (
        <Table head={["Competition", "Status", "Who can join", "Registration closes", ""]}>{list.data.competitions.map((c) => (
          <tr key={c.id}><td><Link className="qb-link" href={`/interschool/manage/${c.id}`}>{c.title}</Link>{c.decision_note && <div className="qb-muted qb-small">{c.decision_note}</div>}</td>
            <td>{humanStatus(c.status)}{c.status === "DRAFT" && c.approved ? " (approved)" : ""}</td><td>{c.participation === "OPEN" ? "Open" : "Invited"} · {humanStatus(c.funding)}</td><td>{day(c.registration_closes_at)}</td>
            <td><button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => void act.run(async () => { const copy = await duplicateCompetition(c.id); router.push(`/interschool/manage/${copy.id}`); })}>Duplicate</button></td></tr>))}</Table>)}</div>
    </>
  );
}
