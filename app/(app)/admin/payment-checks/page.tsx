"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CheckResult, CheckRow, Issue } from "@/lib/payments/reconcile";

// Payment checks. Finds payments Paystack says were paid that we did not record, and paid payments whose purchase was never granted, so nobody who paid is left without what they bought.
// "Check now" asks Paystack about each open payment from the last days. "Settle" records the payment and grants the purchase, the same way the webhook does; it is safe to press twice.
const LABEL: Record<Issue, { text: string; tone: string; help: string }> = {
  paid_not_recorded: { text: "Paid, not recorded", tone: "danger", help: "Paystack shows this payment as successful, but our record still says it was not paid. Settle it." },
  paid_not_delivered: { text: "Paid, not delivered", tone: "danger", help: "We recorded the payment, but the subscription or question set was never granted. Settle it to grant it." },
  waiting: { text: "Still in progress", tone: "warning", help: "Paystack says the payment is still being processed (often a mobile-money prompt not yet approved). Check again in a few minutes." },
  unpaid: { text: "Not paid", tone: "neutral", help: "Paystack shows this as abandoned or failed, or never saw it. Nobody was charged. Nothing to do." },
};
const cedis = (minor: number, cur: string) => `${cur} ${(minor / 100).toLocaleString("en-GB", { minimumFractionDigits: minor % 100 ? 2 : 0 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function call(body: Record<string, unknown>) {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in.");
  const res = await fetch("/api/admin/payment-checks", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok && !out?.state) throw new Error(typeof out?.error === "string" ? out.error : "That did not work. Please try again.");
  return out;
}

export default function PaymentChecks() {
  const [days, setDays] = useState(14), [result, setResult] = useState<CheckResult | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [note, setNote] = useState(""), [showUnpaid, setShowUnpaid] = useState(false);

  const check = useCallback(async () => {
    setBusy("check"); setError("");
    try { setResult((await call({ action: "check", days })) as CheckResult); } catch (e: any) { setError(e.message); }
    setBusy("");
  }, [days]);
  useEffect(() => { void check(); }, [check]);

  async function settle(r: CheckRow) {
    setBusy(r.reference); setError(""); setNote("");
    try { const out = await call({ action: "settle", reference: r.reference }); if (out.ok) { setNote(`Settled ${r.reference}. ${r.what ? `"${r.what}" is now with the buyer.` : ""}`); await check(); } else setError(out.error ?? "That did not work."); }
    catch (e: any) { setError(e.message); }
    setBusy("");
  }

  const rows = result?.rows ?? [], act = rows.filter((r) => r.issue === "paid_not_recorded" || r.issue === "paid_not_delivered"), rest = rows.filter((r) => !act.includes(r) && (showUnpaid || r.issue !== "unpaid"));
  return (
    <>
      <div className="qb-page-head"><div><h1>Payment checks</h1><p>Find payments that were paid on Paystack but not recorded or delivered, and settle them. Nobody who paid should be left without what they bought.</p></div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="qb-small">Look back <select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
          <button className="qb-btn" disabled={!!busy} onClick={() => void check()}>{busy === "check" ? "Checking with Paystack…" : "Check now"}</button>
        </div></div>
      {error && <div className="qb-card qb-error" role="alert" style={{ marginBottom: 12 }}>{error}</div>}
      {note && <div className="qb-card" role="status" style={{ marginBottom: 12 }}><strong>{note}</strong></div>}
      {!result ? <div className="qb-card qb-muted">Checking with Paystack…</div> : (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="qb-card" role="status">
            {act.length ? <strong className="qb-error">{act.length} payment{act.length === 1 ? "" : "s"} need{act.length === 1 ? "s" : ""} attention.</strong> : <strong className="qb-ok">All clear: every payment Paystack shows as paid has been recorded and delivered.</strong>}
            <span className="qb-small qb-muted" style={{ display: "block" }}>Checked {result.checked} open payment{result.checked === 1 ? "" : "s"} from the last {days} days{result.unreachable ? `; ${result.unreachable} could not be reached, press Check now again` : ""}.</span>
          </section>

          {!!act.length && <section className="qb-card" style={{ display: "grid", gap: 10 }}>
            <h3 style={{ margin: 0 }}>Needs attention</h3>
            {act.map((r) => <div key={r.reference} className="qb-card" style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><strong>{cedis(r.amount_minor, r.currency)} · {r.what || r.purpose}</strong><span className={`qb-pill ${LABEL[r.issue].tone}`}>{LABEL[r.issue].text}</span></div>
              <span className="qb-small qb-muted">{r.buyer_email ?? "unknown buyer"} · {when(r.created_at)} · {r.reference} · our record: {r.db_status} · Paystack: {r.paystack}</span>
              <span className="qb-small">{LABEL[r.issue].help}</span>
              <button className="qb-btn" style={{ justifySelf: "start" }} disabled={!!busy} onClick={() => void settle(r)}>{busy === r.reference ? "Settling…" : "Settle now"}</button>
            </div>)}
          </section>}

          {!!rest.length || result.rows.some((r) => r.issue === "unpaid") ? <section className="qb-card" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}><h3 style={{ margin: 0 }}>Other open payments</h3>
              <label className="qb-check"><input type="checkbox" checked={showUnpaid} onChange={(e) => setShowUnpaid(e.target.checked)} /> Show payments that were never paid</label></div>
            {!rest.length ? <p className="qb-muted" style={{ margin: 0 }}>Nothing else to show.</p> :
              <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>When</th><th>Amount</th><th>For</th><th>Buyer</th><th>Paystack says</th></tr></thead><tbody>
                {rest.map((r) => <tr key={r.reference}><td>{when(r.created_at)}</td><td>{cedis(r.amount_minor, r.currency)}</td><td>{r.what || r.purpose}</td><td className="qb-small">{r.buyer_email}</td><td><span className={`qb-pill ${LABEL[r.issue].tone}`}>{LABEL[r.issue].text}</span> <span className="qb-small qb-muted">{r.paystack}</span></td></tr>)}
              </tbody></table></div>}
          </section> : null}

          <p className="qb-small qb-muted">Only Paystack&apos;s own answer is trusted. Settling is safe to repeat: it cannot credit or grant twice. Every manual settle is recorded in the audit log. The Paystack webhook should settle most payments on its own; this page is the safety net.</p>
        </div>
      )}
    </>
  );
}
