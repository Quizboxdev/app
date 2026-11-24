"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startAttempt } from "@/lib/api/assessment";
import { myMockGrants, myMockPurchases, startGranted, startPurchased, type MockGrant, type MockPurchase } from "@/lib/api/mock-exams";
import { useSearchParams } from "next/navigation";
import { cedis, day, myPurchases, sourceLine, type Purchase } from "@/lib/api/marketplace";
import { confirmReturn } from "@/lib/api/payments";

// The question sets a person has bought. A set stays here for 90 days; the days left are shown. Paystack sends the buyer back to this page after paying, and the sale is recorded
// a moment later, so the page checks a few times before saying it is taking longer than usual.
function Mine() {
  const reference = useSearchParams().get("reference");
  const [rows, setRows] = useState<Purchase[] | null>(null), [error, setError] = useState(""), [waiting, setWaiting] = useState(!!reference), [slow, setSlow] = useState(false);
  const tries = useRef(0), before = useRef<number | null>(null);
  const [mocks, setMocks] = useState<MockPurchase[]>([]), [gifts, setGifts] = useState<MockGrant[]>([]), [starting, setStarting] = useState(""), router = useRouter();

  const load = useCallback(() => { myMockPurchases().then(setMocks).catch(() => setMocks([])); myMockGrants().then(setGifts).catch(() => setGifts([])); return myPurchases().then((r) => { setRows(r); return r; }).catch((e) => { setError(e.message); return null; }); }, []);
  // Back from paying: ask Paystack directly (in case the webhook is slow). If it says the payment is confirmed, the sale is recorded and there is nothing left to wait for.
  useEffect(() => { void (reference ? confirmReturn(reference).then((state) => { if (state === "confirmed") setWaiting(false); return load(); }) : load()); }, [load, reference]);
  useEffect(() => {
    if (!waiting || rows === null) return;
    if (before.current === null) before.current = rows.filter((r) => r.active).length;
    if (rows.filter((r) => r.active).length > before.current) { setWaiting(false); return; }
    if (tries.current >= 12) { setWaiting(false); setSlow(true); return; }
    const t = setTimeout(() => { tries.current += 1; void load(); }, 2500);
    return () => clearTimeout(t);
  }, [waiting, rows, load]);

  const mockItems = new Set(mocks.map((m) => m.item_id));
  const active = (rows ?? []).filter((r) => r.active && !mockItems.has(r.item_id)), past = (rows ?? []).filter((r) => !r.active && !mockItems.has(r.item_id));
  async function takeExam(m: MockPurchase) {
    setStarting(m.purchase_id); setError("");
    try { const s = await startPurchased(m.purchase_id); const a = await startAttempt({ assessmentId: s.assessment_id }); router.push(`/student/attempt/${a.attempt_id}`); } catch (e) { setError((e as Error).message); setStarting(""); }
  }
  async function takeGift(g: MockGrant) {
    setStarting(g.grant_id); setError("");
    try { const s = await startGranted(g.grant_id); const a = await startAttempt({ assessmentId: s.assessment_id }); router.push(`/student/attempt/${a.attempt_id}`); } catch (e) { setError((e as Error).message); setStarting(""); }
  }
  return (
    <>
      <div className="qb-page-head"><div><h1>My question sets</h1><p>Sets you have bought stay here for 90 days.</p></div><Link className="qb-btn" href="/marketplace">Browse the Marketplace</Link></div>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}
      {waiting && <div className="qb-card" role="status"><strong>Confirming your payment…</strong><p className="qb-muted" style={{ margin: 0 }}>This usually takes a few seconds. Your set will appear below.</p></div>}
      {slow && <div className="qb-card" role="status"><strong>Your payment is taking longer than usual to confirm.</strong><p className="qb-muted" style={{ margin: 0 }}>If you were charged, your set will appear here shortly. If it does not within an hour, <Link className="qb-link" href="/support/new">send us a request</Link> with your payment reference{reference ? ` (${reference})` : ""}.</p></div>}
      {!!(mocks.length + gifts.length) && <section className="qb-card" aria-label="My mock exams" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>My mock exams</h2>
        <div className="qb-grid cols-3">{gifts.map((g) => (
          <div key={g.grant_id} className="qb-card" style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <span className="qb-pill purple" style={{ justifySelf: "start" }}>{g.source === "family" ? "Given to you" : "Shared with you"} · version {g.version_no}</span>
            <h3 style={{ margin: 0 }}>{g.title}</h3>
            <p className="qb-small qb-muted" style={{ margin: 0 }}>From {g.from} · {g.question_count} questions · {g.time_limit_minutes} minutes · {g.attempts_used} of {g.attempts_allowed} {g.attempts_allowed === 1 ? "attempt" : "attempts"} used</p>
            {g.active ? <p className={g.days_left <= 7 ? "qb-error" : "qb-ok"} style={{ margin: 0 }}>{g.days_left} {g.days_left === 1 ? "day" : "days"} left (until {day(g.expires_at)})</p> : <p className="qb-muted" style={{ margin: 0 }}>{g.status === "revoked" ? "This exam was taken back." : `Ended ${day(g.expires_at)}.`}</p>}
            {g.last_attempt && g.last_attempt.state !== "in_progress" && <p className="qb-small" style={{ margin: 0 }}>Last result: {g.last_attempt.percent ?? "-"}% · <Link className="qb-link" href={`/student/results/${g.last_attempt.id}`}>See it</Link></p>}
            {g.active && (g.in_progress_attempt || g.attempts_used < g.attempts_allowed) && <button className="qb-btn" disabled={!!starting} onClick={() => void takeGift(g)}>{starting === g.grant_id ? "Opening…" : g.in_progress_attempt ? "Continue the exam" : "Start the exam"}</button>}
            {g.active && !g.in_progress_attempt && g.attempts_used >= g.attempts_allowed && <p className="qb-small qb-muted" style={{ margin: 0 }}>You have used all your attempts.</p>}
          </div>))}
        {mocks.map((m) => (
          <div key={m.purchase_id} className="qb-card" style={{ display: "grid", gap: 8, alignContent: "start" }}>
            <span className="qb-pill purple" style={{ justifySelf: "start" }}>Mock exam · version {m.version_no}</span>
            <h3 style={{ margin: 0 }}>{m.title}</h3>
            <p className="qb-small qb-muted" style={{ margin: 0 }}>{m.question_count} questions · {m.time_limit_minutes} minutes · {m.attempts_used} of {m.attempts_allowed} {m.attempts_allowed === 1 ? "attempt" : "attempts"} used</p>
            {m.active ? <p className={m.days_left <= 7 ? "qb-error" : "qb-ok"} style={{ margin: 0 }}>{m.days_left} {m.days_left === 1 ? "day" : "days"} left (until {day(m.expires_at)})</p> : <p className="qb-muted" style={{ margin: 0 }}>{m.status === "reversed" ? "Refunded: this exam is closed." : `Ended ${day(m.expires_at)}.`}</p>}
            {m.last_attempt && m.last_attempt.state !== "in_progress" && <p className="qb-small" style={{ margin: 0 }}>Last result: {m.last_attempt.percent ?? "-"}% · <Link className="qb-link" href={`/student/results/${m.last_attempt.id}`}>See it</Link></p>}
            {m.active && (m.in_progress_attempt || m.attempts_used < m.attempts_allowed) && <button className="qb-btn" disabled={!!starting} onClick={() => void takeExam(m)}>{starting === m.purchase_id ? "Opening…" : m.in_progress_attempt ? "Continue the exam" : "Start the exam"}</button>}
            {m.active && !m.in_progress_attempt && m.attempts_used >= m.attempts_allowed && <p className="qb-small qb-muted" style={{ margin: 0 }}>You have used all your attempts.</p>}
          </div>))}</div>
      </section>}
      {rows === null ? <div className="qb-card qb-muted">Loading…</div> :
        !active.length && !waiting && !mocks.length && !gifts.length ? <div className="qb-card qb-muted">You have no question sets yet. <Link className="qb-link" href="/marketplace">Browse the Marketplace</Link>.</div> :
        <div className="qb-grid cols-3">
          {active.map((p) => (
            <div key={p.item_id} className="qb-card" style={{ display: "grid", gap: 8, alignContent: "start" }}>
              <span className="qb-pill teal" style={{ justifySelf: "start" }}>{sourceLine(p)}</span>
              <h3 style={{ margin: 0 }}>{p.title}</h3>
              <p className="qb-small qb-muted" style={{ margin: 0 }}>Bought {day(p.purchased_at)} · {cedis(p.price_minor)}</p>
              <p className={p.days_left <= 7 ? "qb-error" : "qb-ok"} style={{ margin: 0 }}>{p.days_left} {p.days_left === 1 ? "day" : "days"} left (until {day(p.expires_at)})</p>
              <Link className="qb-btn" href={`/marketplace/mine/${p.item_id}`}>Practise this set</Link>
            </div>
          ))}
        </div>}
      {!!past.length && <section className="qb-card" style={{ marginTop: 16 }}>
        <h3>Ended</h3>
        <ul className="qb-list">{past.map((p) => <li key={p.item_id + p.purchased_at}>{p.title} · {sourceLine(p)} · {p.status === "reversed" ? "refunded" : `ended ${day(p.expires_at)}`}{p.slug && p.status !== "reversed" ? <> · <Link className="qb-link" href={`/marketplace/${p.slug}`}>Buy again</Link></> : null}</li>)}</ul>
      </section>}
    </>
  );
}
export default function MinePage() { return <Suspense fallback={<div className="qb-card qb-muted">Loading…</div>}><Mine /></Suspense>; }
