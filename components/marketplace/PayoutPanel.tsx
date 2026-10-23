"use client";

import { useCallback, useEffect, useState } from "react";
import { cedis, day, myPayouts, payoutCancel, payoutQuote, payoutRequest, PAYOUT_STATUS, when, type Payout, type PayoutQuote } from "@/lib/api/marketplace";

// Requesting a payout. The teacher is shown what they will receive: their sales, less QuizBox's 40%, less any refunds. Approving sends that exact amount; if the balance changed since it was
// shown, the database refuses and the new amount is shown instead. Finance pays by hand within 24 hours on working days.
export default function PayoutPanel({ onChange, verified, holdDays }: { onChange: () => void; verified: boolean; holdDays: number }) {
  const [quote, setQuote] = useState<PayoutQuote | null>(null), [rows, setRows] = useState<Payout[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState("");
  const load = useCallback(async () => {
    try { const [q, p] = await Promise.all([payoutQuote(), myPayouts()]); setQuote(q); setRows(p); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const open = rows.find((r) => r.status === "requested");

  async function approve() {
    if (!quote) return;
    setBusy(true); setError(""); setNote("");
    try { const r = await payoutRequest(quote.amount_minor); setNote(`Requested ${cedis(r.amount_minor)}. It will be paid by ${day(r.due_at)}.`); onChange(); }
    catch (e: any) { setError(e.message); }
    await load(); setBusy(false);
  }
  async function cancel(id: string) {
    setBusy(true); setError("");
    try { await payoutCancel(id); setNote("Payout cancelled. The money is back in your balance."); onChange(); } catch (e: any) { setError(e.message); }
    await load(); setBusy(false);
  }

  return (
    <section className="qb-card" style={{ display: "grid", gap: 12 }}>
      <h3 style={{ margin: 0 }}>Get paid</h3>
      {error && <p className="qb-error" role="alert">{error}</p>}
      {note && <p className="qb-ok" role="status">{note}</p>}
      {!quote ? <p className="qb-muted">Loading…</p> : open ? (
        <p>You have a payout of <strong>{cedis(open.amount_minor)}</strong> waiting to be paid. It is due by <strong>{when(open.due_at)}</strong> (24 hours on working days, Monday to Friday).</p>
      ) : (
        <>
          <p className="qb-muted qb-small" style={{ margin: 0 }}>Sales become available {holdDays} days after they are made. This is what you can request now:</p>
          <table className="qb-table" aria-label="Payout calculation"><tbody>
            <tr><td>Sales available ({quote.sales_count})</td><td style={{ textAlign: "right" }}>{cedis(quote.gross_minor)}</td></tr>
            <tr><td>Less QuizBox&apos;s share ({100 - quote.share_percent}%)</td><td style={{ textAlign: "right" }}>− {cedis(quote.platform_fee_minor)}</td></tr>
            {quote.refunds_minor > 0 && <tr><td>Less refunded sales</td><td style={{ textAlign: "right" }}>− {cedis(quote.refunds_minor)}</td></tr>}
            {quote.adjustments_minor !== 0 && <tr><td>Adjustments</td><td style={{ textAlign: "right" }}>{quote.adjustments_minor > 0 ? "+" : "−"} {cedis(Math.abs(quote.adjustments_minor))}</td></tr>}
            <tr><td><strong>You receive</strong></td><td style={{ textAlign: "right" }}><strong>{cedis(Math.max(0, quote.amount_minor))}</strong></td></tr>
          </tbody></table>
          <p className="qb-small qb-muted" style={{ margin: 0 }}>To: {quote.destination.network} · {quote.destination.account_masked} · {quote.destination.name}</p>
          {quote.amount_minor < 0 && <p className="qb-small qb-muted" style={{ margin: 0 }}>A refund after an earlier payout left your balance below zero. New sales will settle it first.</p>}
          {quote.can_request
            ? <button className="qb-btn" style={{ justifySelf: "start" }} disabled={busy} onClick={() => void approve()}>{busy ? "Requesting…" : `Approve and request ${cedis(quote.amount_minor)}`}</button>
            : <p className="qb-muted qb-small" style={{ margin: 0 }}>{!verified ? "You can request a payout once your seller account is verified." : `The smallest payout is ${cedis(quote.min_payout_minor)}. Keep selling and check back.`}</p>}
          <p className="qb-small qb-muted" style={{ margin: 0 }}>After you approve, the payment is made within 24 hours on working days.</p>
        </>
      )}
      {!!rows.length && <>
        <h4 style={{ margin: "8px 0 0" }}>Your payouts</h4>
        <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Asked</th><th>Amount</th><th>Status</th><th>Reference</th><th /></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}><td>{when(r.requested_at)}</td><td>{cedis(r.amount_minor)}<div className="qb-small qb-muted">{r.sales_count} sale{r.sales_count === 1 ? "" : "s"}</div></td>
            <td><span className={`qb-pill ${r.status === "paid" ? "success" : r.status === "requested" ? "warning" : "neutral"}`}>{PAYOUT_STATUS[r.status]}</span>{r.note && <div className="qb-small qb-muted">{r.note}</div>}</td>
            <td className="qb-small">{r.transfer_ref ?? (r.status === "requested" ? `due ${when(r.due_at)}` : "")}</td>
            <td>{r.status === "requested" && <button className="qb-btn secondary" disabled={busy} onClick={() => void cancel(r.id)}>Cancel</button>}</td></tr>)}
        </tbody></table></div>
      </>}
    </section>
  );
}
