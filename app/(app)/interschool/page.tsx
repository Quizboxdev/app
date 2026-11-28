"use client";

import Link from "next/link";
import { manageList, myCompetitions, schoolHome, schoolRespond, sponsorHome, withdrawCandidate, raiseDispute } from "@/lib/api/interschool";
import { Head, Loading, Notice, Row, Table, askReason, useAction, useLoad } from "@/components/interschool/ui";
import { REGISTRATION, canRegister, humanStatus, minutes, when } from "@/lib/interschool/text";
import type { Mine } from "@/lib/interschool/types";

// Inter-school home: what you are taking part in, what your school is invited to, and the ways in for organisers and sponsors. Each section appears only if it applies to you.
const STATE: Record<string, string> = { OPEN: "Open now", IN_PROGRESS: "In progress", TAKEN: "Submitted", NOT_OPEN: "Not open yet", WAITING: "Waiting for the round before", NOT_THROUGH: "Not through", CLOSED: "Closed", PAUSED: "Paused", BYE: "Bye", NO_FIXTURE: "No fixture", NOT_CONFIRMED: "Place not confirmed", CANCELLED: "Cancelled" };

export default function InterschoolHome() {
  const mine = useLoad(myCompetitions), school = useLoad(schoolHome);
  const manage = useLoad(() => manageList().catch(() => null)), sponsor = useLoad(() => sponsorHome().catch(() => null));
  const act = useAction(async () => { await Promise.all([mine.reload(), school.reload()]); });
  if (!mine.data) return <><Head title="Inter-school competitions" /><Loading error={mine.error} /></>;
  const can = manage.data?.can_create, organiser = Boolean(can && (can.admin || can.sponsor || can.schools.length)) || Boolean(manage.data?.competitions.length);

  const rounds = (c: Mine[number]) => (
    <Table head={["Round", "When", "State", "Result", ""]}>{c.rounds.map((r) => (
      <tr key={r.round_id}>
        <td>{r.title}<div className="qb-muted qb-small">{r.question_count} questions · {minutes(r.duration_seconds)}{r.opponent ? ` · against ${r.opponent}` : ""}</div></td>
        <td className="qb-small">{when(r.opens_at)}<br />to {when(r.closes_at)}</td>
        <td>{STATE[r.state] ?? humanStatus(r.state)}</td>
        <td>{r.result ? (r.result.absent ? "Absent" : <>{r.result.score}/{r.result.max_score} ({r.result.percent}%){r.result.rank ? ` · rank ${r.result.rank}` : ""}<div className="qb-small">{r.result.qualified ? "Qualified" : ""}</div></>) : <span className="qb-muted">After the round</span>}</td>
        <td><Row>
          {(r.state === "OPEN" || r.state === "IN_PROGRESS") && <Link className="qb-btn" href={`/interschool/sit/${r.round_id}`}>{r.state === "OPEN" ? "Start" : "Continue"}</Link>}
          {r.result && <><Link className="qb-link" href={`/interschool/results/${r.round_id}`}>Results</Link>
            <button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => { const why = askReason("What is wrong with this result? (at least 10 characters)"); if (why) void act.run(() => raiseDispute(r.round_id, why), "Your dispute was sent to the organiser."); }}>Dispute</button></>}
        </Row></td>
      </tr>))}</Table>
  );

  return (
    <>
      <Head title="Inter-school competitions" lead="Competitions between schools, round by round.">
        <Link className="qb-btn qb-btn-secondary" href="/inter-school">Find open competitions</Link>
        <Link className="qb-btn qb-btn-secondary" href="/interschool/certificates">Certificates</Link>
        {organiser && <Link className="qb-btn" href="/interschool/manage">Organise</Link>}
        {Boolean(sponsor.data?.length || can?.sponsor) && <Link className="qb-btn qb-btn-secondary" href="/interschool/sponsor">Sponsorship</Link>}
        {can?.admin && <Link className="qb-btn qb-btn-secondary" href="/admin/interschool">Administration</Link>}
      </Head>
      <Notice error={act.error || school.error} done={act.done} />

      {mine.data.map((c) => (
        <section className="qb-card" key={c.candidate_id}>
          <h2><Link className="qb-link" href={`/inter-school/${c.competition.slug}`}>{c.competition.title}</Link></h2>
          <p className="qb-muted">{c.division}{c.school ? ` · ${c.school}` : ""} · {c.status === "PENDING" ? "Waiting for your school to confirm" : humanStatus(c.status)}{c.status_reason ? `: ${c.status_reason}` : ""}{c.competition.status === "CANCELLED" ? " · Competition cancelled" : ""}</p>
          {rounds(c)}
          {c.can_withdraw && c.competition.status !== "COMPLETED" && c.competition.status !== "CANCELLED" && <p><button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => { if (window.confirm("Give up your place in this competition?")) void act.run(() => withdrawCandidate(c.candidate_id), "You have withdrawn."); }}>Withdraw</button></p>}
        </section>))}
      {mine.data.length === 0 && <div className="qb-card"><p>You are not registered for a competition yet. <Link className="qb-link" href="/inter-school">See the open ones</Link>, or use the link your school shared.</p></div>}

      {school.data?.map((s) => (
        <section className="qb-card" key={s.institution_id}>
          <h2>{s.school}</h2>
          {s.competitions.length === 0 ? <p className="qb-muted">No invitations or open competitions right now.</p> : (
            <Table head={["Competition", "Your school", "Places", "Registration", ""]}>{s.competitions.map((c) => (
              <tr key={c.id}>
                <td><Link className="qb-link" href={`/inter-school/${c.slug}`}>{c.title}</Link><div className="qb-muted qb-small">closes {when(c.registration_closes_at)}</div></td>
                <td>{c.entry_status ? humanStatus(c.entry_status) : "Not entered"}</td>
                <td>{c.places_used}{c.max_per_school ? ` / ${c.max_per_school}` : ""}</td>
                <td>{REGISTRATION[c.registration]}</td>
                <td><Row>
                  {(c.entry_status === "INVITED" || !c.entry_status) && canRegister(c.registration) && <button type="button" className="qb-btn" disabled={act.busy} onClick={() => void act.run(() => schoolRespond(c.id, s.institution_id, true), "Your school has joined.")}>{c.entry_status ? "Accept" : "Join"}</button>}
                  {c.entry_status === "INVITED" && <button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => void act.run(() => schoolRespond(c.id, s.institution_id, false), "Invitation declined.")}>Decline</button>}
                  {c.entry_status && c.entry_status !== "DECLINED" && <Link className="qb-link" href={`/interschool/school/${c.id}?school=${s.institution_id}`}>Roster</Link>}
                </Row></td>
              </tr>))}</Table>)}
        </section>))}
    </>
  );
}
