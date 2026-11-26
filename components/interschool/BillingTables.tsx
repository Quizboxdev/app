"use client";

import { Row, Table } from "./ui";
import { day, ghs, humanStatus } from "@/lib/interschool/text";
import type { Invoice, Quote } from "@/lib/interschool/types";

export default function BillingTables({ quotes, invoices, busy, onDecide, onPay, invoiceActions }: {
  quotes: Quote[]; invoices: Invoice[]; busy: boolean; onDecide?: (quote: string, accept: boolean) => void; onPay?: (invoice: string) => void; invoiceActions?: (i: Invoice) => React.ReactNode;
}) {
  return (
    <>
      {quotes.length > 0 && <><h3>Quotations</h3><Table head={["No.", "Sponsor", "Participants", "Rate", "Extras", "Total", "Status", ""]}>{quotes.map((q) => (
        <tr key={q.id}><td>{q.version}</td><td>{q.sponsor_name}</td><td>{q.participants.toLocaleString("en-GB")}</td><td>{ghs(q.rate_minor)}</td>
          <td className="qb-small">{q.setup_fee_minor ? `Setup ${ghs(q.setup_fee_minor)}` : ""}{q.discount_minor ? ` Discount ${ghs(q.discount_minor)} (${q.discount_reason})` : ""}</td><td><strong>{ghs(q.total_minor)}</strong></td>
          <td>{humanStatus(q.status)}{q.status === "ISSUED" && <div className="qb-muted qb-small">valid to {day(q.valid_until)}</div>}</td>
          <td>{onDecide && q.status === "ISSUED" && <Row><button type="button" className="qb-btn" disabled={busy} onClick={() => onDecide(q.id, true)}>Accept</button><button type="button" className="qb-link-btn" disabled={busy} onClick={() => onDecide(q.id, false)}>Decline</button></Row>}</td></tr>))}</Table></>}
      {invoices.length > 0 && <><h3>Invoices</h3><Table head={["Invoice", "Sponsor", "Participants", "Amount", "Status", ""]}>{invoices.map((i) => (
        <tr key={i.id}><td>{i.number}</td><td>{i.sponsor_name}</td><td>{i.participants.toLocaleString("en-GB")}</td><td>{ghs(i.amount_minor)}</td>
          <td>{i.status === "CREDIT" ? "Approved on credit" : humanStatus(i.status)}<div className="qb-muted qb-small">{i.paid_at ? `paid ${day(i.paid_at)}` : i.status === "UNPAID" ? `due ${day(i.due_at)}` : ""}{i.funding_note ? ` ${i.funding_note}` : ""}{i.needs_refund ? " A second or wrong payment needs a refund." : ""}</div></td>
          <td><Row>{onPay && (i.status === "UNPAID" || i.status === "CREDIT") && i.amount_minor >= 500 && <button type="button" className="qb-btn" disabled={busy} onClick={() => onPay(i.id)}>Pay online</button>}{invoiceActions?.(i)}</Row></td></tr>))}</Table></>}
    </>
  );
}
