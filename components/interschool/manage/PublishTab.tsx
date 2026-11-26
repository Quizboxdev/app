"use client";

import { useState } from "react";
import { checkCompetition, decideCompetition, publishCompetition, requestApproval, setStatus } from "@/lib/api/interschool";
import { Notice, Row, Table, askReason, useAction, useLoad } from "../ui";
import { RULE, SCORING, TIE_BREAK, levelName, minutes, problemText, when } from "@/lib/interschool/text";
import type { Managed } from "@/lib/interschool/types";

// Preview what participants will see, check readiness, get approval, publish, and manage the competition's state.
export default function PublishTab({ c, reload }: { c: Managed; reload: () => Promise<unknown> }) {
  const check = useLoad(() => checkCompetition(c.id), [c]);
  const act = useAction(async () => { await reload(); });
  const [preview, setPreview] = useState(false);
  const draft = c.status === "DRAFT", waiting = c.status === "PENDING_APPROVAL";
  const needs = c.needs_approval && !c.approved_at;
  return (
    <>
      <Notice error={act.error || check.error} done={act.done} />
      <div className="qb-card">
        <h2>Preview</h2>
        <button type="button" className="qb-btn qb-btn-secondary" onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Preview"}</button>
        {preview && <div style={{ marginTop: 12 }}>
          <h3>{c.title}</h3><p>{c.description}</p>
          <p className="qb-muted">{c.participation === "OPEN" ? "Open to verified schools" : "By invitation"} · Register {when(c.registration_opens_at)} to {when(c.registration_closes_at)} · Runs {when(c.opens_at)} to {when(c.ends_at)} · {c.capacity} places{c.max_per_school ? `, ${c.max_per_school} per school` : ""}</p>
          {c.divisions.map((d) => <div key={d.id}><h3>{d.title} <span className="qb-muted qb-small">{d.level_codes.map(levelName).join(", ")}</span></h3>
            <Table head={["Round", "When", "Paper", "Who goes through"]}>{d.rounds.map((r, i) => <tr key={i}><td>{r.title}</td><td className="qb-small">{when(r.opens_at)} to {when(r.closes_at)}</td><td>{r.sections.reduce((n, s) => n + s.count, 0)} questions, {minutes(r.duration_seconds)}</td><td>{RULE[r.rule]}{r.pass_percent != null ? ` · ${r.pass_percent}%` : ""}{r.top_n ? ` · top ${r.top_n}` : ""}</td></tr>)}</Table></div>)}
          <p><strong>School ranking:</strong> {SCORING[c.school_scoring]}. {TIE_BREAK}</p>
          {c.prizes && <p style={{ whiteSpace: "pre-line" }}><strong>Prizes:</strong> {c.prizes}</p>}{c.rules && <p style={{ whiteSpace: "pre-line" }}><strong>Rules:</strong> {c.rules}</p>}
        </div>}
      </div>
      {(draft || waiting) && check.data && <div className="qb-card">
        <h2>Readiness</h2>
        {check.data.problems.length === 0 ? <p role="status">Everything needed is in place, and every round has enough approved questions.</p> : <ul className="qb-list">{check.data.problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}</ul>}
        {c.funding === "SPONSORED" && !c.funding_cleared_at && <p className="qb-muted">Sponsored: accept a quotation and pay (or get funding approval) on the Billing tab before publishing.</p>}
        <Row>
          {draft && needs && <button type="button" className="qb-btn" disabled={act.busy} onClick={() => void act.run(() => requestApproval(c.id), "Sent to QuizBox for approval.")}>Ask QuizBox to approve</button>}
          {draft && !needs && <button type="button" className="qb-btn" disabled={act.busy || check.data.problems.length > 0} onClick={() => { if (window.confirm("Publish now? Question papers are fixed and the rules can no longer change.")) void act.run(() => publishCompetition(c.id), "Published. Question papers are frozen."); }}>Publish</button>}
          {waiting && !c.is_admin && <span role="status">Waiting for QuizBox to approve.</span>}
          {waiting && c.is_admin && <><button type="button" className="qb-btn" disabled={act.busy} onClick={() => void act.run(() => decideCompetition(c.id, true, null), "Approved.")}>Approve</button>
            <button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy} onClick={() => { const why = askReason("What must change?"); if (why) void act.run(() => decideCompetition(c.id, false, why), "Sent back."); }}>Send back</button></>}
        </Row>
      </div>}
      {c.status !== "COMPLETED" && c.status !== "CANCELLED" && <div className="qb-card">
        <h2>State: {c.status.toLowerCase().replaceAll("_", " ")}</h2>
        <Row>
          {c.status === "PUBLISHED" && <button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy} onClick={() => void act.run(() => setStatus(c.id, "PAUSED"), "Paused: no registration and no rounds until resumed.")}>Pause</button>}
          {(c.status === "PAUSED" || c.status === "CLOSED") && <button type="button" className="qb-btn" disabled={act.busy} onClick={() => void act.run(() => setStatus(c.id, "PUBLISHED"), "Open again.")}>Resume</button>}
          {(c.status === "PUBLISHED" || c.status === "PAUSED") && <button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy} onClick={() => { if (window.confirm("Close registration? Rounds still run for those already entered.")) void act.run(() => setStatus(c.id, "CLOSED"), "Registration closed."); }}>Close registration</button>}
          <button type="button" className="qb-link-btn" disabled={act.busy} onClick={() => { const why = askReason("Why is it cancelled? Every school and learner will see this."); if (why && window.confirm("Cancel this competition? This cannot be undone.")) void act.run(() => setStatus(c.id, "CANCELLED", why), "Cancelled. Everyone taking part has been told."); }}>Cancel competition</button>
        </Row>
      </div>}
    </>
  );
}
