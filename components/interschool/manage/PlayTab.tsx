"use client";

import { useState } from "react";
import { addFixture, adjustScore, announceRound, changeFixture, disqualify, finaliseRound, generateFixtures, operations, qualify, registrations, resolveDispute, roundResults } from "@/lib/api/interschool";
import ResultsView from "../ResultsView";
import { Loading, Notice, Row, Table, askReason, useAction, useLoad } from "../ui";
import { RULE, humanStatus, when } from "@/lib/interschool/text";
import { fromInput, toInput } from "@/lib/interschool/wizard";
import type { Managed, Operations, Results } from "@/lib/interschool/types";

// Fixtures, finalising rounds, results, authorised qualification and corrections, and disputes.
export default function PlayTab({ c, reload }: { c: Managed; reload: () => Promise<unknown> }) {
  const ops = useLoad(() => operations(c.id), [c.id]), schools = useLoad(() => registrations(c.id), [c.id]);
  const [results, setResults] = useState<{ round: Operations["rounds"][number]; data: Results } | null>(null);
  const act = useAction(async () => { await ops.reload(); await reload(); if (results) setResults({ round: results.round, data: await roundResults(results.round.round_id) }); });
  const [add, setAdd] = useState<{ round: string; home: string; away: string; from: string; to: string } | null>(null), [groups, setGroups] = useState(2);
  if (c.status === "DRAFT" || c.status === "PENDING_APPROVAL") return <div className="qb-card"><p>Publish the competition first.</p></div>;
  if (!ops.data) return <Loading error={ops.error} />;
  const registered = (schools.data?.schools ?? []).filter((s) => s.status === "REGISTERED");
  const divisions = Array.from(new Map(ops.data.rounds.map((r) => [r.division_id, r.division])).entries());
  return (
    <>
      <Notice error={act.error} done={act.done} />
      {divisions.map(([id, title]) => {
        const rounds = ops.data!.rounds.filter((r) => r.division_id === id);
        const formats = Array.from(new Set(rounds.filter((r) => !r.finalised_at && r.format !== "FIELD").map((r) => r.format)));
        return (
          <div className="qb-card" key={id}>
            <h2>{title}</h2>
            {formats.length > 0 && <Row>{formats.map((f) => <button key={f} type="button" className="qb-btn qb-btn-secondary" disabled={act.busy} onClick={() => { if (window.confirm("Generate fixtures? Existing unplayed fixtures of this format are replaced.")) void act.run(() => generateFixtures(id, f, f === "GROUP" ? groups : 1), "Fixtures generated and schools told."); }}>Generate {f.replaceAll("_", " ").toLowerCase()} fixtures</button>)}
              {formats.includes("GROUP") && <label>Groups <input type="number" min={1} max={32} style={{ width: 70 }} value={groups} onChange={(e) => setGroups(Number(e.target.value) || 1)} /></label>}</Row>}
            {rounds.map((r) => (
              <div key={r.round_id} style={{ borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 12, marginTop: 12 }}>
                <h3>{r.title} <span className="qb-muted qb-small">{when(r.opens_at)} to {when(r.closes_at)} · {RULE[r.rule]} · {r.submitted} of {r.started} submitted{r.finalised_at ? " · final" : ""}</span></h3>
                {r.format !== "FIELD" && r.fixtures.length > 0 && <Table head={["Fixture", "When", "State", ""]}>{r.fixtures.map((f) => (
                  <tr key={f.id}><td>{f.group_no ? `Group ${f.group_no}: ` : ""}{f.home} {f.away ? `v ${f.away}` : "(bye)"}</td><td className="qb-small">{when(f.scheduled_at)}</td><td>{humanStatus(f.status)}{f.winner ? `: ${f.winner}` : ""}{f.note && f.note !== "bye" ? <div className="qb-muted qb-small">{f.note}</div> : null}</td>
                    <td>{f.status === "SCHEDULED" && f.away && !r.finalised_at && <Row>
                      <input type="datetime-local" aria-label="New start (GMT)" defaultValue={toInput(f.scheduled_at)} onBlur={(e) => { const from = fromInput(e.target.value); if (from && toInput(from) !== toInput(f.scheduled_at) && window.confirm("Move this fixture and tell both schools?")) void act.run(() => changeFixture(f.id, { from }), "Fixture moved."); }} />
                      <button type="button" className="qb-link-btn" onClick={() => { const why = askReason("Why is the fixture cancelled?"); if (why) void act.run(() => changeFixture(f.id, { cancel: true, reason: why }), "Fixture cancelled."); }}>Cancel</button></Row>}</td></tr>))}</Table>}
                <Row>
                  {r.format !== "FIELD" && !r.finalised_at && <button type="button" className="qb-link-btn" onClick={() => setAdd({ round: r.round_id, home: "", away: "", from: toInput(r.opens_at), to: toInput(r.closes_at) })}>Add a fixture</button>}
                  {!r.finalised_at && new Date(r.closes_at) <= new Date() && <button type="button" className="qb-btn" disabled={act.busy} onClick={() => void act.run(() => finaliseRound(r.round_id), "Round finalised.")}>Finalise round</button>}
                  {!r.finalised_at && new Date(r.closes_at) > new Date() && c.is_admin && r.started > 0 && <button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => { if (window.confirm("Finalise before the closing time? Learners who have not started lose the chance.")) void act.run(() => finaliseRound(r.round_id, true), "Round finalised early."); }}>Finalise early</button>}
                  {r.finalised_at && <button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy} onClick={() => void act.run(async () => setResults({ round: r, data: await roundResults(r.round_id) }))}>Results</button>}
                  {r.finalised_at && r.rule === "MANUAL" && <button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => { if (window.confirm("Tell learners who goes through?")) void act.run(() => announceRound(r.round_id), "Announced."); }}>Announce qualifiers</button>}
                </Row>
                {add?.round === r.round_id && <Row>
                  <select aria-label="Home school" value={add.home} onChange={(e) => setAdd({ ...add, home: e.target.value })}><option value="">Home school</option>{registered.map((s) => <option key={s.institution_id} value={s.institution_id}>{s.school}</option>)}</select>
                  <select aria-label="Away school" value={add.away} onChange={(e) => setAdd({ ...add, away: e.target.value })}><option value="">Bye (no opponent)</option>{registered.filter((s) => s.institution_id !== add.home).map((s) => <option key={s.institution_id} value={s.institution_id}>{s.school}</option>)}</select>
                  <input type="datetime-local" aria-label="Starts (GMT)" value={add.from} onChange={(e) => setAdd({ ...add, from: e.target.value })} /><input type="datetime-local" aria-label="Ends (GMT)" value={add.to} onChange={(e) => setAdd({ ...add, to: e.target.value })} />
                  <button type="button" className="qb-btn" disabled={act.busy || !add.home} onClick={() => void act.run(async () => { await addFixture(add.round, add.home, add.away || null, fromInput(add.from)!, fromInput(add.to)!); setAdd(null); }, "Fixture added.")}>Add</button></Row>}
              </div>))}
          </div>);
      })}
      {results && <div>
        <h2>{results.round.division}: {results.round.title}</h2>
        <ResultsView r={results.data} actions={(l) => <Row>
          {(results.round.rule === "MANUAL" || c.is_admin) && <button type="button" className="qb-link-btn" onClick={() => { const why = askReason(`Reason to ${l.qualified ? "remove" : "qualify"} ${l.name}`); if (why) void act.run(() => qualify(results.round.round_id, [l.candidate_id], !l.qualified, why), "Saved."); }}>{l.qualified ? "Remove" : "Qualify"}</button>}
          {c.is_admin && <button type="button" className="qb-link-btn" onClick={() => { const score = askReason(`Corrected score for ${l.name} (0 to ${l.max_score})`); if (score === null || !/^\d+$/.test(score)) return; const why = askReason("Reason for the correction"); if (why) void act.run(() => adjustScore(results.round.round_id, l.candidate_id, Number(score), why), "Score corrected and recorded."); }}>Correct score</button>}
          <button type="button" className="qb-link-btn" onClick={() => { const why = askReason(`Why is ${l.name} disqualified?`); if (why && window.confirm("Disqualify this learner from the competition?")) void act.run(() => disqualify(l.candidate_id, why), "Disqualified."); }}>Disqualify</button></Row>} />
      </div>}
      <div className="qb-card"><h2>Disputes</h2>{ops.data.disputes.length === 0 ? <p className="qb-muted">None.</p> : (
        <Table head={["Raised", "School", "Complaint", "State", ""]}>{ops.data.disputes.map((q) => <tr key={q.id}><td className="qb-small">{when(q.created_at)}</td><td>{q.school ?? ""}</td><td>{q.reason}</td><td>{humanStatus(q.status)}{q.resolution && <div className="qb-muted qb-small">{q.resolution}</div>}</td>
          <td>{q.status === "OPEN" && <Row>{([["Uphold", true], ["Reject", false]] as const).map(([label, upheld]) => <button key={label} type="button" className="qb-link-btn" onClick={() => { const why = askReason(`${label}: write the decision`); if (why) void act.run(() => resolveDispute(q.id, upheld, why), "Decision recorded."); }}>{label}</button>)}</Row>}</td></tr>)}</Table>)}</div>
    </>
  );
}
