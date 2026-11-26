"use client";

import { useState } from "react";
import Link from "next/link";
import { inviteSchools, registrations, searchSchools } from "@/lib/api/interschool";
import { Loading, Notice, Row, Stat, Table, useAction, useLoad } from "../ui";
import { REGISTRATION, humanStatus } from "@/lib/interschool/text";
import type { Managed } from "@/lib/interschool/types";

export default function SchoolsTab({ c }: { c: Managed }) {
  const reg = useLoad(() => registrations(c.id), [c.id]);
  const act = useAction(async () => { await reg.reload(); });
  const [query, setQuery] = useState(""), [found, setFound] = useState<Array<{ id: string; name: string; region: string | null }> | null>(null), [picked, setPicked] = useState<string[]>([]);
  const live = c.status === "PUBLISHED" || c.status === "PAUSED";
  if (!reg.data) return <Loading error={reg.error} />;
  const r = reg.data, entered = new Set(r.schools.map((s) => s.institution_id));
  return (
    <>
      <Notice error={act.error} done={act.done} />
      <Row><Stat label="Registration" value={REGISTRATION[r.registration]} /><Stat label="Places used" value={`${r.held} of ${r.capacity}`} /><Stat label="Expected" value={r.expected} /><Stat label="Waiting" value={r.waiting} /></Row>
      <div className="qb-card"><h2>Divisions</h2><Table head={["Division", "Confirmed", "Waiting for school", "Capacity"]}>{r.divisions.map((d) => <tr key={d.id}><td>{d.title}</td><td>{d.confirmed}</td><td>{d.pending}</td><td>{d.capacity ?? "No separate limit"}</td></tr>)}</Table></div>
      <div className="qb-card"><h2>Schools</h2>{r.schools.length === 0 ? <p className="qb-muted">No schools yet.</p> : (
        <Table head={["School", "Status", "Confirmed", "Pending", "Waiting", "Came from", "Roster"]}>{r.schools.map((s) => <tr key={s.institution_id}><td>{s.school}{s.region && <div className="qb-muted qb-small">{s.region}</div>}</td><td>{humanStatus(s.status)}</td><td>{s.confirmed}</td><td>{s.pending}</td><td>{s.waiting}</td><td>{s.source.toLowerCase()}</td><td>{s.locked ? "Locked" : "Open"}{c.is_admin && <> <Link className="qb-link" href={`/interschool/school/${c.id}?school=${s.institution_id}`}>View</Link></>}</td></tr>)}</Table>)}
        <p className="qb-muted qb-small">Learner names are shown only to each school&apos;s own staff.</p></div>
      <div className="qb-card"><h2>Invite schools</h2>
        {!live ? <p className="qb-muted">Publish the competition first.</p> : <>
          <Row><input aria-label="School name" placeholder="School name" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy} onClick={() => void act.run(async () => { setPicked([]); setFound(await searchSchools(query)); })}>Search verified schools</button></Row>
          {found && (found.length === 0 ? <p className="qb-muted">No verified school matches.</p> : <>
            <div style={{ display: "grid", gap: 4, margin: "12px 0" }}>{found.map((s) => <label key={s.id} className="qb-check"><input type="checkbox" disabled={entered.has(s.id)} checked={picked.includes(s.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))} /> {s.name}{s.region ? ` · ${s.region}` : ""}{entered.has(s.id) ? " (already listed)" : ""}</label>)}</div>
            <button type="button" className="qb-btn" disabled={act.busy || picked.length === 0} onClick={() => void act.run(async () => { await inviteSchools(c.id, picked); setPicked([]); }, "Invitations sent.")}>Invite {picked.length} school(s)</button>
          </>)}
        </>}
      </div>
    </>
  );
}
