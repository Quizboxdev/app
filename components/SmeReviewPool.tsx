"use client";

import { useCallback, useEffect, useState } from "react";
import { getPool, pickQuestions, releasePick, type Pool, type PoolFee } from "@/lib/api/sme-pool";
import { describeCode, userFacingError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";

const money = (currency: string, value: number) => `${currency} ${value.toFixed(2)}`;
const earned = (m: Record<string, string>) => Object.entries(m ?? {}).map(([c, v]) => money(c, Number(v))).join(", ") || "0";
function feeText(fee: PoolFee | null) {
  if (!fee) return "No fee set";
  const approved = fee.review + fee.approve;
  return `${money(fee.currency, approved)} per approved review (${money(fee.currency, approved * 100)} for 100)`;
}

// The review pool: loaded questions waiting for a subject expert. Pick claims them, they become yours alone, unfinished picks return
// by themselves. What counts and what each review pays come from admin settings, never from this page.
export default function SmeReviewPool() {
  const [pool, setPool] = useState<Pool | null>(null), [hidden, setHidden] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [counts, setCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    try { setPool(await getPool()); setError(""); }
    catch (cause) {
      // Admins without an SME profile have no pool; show nothing instead of an error.
      if (String((cause as { message?: string })?.message ?? "").startsWith("QB_SME_PROFILE_REQUIRED")) setHidden(true);
      else setError(userFacingError(cause));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const changed = async () => { await load(); window.dispatchEvent(new Event("qb:review-queue")); };

  async function pick(key: string, count: number, subject: string, grade: string) {
    if (busy || count < 1) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await pickQuestions(count, subject, grade);
      setNotice(r.picked > 0 ? `${r.picked} question${r.picked === 1 ? "" : "s"} picked. They are in your review queue below and are yours alone.` : describeCode(r.reason ?? "POOL_EMPTY"));
      setCounts((c) => ({ ...c, [key]: 0 }));
      await changed();
    } catch (cause) { setError(userFacingError(cause)); } finally { setBusy(false); }
  }
  async function release(assignment: string) {
    if (busy || !window.confirm("Return this question to the pool? It will not be paid.")) return;
    setBusy(true); setError(""); setNotice("");
    try { await releasePick(assignment); setNotice("Returned to the pool."); await changed(); }
    catch (cause) { setError(userFacingError(cause)); } finally { setBusy(false); }
  }

  if (hidden) return null;
  if (!pool && !error) return <section className="qb-card" aria-busy="true"><h2>Review pool</h2><p className="qb-muted">Loading…</p></section>;
  return <section className="qb-card" aria-labelledby="pool-title">
    <h2 id="pool-title">Review pool</h2>
    <p className="qb-muted">Questions waiting for a subject expert in your subjects. Pick the ones you will review; each becomes yours alone.</p>
    {error && <p className="qb-error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {pool && <>
      <dl className="qb-stat-list">
        <div><dt>Waiting for you</dt><dd>{pool.available.total}{pool.available.capped ? "+" : ""}</dd></div>
        <div><dt>Picked today</dt><dd>{pool.today.picked} of {pool.settings.daily_cap}</dd></div>
        <div><dt>Holding now</dt><dd>{pool.today.open} of {pool.settings.max_open}</dd></div>
        <div><dt>Reviewed today</dt><dd>{pool.today.completed}</dd></div>
        <div><dt>Earned today</dt><dd>{earned(pool.today.earned)}</dd></div>
      </dl>
      {pool.available.without_fee > 0 && <p className="qb-muted">{pool.available.without_fee} questions in your subjects have no review fee set yet, so they cannot be picked. Ask an administrator.</p>}
      {pool.available.groups.length === 0
        ? <p className="qb-muted">Nothing is waiting for your subjects right now.</p>
        : <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Subject</th><th>Grade</th><th>Questions</th><th>Fee</th><th>Pick</th></tr></thead><tbody>
          {pool.available.groups.map((g) => {
            const key = `${g.subject}|${g.grade}|${g.sponsor}`, most = Math.max(0, Math.min(pool.settings.pick_size, g.count, pool.today.remaining_today, pool.today.room_to_hold));
            const value = Math.min(counts[key] || most, most);
            return <tr key={key}>
              <td>{g.subject}{g.sponsor ? " (sponsor)" : ""}</td><td>{g.grade}</td><td>{g.count}</td><td>{feeText(g.fee)}</td>
              <td>{g.fee && most > 0
                ? <span><label className="qb-sr-only" htmlFor={`n-${key}`}>Number to pick</label>
                  <input id={`n-${key}`} type="number" min={1} max={most} value={value} onChange={(e) => setCounts((c) => ({ ...c, [key]: Math.max(1, Math.min(most, Number(e.target.value) || 1)) }))} style={{ width: "5rem" }}/>{" "}
                  <button className="qb-btn" disabled={busy} onClick={() => void pick(key, value, g.subject, g.grade)}>Pick {value}</button></span>
                : <span className="qb-muted">{!g.fee ? "No fee set" : pool.today.remaining_today === 0 ? "Daily limit reached" : "Queue full"}</span>}</td>
            </tr>;
          })}</tbody></table></div>}
      <h3>Questions you are holding</h3>
      {pool.mine.length === 0 ? <p className="qb-muted">You are not holding any questions. Pick some above.</p>
        : <div className="qb-table-wrap"><table className="qb-table"><thead><tr><th>Topic</th><th>Subject</th><th>Grade</th><th>Picked</th><th>Returns to pool</th><th/></tr></thead><tbody>
          {pool.mine.map((m) => <tr key={m.assignment_id}>
            <td>{m.topic ?? "—"}</td><td>{m.subject}</td><td>{m.grade}</td><td>{formatDateTime(m.assigned_at)}</td>
            <td>{m.return_at ? formatDateTime(m.return_at) : "—"}</td>
            <td><a className="qb-btn secondary" href="#review-queue">Open</a>{" "}<button className="qb-btn secondary" disabled={busy} onClick={() => void release(m.assignment_id)}>Return</button></td>
          </tr>)}</tbody></table></div>}
      <p className="qb-muted">Unfinished questions return to the pool after {pool.settings.release_hours} hours and are not paid. Returned questions are not offered to you again.</p>
    </>}
  </section>;
}
