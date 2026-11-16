"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { CheckResult, CheckRow, Issue } from "@/lib/payments/reconcile";
import { Kpi, Panel } from "@/components/admin/DataViz";

// Payment checks. Finds payments Paystack says were paid that we did not record, and paid payments whose purchase was never granted, so nobody who paid is left without what they bought.
// "Check now" asks Paystack about each open payment from the last days. "Settle" records the payment and grants the purchase, the same way the webhook does; it is safe to press twice.
const LABEL: Record<Issue, { text: string; tone: string; help: string }> = {
  paid_not_recorded: { text: "Paid, not recorded", tone: "bad", help: "Paystack shows this payment as successful, but our record still says it was not paid. Settle it." },
  paid_not_delivered: { text: "Paid, not delivered", tone: "bad", help: "We recorded the payment, but the subscription or question set was never granted. Settle it to grant it." },
  waiting: { text: "Still in progress", tone: "warn", help: "Paystack says the payment is still being processed (often a mobile-money prompt not yet approved). Check again in a few minutes." },
  unpaid: { text: "Not paid", tone: "", help: "Paystack shows this as abandoned or failed, or never saw it. Nobody was charged. Nothing to do." },
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
  const n = (k: Issue) => rows.filter((r) => r.issue === k).length;
  return (
    <div className="dx-page">
      <div className="dx-head">
        <div><h1>Payment checks</h1><p>Find payments that were paid on Paystack but not recorded or delivered, and settle them. Nobody who paid should be left without what they bought.</p></div>
        <div className="dx-actions" style={{ alignItems: "center" }}>
          <label className="dx-muted" style={{ fontSize: 12.5 }}>Look back <select className="dx-select" aria-label="Look back" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[3, 7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
          <button className="dx-btn primary" disabled={!!busy} onClick={() => void check()}>{busy === "check" ? "Checking with Paystack…" : "Check now"}</button>
        </div>
      </div>
      <div className="dx-kpis">
        <Kpi label="Need attention" value={result ? act.length : "—"} tone={act.length > 0 ? "warn" : "default"} hint={result ? (act.length ? "settle these" : "all clear") : undefined} />
        <Kpi label="Paid, not recorded" value={result ? n("paid_not_recorded") : "—"} tone={n("paid_not_recorded") > 0 ? "warn" : "default"} />
        <Kpi label="Paid, not delivered" value={result ? n("paid_not_delivered") : "—"} tone={n("paid_not_delivered") > 0 ? "warn" : "default"} />
        <Kpi label="Still in progress" value={result ? n("waiting") : "—"} />
        <Kpi label="Never paid" value={result ? n("unpaid") : "—"} hint="nobody was charged" />
        <Kpi label="Open payments checked" value={result?.checked ?? "—"} hint={result ? `last ${days} days` : undefined} />
      </div>
      {error && <div className="dx-alert error" role="alert">{error}</div>}
      {note && <div className="dx-alert ok" role="status"><strong>{note}</strong></div>}
      {!result ? <p className="dx-muted dx-note">Checking with Paystack…</p> : (
        <>
          <div className={`dx-alert${act.length ? " error" : " ok"}`} role="status">
            {act.length ? <strong>{act.length} payment{act.length === 1 ? "" : "s"} need{act.length === 1 ? "s" : ""} attention.</strong> : <strong>All clear: every payment Paystack shows as paid has been recorded and delivered.</strong>}
            <span className="dx-note" style={{ display: "block" }}>Checked {result.checked} open payment{result.checked === 1 ? "" : "s"} from the last {days} days{result.unreachable ? `; ${result.unreachable} could not be reached, press Check now again.` : "."}</span>
          </div>

          {!!act.length && (
            <Panel title="Needs attention">
              <div className="dx-table-wrap" style={{ maxHeight: "none" }}>
                <table className="dx-table">
                  <thead><tr><th>When</th><th className="num">Amount</th><th>For</th><th>Buyer</th><th>Problem</th><th aria-label="Settle" /></tr></thead>
                  <tbody>{act.map((r) => (
                    <tr key={r.reference}>
                      <td className="dx-muted">{when(r.created_at)}</td><td className="num">{cedis(r.amount_minor, r.currency)}</td>
                      <td className="name" title={`${r.reference} · our record: ${r.db_status} · Paystack: ${r.paystack}`}>{r.what || r.purpose}<div className="dx-muted" style={{ fontWeight: 400, fontSize: 12 }}>{r.reference}</div></td>
                      <td>{r.buyer_email ?? "unknown buyer"}</td>
                      <td title={LABEL[r.issue].help}><span className={`dx-pill ${LABEL[r.issue].tone}`}>{LABEL[r.issue].text}</span><div className="dx-muted" style={{ fontSize: 12, whiteSpace: "normal", maxWidth: 320 }}>{LABEL[r.issue].help}</div></td>
                      <td><button className="dx-btn sm primary" disabled={!!busy} onClick={() => void settle(r)}>{busy === r.reference ? "Settling…" : "Settle now"}</button></td>
                    </tr>))}</tbody>
                </table>
              </div>
            </Panel>
          )}

          {!!rest.length || result.rows.some((r) => r.issue === "unpaid") ? (
            <Panel title="Other open payments" action={<label className="dx-check"><input type="checkbox" checked={showUnpaid} onChange={(e) => setShowUnpaid(e.target.checked)} /> Show payments that were never paid</label>}>
              {!rest.length ? <p className="dx-muted dx-note">Nothing else to show.</p> : (
                <div className="dx-table-wrap" style={{ maxHeight: 360 }}>
                  <table className="dx-table">
                    <thead><tr><th>When</th><th className="num">Amount</th><th>For</th><th>Buyer</th><th>Paystack says</th></tr></thead>
                    <tbody>{rest.map((r) => <tr key={r.reference}><td className="dx-muted">{when(r.created_at)}</td><td className="num">{cedis(r.amount_minor, r.currency)}</td><td className="name">{r.what || r.purpose}</td><td>{r.buyer_email}</td><td><span className={`dx-pill ${LABEL[r.issue].tone}`}>{LABEL[r.issue].text}</span></td></tr>)}</tbody>
                  </table>
                </div>)}
            </Panel>
          ) : null}

          <p className="dx-muted dx-note">Only Paystack&apos;s own answer is trusted. Settling is safe to repeat: it cannot credit or grant twice. Every manual settle is recorded in the audit log. The Paystack webhook should settle most payments on its own; this page is the safety net.</p>
        </>
      )}
    </div>
  );
}
