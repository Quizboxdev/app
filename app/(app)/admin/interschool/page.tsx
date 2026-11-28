"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adminOverview, decideCompetition, fundInvoice, revokeCertificate, setRate } from "@/lib/api/interschool";
import { Head, Loading, Notice, Row, Stat, Table, askReason, useAction, useLoad } from "@/components/interschool/ui";
import { ghs, humanStatus, when } from "@/lib/interschool/text";

// Everything waiting for a QuizBox administrator: approvals, money, rounds to finalise, disputes, the sponsorship price and certificates.
export default function AdminInterschoolPage() {
  const o = useLoad(adminOverview);
  const act = useAction(async () => { await o.reload(); });
  const [rate, setRateText] = useState(""), [setup, setSetup] = useState("");
  useEffect(() => { if (o.data) { setRateText(o.data.settings.rate_minor == null ? "" : String(Number(o.data.settings.rate_minor) / 100)); setSetup(String(Number(o.data.settings.setup_fee_minor ?? 0) / 100)); } }, [o.data]);
  if (!o.data) return <><Head title="Inter-school competitions" /><Loading error={o.error} /></>;
  const d = o.data;
  return (
    <>
      <Head title="Inter-school competitions" lead="Approvals, funding, results and disputes."><Link className="qb-btn" href="/interschool/manage">All competitions</Link></Head>
      <Notice error={act.error} done={act.done} />
      <Row>{Object.entries(d.by_status).map(([k, v]) => <Stat key={k} label={humanStatus(k)} value={v} />)}<Stat label="Payments to refund" value={d.refunds_to_review} /></Row>
      <div className="qb-card"><h2>Waiting for approval</h2>{d.waiting_approval.length === 0 ? <p className="qb-muted">Nothing waiting.</p> : (
        <Table head={["Competition", "Organiser", "Kind", "Places", ""]}>{d.waiting_approval.map((c) => <tr key={c.id}><td><Link className="qb-link" href={`/interschool/manage/${c.id}`}>{c.title}</Link></td><td>{c.organiser}</td><td>{humanStatus(c.kind)} · {c.participation.toLowerCase()} · {c.funding.toLowerCase()}</td><td>{c.capacity}</td>
          <td><Row><button type="button" className="qb-btn" disabled={act.busy} onClick={() => void act.run(() => decideCompetition(c.id, true, null), "Approved.")}>Approve</button><button type="button" className="qb-link-btn" onClick={() => { const why = askReason("What must change?"); if (why) void act.run(() => decideCompetition(c.id, false, why), "Sent back."); }}>Send back</button></Row></td></tr>)}</Table>)}</div>
      <div className="qb-card"><h2>Invoices awaiting payment</h2>{d.unpaid_invoices.length === 0 ? <p className="qb-muted">None.</p> : (
        <Table head={["Invoice", "Competition", "Sponsor", "Amount", "Status", ""]}>{d.unpaid_invoices.map((i) => <tr key={i.id}><td>{i.number}</td><td><Link className="qb-link" href={`/interschool/manage/${i.competition_id}`}>{i.competition}</Link></td><td>{i.sponsor}</td><td>{ghs(i.amount_minor)}</td><td>{i.status === "CREDIT" ? "On credit" : "Unpaid"}</td>
          <td><button type="button" className="qb-link-btn" onClick={() => { const note = askReason("Payment reference (bank, cheque or receipt)"); if (note) void act.run(() => fundInvoice(i.id, "RECORD_PAYMENT", note), "Payment recorded."); }}>Record payment</button></td></tr>)}</Table>)}</div>
      <div className="qb-card"><h2>Rounds to finalise</h2>{d.rounds_to_finalise.length === 0 ? <p className="qb-muted">None.</p> : <ul className="qb-list">{d.rounds_to_finalise.map((r) => <li key={r.round_id}><Link className="qb-link" href={`/interschool/manage/${r.competition_id}`}>{r.competition}</Link>: {r.division}, {r.round} (closed {when(r.closed_at)})</li>)}</ul>}</div>
      <div className="qb-card"><h2>Open disputes</h2>{d.open_disputes.length === 0 ? <p className="qb-muted">None.</p> : <ul className="qb-list">{d.open_disputes.map((q) => <li key={q.id}><Link className="qb-link" href={`/interschool/manage/${q.competition_id}`}>{q.competition}</Link>: {q.reason}</li>)}</ul>}</div>
      <form className="qb-card" onSubmit={(e) => { e.preventDefault(); void act.run(() => setRate(Math.round(Number(rate) * 100), Math.round(Number(setup || 0) * 100)), "Price saved. Quotations already issued keep their own rate."); }}>
        <h2>Sponsorship price</h2>
        <Row><label>Per participant (GHS) <input type="number" min={0} step="0.01" required value={rate} onChange={(e) => setRateText(e.target.value)} /></label><label>Setup fee (GHS) <input type="number" min={0} step="0.01" value={setup} onChange={(e) => setSetup(e.target.value)} /></label><button className="qb-btn" disabled={act.busy || rate === ""}>Save price</button></Row>
        <p className="qb-muted qb-small">Managed (under 13) learners {d.settings.allow_managed_learners ? "may be entered by their school." : "cannot be entered."} This is changed by the owner in the platform settings.</p>
      </form>
      <div className="qb-card"><h2>Certificates</h2><button type="button" className="qb-link-btn" onClick={() => { const code = askReason("Certificate reference to withdraw (QBC-…)"); if (!code) return; const why = askReason("Reason"); if (why) void act.run(() => revokeCertificate(code, why), "Certificate withdrawn."); }}>Withdraw a certificate</button></div>
    </>
  );
}
