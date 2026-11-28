"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { billing, decideQuote, fundInvoice, issueCertificates, payInvoice, requestQuote, setListed } from "@/lib/api/interschool";
import BillingTables from "../BillingTables";
import FiguresView from "../FiguresView";
import { Loading, Notice, Row, askReason, useAction, useLoad } from "../ui";
import { SOURCES, campaignLink, ghs, sponsorshipFee, whatsappHref, whatsappMessage } from "@/lib/interschool/text";
import type { Managed } from "@/lib/interschool/types";

export function BillingTab({ c, reload }: { c: Managed; reload: () => Promise<unknown> }) {
  const b = useLoad(() => billing(c.id), [c.id]);
  const act = useAction(async () => { await b.reload(); await reload(); });
  const [participants, setParticipants] = useState(""), [sponsor, setSponsor] = useState(""), [discount, setDiscount] = useState(""), [reason, setReason] = useState("");
  if (!b.data) return <Loading error={b.error} />;
  const d = b.data, n = Number(participants) || Math.max(c.expected_participants - d.funded_participants, 0), off = Math.round((Number(discount) || 0) * 100);
  return (
    <>
      <Notice error={act.error} done={act.done} />
      <div className="qb-card"><h2>Funding</h2>
        <p>{c.funding === "SPONSORED" ? `${d.funded_participants} of ${d.capacity} places funded. ${d.funding_cleared ? "Registration can open." : "Registration cannot open until the capacity is funded."}` : c.funding === "COMPLIMENTARY" ? "Complimentary: nothing to pay." : "Free competition: nothing to pay."}</p>
        {c.funding === "SPONSORED" && !d.billing_on && <p className="qb-muted">Sponsorship billing is not switched on yet.</p>}
        {c.funding === "SPONSORED" && d.billing_on && <>
          <p className="qb-muted">{d.rate_minor == null ? "The price per participant has not been set." : `${n.toLocaleString("en-GB")} participants × ${ghs(Number(d.rate_minor))}${off ? ` less ${ghs(off)}` : ""} ≈ ${ghs(sponsorshipFee(n, Number(d.rate_minor), 0, off))}${!d.funded_participants && Number(d.setup_fee_minor) ? ` plus a setup fee of ${ghs(Number(d.setup_fee_minor))}` : ""}`}</p>
          <Row><label>Participants to quote <input type="number" min={1} style={{ width: 110 }} value={participants} placeholder={String(Math.max(c.expected_participants - d.funded_participants, 0))} onChange={(e) => setParticipants(e.target.value)} /></label></Row>
          {c.is_admin && <Row><label>Sponsor name <input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder={c.sponsor_name ?? ""} /></label>
            <label>Discount (GHS) <input type="number" min={0} step="0.01" style={{ width: 100 }} value={discount} onChange={(e) => setDiscount(e.target.value)} /></label><label>Reason <input value={reason} onChange={(e) => setReason(e.target.value)} /></label></Row>}
          <p><button type="button" className="qb-btn" disabled={act.busy || c.status === "COMPLETED" || c.status === "CANCELLED"} onClick={() => void act.run(() => requestQuote(c.id, c.is_admin ? { participants: participants ? Number(participants) : null, sponsor_name: sponsor || null, discount_minor: off, discount_reason: reason || null } : { participants: participants ? Number(participants) : null }), "Quotation created.")}>{c.is_admin ? "Issue a quotation" : "Request a quotation"}</button></p>
        </>}
        <BillingTables quotes={d.quotations} invoices={d.invoices} busy={act.busy}
          onDecide={(q, accept) => { if (!accept || window.confirm("Accept this quotation and create the invoice?")) void act.run(() => decideQuote(q, accept), "Saved."); }}
          onPay={(i) => void act.run(async () => { window.location.assign(await payInvoice(i)); })}
          invoiceActions={c.is_admin ? (i) => (i.status === "UNPAID" || i.status === "CREDIT" ? <>{([["Record payment", "RECORD_PAYMENT"], ["Approve credit", "APPROVE_CREDIT"], ["Waive", "WAIVE"], ["Void", "VOID"]] as const).filter(([, a]) => i.status === "UNPAID" || a === "RECORD_PAYMENT" || a === "VOID").map(([label, a]) => <button key={a} type="button" className="qb-link-btn" onClick={() => { const note = askReason(`${label}: reference or reason`); if (note) void act.run(() => fundInvoice(i.id, a, note), "Recorded."); }}>{label}</button>)}</> : null) : undefined} />
      </div>
      <div className="qb-card"><FiguresView f={d.figures} /></div>
    </>
  );
}

export function CampaignTab({ c, reload }: { c: Managed; reload: () => Promise<unknown> }) {
  const act = useAction(reload);
  const [origin, setOrigin] = useState(""), [qr, setQr] = useState(""), [copied, setCopied] = useState("");
  useEffect(() => { setOrigin(window.location.origin); void QRCode.toDataURL(campaignLink(window.location.origin, c.slug, "QR"), { margin: 2, width: 480 }).then(setQr); }, [c.slug]);
  const live = ["PUBLISHED", "PAUSED", "CLOSED", "COMPLETED", "CANCELLED"].includes(c.status);
  if (!live) return <div className="qb-card"><p>The campaign page, links and QR code appear when the competition is published.</p></div>;
  const message = origin ? whatsappMessage(c.title, campaignLink(origin, c.slug, "WHATSAPP"), c.registration_closes_at, c.sponsor_name) : "";
  const copy = async (key: string, value: string) => { try { await navigator.clipboard.writeText(value); setCopied(key); setTimeout(() => setCopied(""), 2000); } catch { window.prompt("Copy", value); } };
  return (
    <>
      <Notice error={act.error} done={act.done} />
      <div className="qb-card"><h2>Public page</h2><Row><Link className="qb-btn" href={`/inter-school/${c.slug}`} target="_blank">Open the page</Link><Link className="qb-btn qb-btn-secondary" href={`/inter-school/${c.slug}/flyer`} target="_blank">Printable flyer</Link></Row>
        <p className="qb-muted qb-small">If the page says it cannot be found, public competition pages are not switched on yet.</p></div>
      <div className="qb-card"><h2>Campaign links</h2><p className="qb-muted">Use the matching link in each place, so you can see where registrations come from.</p>
        {SOURCES.map((s) => <Row key={s}><strong style={{ minWidth: 90 }}>{s.charAt(0) + s.slice(1).toLowerCase()}</strong><code style={{ overflowWrap: "anywhere" }}>{origin ? campaignLink(origin, c.slug, s) : ""}</code><button type="button" className="qb-link-btn" onClick={() => void copy(s, campaignLink(origin, c.slug, s))}>{copied === s ? "Copied" : "Copy"}</button></Row>)}</div>
      <div className="qb-card"><h2>WhatsApp message</h2><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{message}</pre><Row><a className="qb-btn qb-btn-whatsapp" href={whatsappHref(message)} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a><button type="button" className="qb-link-btn" onClick={() => void copy("msg", message)}>{copied === "msg" ? "Copied" : "Copy message"}</button></Row></div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a QR code made in the browser */}
      <div className="qb-card"><h2>QR code</h2>{qr && <><img src={qr} alt="QR code for the registration page" width={220} height={220} /><p><a className="qb-link" href={qr} download={`${c.slug}-qr.png`}>Download</a></p></>}</div>
      <div className="qb-card"><h2>Promotion on QuizBox</h2>
        <p>{c.listed_at ? "Listed on the home page, the competitions page and Open to join." : "Not listed."} {c.participation !== "OPEN" && "Only open competitions can be listed."}</p>
        {c.is_admin ? <button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy || (!c.listed_at && (c.participation !== "OPEN" || !["PUBLISHED", "PAUSED"].includes(c.status)))} onClick={() => void act.run(() => setListed(c.id, !c.listed_at), c.listed_at ? "Removed from the lists." : "Listed. The public pages update within a few minutes.")}>{c.listed_at ? "Remove from the lists" : "List this competition"}</button>
          : <p className="qb-muted">A QuizBox administrator approves listings. <Link className="qb-link" href="/support">Ask for yours to be listed</Link>.</p>}</div>
    </>
  );
}

export function CertificatesTab({ c }: { c: Managed }) {
  const act = useAction();
  const [info, setInfo] = useState("");
  return (
    <div className="qb-card">
      <h2>Certificates</h2>
      <p>Participation, finalist, winner and school champion certificates, each with a reference anyone can check. They are issued only when every round is final and no dispute is open.</p>
      <Notice error={act.error} done={info} />
      <button type="button" className="qb-btn" disabled={act.busy || c.status !== "COMPLETED"} onClick={() => void act.run(async () => { const r = await issueCertificates(c.id); setInfo(`${r.issued} new certificate(s). ${r.total} in total.`); })}>Issue certificates</button>
      {c.status !== "COMPLETED" && <p className="qb-muted">The competition is not complete yet.</p>}
      <p><Link className="qb-link" href="/interschool/certificates">Certificates you can download</Link></p>
    </div>
  );
}
