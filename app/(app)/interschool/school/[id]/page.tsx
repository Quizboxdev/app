"use client";

import { Suspense, use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { confirmCandidate, lockRoster, nominate, replaceCandidate, schoolHome, schoolLearners, schoolRespond, schoolRoster, withdrawCandidate } from "@/lib/api/interschool";
import { Head, Loading, Notice, Row, Table, useAction, useLoad } from "@/components/interschool/ui";
import { REGISTRATION, canRegister, humanStatus, plain, when } from "@/lib/interschool/text";

// One school's roster for one competition: confirm learners who registered, enter others, replace or withdraw before the lock. Staff see only their own school.
function Roster({ id }: { id: string }) {
  const wanted = useSearchParams().get("school");
  const home = useLoad(schoolHome);
  const schools = useMemo(() => home.data ?? [], [home.data]);
  const [school, setSchool] = useState(wanted ?? "");
  useEffect(() => { if (!school && schools.length) setSchool(schools[0].institution_id); }, [schools, school]);
  const roster = useLoad(async () => (school ? schoolRoster(id, school) : undefined), [id, school]);
  const act = useAction(async () => { await roster.reload(); setFound(null); });
  const [division, setDivision] = useState(""), [query, setQuery] = useState(""), [found, setFound] = useState<Array<{ user_id: string; name: string; level: string }> | null>(null), [picked, setPicked] = useState<string[]>([]), [replacing, setReplacing] = useState<{ id: string; name: string } | null>(null), [report, setReport] = useState<string[]>([]);
  const r = roster.data;
  useEffect(() => { if (r && !r.divisions.some((d) => d.id === division)) setDivision(r.divisions[0]?.id ?? ""); }, [r, division]);
  if (!r) return <><Head title="School roster" /><Loading error={home.error || roster.error || (home.data && schools.length === 0 && !wanted ? "You are not recorded as staff of a verified school." : "")} /></>;
  const entered = r.entry_status === "REGISTERED" || r.entry_status === "WAITLISTED";
  const search = () => act.run(async () => { setPicked([]); setFound(await schoolLearners(id, school, division, query)); });
  const names = new Map((found ?? []).map((l) => [l.user_id, l.name]));
  return (
    <>
      <Head title={r.competition.title} lead={`${r.school} · ${r.entry_status ? humanStatus(r.entry_status) : "Not entered"} · ${REGISTRATION[r.competition.registration]} · closes ${when(r.competition.registration_closes_at)}`}>
        {schools.length > 1 && <select aria-label="School" value={school} onChange={(e) => setSchool(e.target.value)}>{schools.map((s) => <option key={s.institution_id} value={s.institution_id}>{s.school}</option>)}</select>}
        <Link className="qb-btn qb-btn-secondary" href={`/inter-school/${r.competition.slug}`}>Public page</Link><Link className="qb-btn qb-btn-secondary" href="/interschool">Back</Link>
      </Head>
      <Notice error={act.error} done={act.done} />
      {report.length > 0 && <div className="qb-card" role="status"><ul className="qb-list">{report.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      {r.locked && <div className="qb-card" role="status">The roster is locked: no more changes.</div>}
      {r.entry_status === "INVITED" && canRegister(r.competition.registration) && <div className="qb-card"><Row><span>Your school is invited.</span><button type="button" className="qb-btn" disabled={act.busy} onClick={() => void act.run(() => schoolRespond(id, school, true), "Your school has joined.")}>Accept</button><button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => void act.run(() => schoolRespond(id, school, false), "Declined.")}>Decline</button></Row></div>}
      {(r.competition.max_per_school || r.competition.max_per_level_per_school) && <p className="qb-muted">Limits: {r.competition.max_per_school ? `${r.competition.max_per_school} learners per school` : ""}{r.competition.max_per_level_per_school ? ` · ${r.competition.max_per_level_per_school} per class level` : ""}</p>}
      {r.divisions.map((d) => (
        <section className="qb-card" key={d.id}>
          <h2>{d.title} <span className="qb-muted qb-small">{d.candidates.filter((c) => c.status === "CONFIRMED" || c.status === "PENDING").length} place(s) used</span></h2>
          {d.candidates.length === 0 ? <p className="qb-muted">No learners yet.</p> : (
            <Table head={["Learner", "Status", ""]}>{d.candidates.map((c) => (
              <tr key={c.id}><td>{c.name}{!c.verified && <div className="qb-muted qb-small">Chose this school at sign-up: check they are yours</div>}</td><td>{humanStatus(c.status)}</td>
                <td><Row>{!r.locked && c.status === "PENDING" && <><button type="button" className="qb-btn" disabled={act.busy} onClick={() => void act.run(() => confirmCandidate(c.id, true), "Confirmed.")}>Confirm</button><button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => void act.run(() => confirmCandidate(c.id, false), "Not confirmed.")}>Reject</button></>}
                  {!r.locked && (c.status === "CONFIRMED" || c.status === "PENDING") && <button type="button" className="qb-link-btn" onClick={() => { setReplacing({ id: c.id, name: c.name }); setDivision(d.id); setFound(null); }}>Replace</button>}
                  {(c.status === "WAITLISTED" || (!r.locked && c.status !== "DISQUALIFIED")) && <button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => { if (window.confirm(`Withdraw ${c.name}?`)) void act.run(() => withdrawCandidate(c.id), "Withdrawn."); }}>Withdraw</button>}</Row></td></tr>))}</Table>)}
        </section>))}
      {!r.locked && r.competition.registration_mode !== "LEARNER" && (entered || r.entry_status === "INVITED" || !r.entry_status) && (
        <section className="qb-card">
          <h2>{replacing ? `Replace ${replacing.name}` : "Enter learners"}</h2>
          <Row>
            <select aria-label="Division" value={division} disabled={Boolean(replacing)} onChange={(e) => { setDivision(e.target.value); setFound(null); }}>{r.divisions.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select>
            <input aria-label="Learner name" placeholder="Name (optional)" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
            <button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy || !division} onClick={() => void search()}>Find learners</button>
            {replacing && <button type="button" className="qb-link-btn" onClick={() => setReplacing(null)}>Stop replacing</button>}
          </Row>
          {found && (found.length === 0 ? <p className="qb-muted">No eligible learners found. Learners must be in your school or classes, at this class level, and not already entered.</p> : <>
            <div style={{ display: "grid", gap: 4, margin: "12px 0" }}>{found.map((l) => <label key={l.user_id} className="qb-check"><input type={replacing ? "radio" : "checkbox"} name="learner" checked={picked.includes(l.user_id)} onChange={(e) => setPicked(replacing ? [l.user_id] : e.target.checked ? [...picked, l.user_id] : picked.filter((x) => x !== l.user_id))} /> {l.name}</label>)}</div>
            <button type="button" className="qb-btn" disabled={act.busy || picked.length === 0} onClick={() => void act.run(async () => {
              if (replacing) { await replaceCandidate(replacing.id, picked[0]); setReplacing(null); setReport([]); return; }
              const out = await nominate(id, school, division, picked);
              setReport(out.results.map((x) => `${names.get(x.user_id) ?? "Learner"}: ${x.ok ? (x.status === "WAITLISTED" ? "on the waiting list" : "entered") : plain(x.error ?? "")}`));
            })}>{replacing ? "Replace with this learner" : `Enter ${picked.length} learner(s)`}</button>
          </>)}
        </section>)}
      {!r.locked && r.entry_status === "REGISTERED" && <div className="qb-card"><Row><button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy} onClick={() => { if (window.confirm("Lock this roster? No learner can be added, replaced or withdrawn afterwards.")) void act.run(() => lockRoster(id, school), "Roster locked."); }}>Lock the roster</button>
        <button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => { if (window.confirm("Withdraw your school from this competition? All its places are given up.")) void act.run(() => schoolRespond(id, school, false), "Your school has withdrawn."); }}>Withdraw the school</button></Row></div>}
    </>
  );
}
export default function RosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Suspense fallback={<div className="qb-card" role="status">Loading…</div>}><Roster id={id} /></Suspense>;
}
