"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { confirmInvoicePayment, decideQuote, payInvoice, requestQuote, sponsorHome } from "@/lib/api/interschool";
import { Head, Loading, Notice, Row, useAction, useLoad } from "@/components/interschool/ui";
import BillingTables from "@/components/interschool/BillingTables";
import FiguresView from "@/components/interschool/FiguresView";
import { REGISTRATION, humanStatus } from "@/lib/interschool/text";

// A sponsor's competitions: quotations, invoices, payment and participation figures. Numbers only: no learner is ever named here.
function Sponsor() {
  const reference = useSearchParams().get("reference");
  const home = useLoad(sponsorHome);
  const act = useAction(async () => { await home.reload(); });
  const [paid, setPaid] = useState("");
  useEffect(() => {
    if (!reference) return;
    setPaid("Checking your payment…");
    void confirmInvoicePayment(reference).then((state) => { setPaid(state === "confirmed" ? "Payment received. Thank you." : state === "failed" ? "The payment did not complete. You have not been charged twice: try again or contact us." : "The payment is not confirmed yet. This page will show it once Paystack confirms it."); void home.reload(); });
  }, [reference]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!home.data) return <><Head title="Sponsorship" /><Loading error={home.error} /></>;
  return (
    <>
      <Head title="Sponsorship" lead="Fee = expected participants × the QuizBox rate per participant. Unused places are not refunded automatically.">
        <Link className="qb-btn" href="/interschool/manage">Create a competition</Link><Link className="qb-btn qb-btn-secondary" href="/interschool">Back</Link>
      </Head>
      <Notice error={act.error} done={paid || act.done} />
      {home.data.length === 0 && <div className="qb-card"><p>No sponsored competitions yet. Verified sponsors can create one and request a quotation.</p></div>}
      {home.data.map((c) => (
        <section className="qb-card" key={c.id}>
          <h2>{c.title}</h2>
          <p className="qb-muted">{humanStatus(c.status)} · {REGISTRATION[c.registration]} · {c.funding_cleared ? "Funding confirmed" : "Funding not yet confirmed"}</p>
          <Row>
            {c.organiser && <><Link className="qb-link" href={`/interschool/manage/${c.id}`}>Manage</Link>
              {c.funding === "SPONSORED" && c.status !== "COMPLETED" && c.status !== "CANCELLED" && <button type="button" className="qb-btn qb-btn-secondary" disabled={act.busy} onClick={() => { let participants: number | null = null; if (c.funding_cleared) { const n = window.prompt("How many more participant places do you want to sponsor?"); if (!n || !/^\d+$/.test(n.trim()) || Number(n) < 1) return; participants = Number(n); } void act.run(() => requestQuote(c.id, { participants }), "A new quotation is ready below."); }}>{c.funding_cleared ? "Add more places" : "Request a quotation"}</button>}</>}
            {c.status !== "DRAFT" && c.status !== "PENDING_APPROVAL" && <Link className="qb-link" href={`/inter-school/${c.slug}`}>Public page</Link>}
          </Row>
          <BillingTables quotes={c.quotations} invoices={c.invoices} busy={act.busy}
            onDecide={(q, accept) => { if (!accept || window.confirm("Accept this quotation? The rate is then fixed and an invoice is created.")) void act.run(() => decideQuote(q, accept), accept ? "Accepted. The invoice is below." : "Declined."); }}
            onPay={(invoice) => void act.run(async () => { window.location.assign(await payInvoice(invoice)); })} />
          <FiguresView f={c.figures} />
        </section>))}
    </>
  );
}
export default function SponsorPage() { return <Suspense fallback={<div className="qb-card" role="status">Loading…</div>}><Sponsor /></Suspense>; }
