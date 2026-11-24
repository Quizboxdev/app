"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getMyWallet } from "@/lib/api/core";
import { confirmReturn, startTopup } from "@/lib/api/payments";
import { addLinkSeats, closeLink, createLink, shareLinks, type Exam, type LinkList, type ShareLink } from "@/lib/api/mock-exams";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatDateTime } from "@/lib/format";
import { linkCost, linkUrl, MIN_TOPUP, PLACE_TIERS, shortfall, topupAmount } from "@/lib/mock-exams/links";

// Share the exam by link for a number of places the sponsor pays for in Coins (1 Coin per place), for example for an alumni group, a church or a company. People sign in with a learner account to join; each join takes one place.
// Nothing is charged until the button is pressed. If the wallet is short the sponsor buys exactly what is missing (the smallest online payment is 5 Coins), comes back here and finishes.
export default function LinkPanel({ exam, disabled }: { exam: Exam; disabled: boolean }) {
  const [info, setInfo] = useState<LinkList | null>(null), [balance, setBalance] = useState<number | null>(null), [seats, setSeats] = useState(""), [closes, setCloses] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [done, setDone] = useState(""), [copied, setCopied] = useState(""), [topup, setTopup] = useState<string | null>(null), [waited, setWaited] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const [i, u] = await Promise.all([shareLinks(exam.id), getSupabaseBrowserClient().auth.getUser()]);
      setInfo(i);
      const w = u.data.user ? await getMyWallet(u.data.user.id).catch(() => null) : null;
      setBalance(w ? Number(w.purchased_balance) + Number(w.promotional_balance) : 0);
    } catch (e) { setError((e as Error).message); setInfo({ enabled: false, eligible: false, coins_per_seat: 1, max_seats: 1000, access_days: 90, links: [] }); }
  }, [exam.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setTopup(new URLSearchParams(window.location.search).get("topup")); }, []);
  // Back from paying for Coins: the provider confirms to our server a moment later, so look a few times.
  useEffect(() => {
    if (!topup) return;
    let n = 0; void confirmReturn(topup).then(() => refresh());
    const t = setInterval(() => { n += 1; setWaited(n); void refresh(); if (n >= 12) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [topup, refresh]);

  if (!info) return <div className="qb-card qb-muted" role="status">Loading…</div>;
  if (!info.enabled || !info.eligible) return null;
  const per = info.coins_per_seat, n = Number(seats), valid = Number.isInteger(n) && n >= 1 && n <= info.max_seats, cost = valid ? linkCost(n, 0, per) : 0;
  const missing = valid && balance !== null ? shortfall(cost, balance) : 0, buy = topupAmount(missing);
  const closesIso = closes ? new Date(`${closes}T23:59:59`).toISOString() : null, closesOk = !closes || new Date(closesIso as string).getTime() > Date.now();

  async function pay(fn: () => Promise<unknown>, ok: string) { setBusy("pay"); setError(""); setDone(""); try { await fn(); setDone(ok); setSeats(""); await refresh(); } catch (e) { setError((e as Error).message); } setBusy(""); }
  async function topUp() {
    setBusy("topup"); setError("");
    try { const { url } = await startTopup(buy, `/mock-exams/${exam.id}`); window.location.assign(url); } catch (e) { setError((e as Error).message); setBusy(""); }
  }
  async function copy(l: ShareLink) { try { await navigator.clipboard.writeText(linkUrl(window.location.origin, l.code)); setCopied(l.id); } catch { setError("Copy did not work. Select the link and copy it by hand."); } }

  return (
    <section className="qb-card qb-form" aria-label="Share by link">
      <h2 style={{ margin: 0 }}>Share by link with places you pay for</h2>
      <p className="qb-muted qb-small" style={{ margin: 0 }}>For a group outside your family: an alumni group, a church, a company. Each person signs in with a learner account and opens the link; each one takes a place. You pay <strong>{per} Coin per place</strong> (1 Coin = GHS 1) from your Coins, up front. They get their own private copy of version {exam.current_version_no} for {info.access_days} days. Places that are not used are not refunded. You see results as Joiner 1, 2, 3 with no names.</p>
      {error && <p className="qb-error" role="alert">{error}</p>}{done && <p className="qb-ok" role="status">{done}</p>}
      {topup && <div className="qb-card" role="status">{waited < 12 ? "Thank you. We are confirming your payment. Your Coins appear here within a minute." : "We have not received confirmation yet. If you were charged, do not pay again: your Coins are added as soon as the payment is confirmed."}</div>}
      <div role="radiogroup" aria-label="How many places" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PLACE_TIERS.filter((t) => t <= info.max_seats).map((t) => <button key={t} type="button" role="radio" aria-checked={n === t} className={`qb-btn ${n === t ? "" : "secondary"}`} onClick={() => setSeats(String(t))} disabled={disabled}>{t} places</button>)}
      </div>
      <div className="qb-grid cols-3">
        <div className="qb-field"><label htmlFor="lk-seats">Or choose your own number (1 to {info.max_seats})</label><input id="lk-seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 35" disabled={disabled} /></div>
        <div className="qb-field"><label htmlFor="lk-close">Closes (optional, within a year; otherwise 90 days)</label><input id="lk-close" type="date" value={closes} onChange={(e) => setCloses(e.target.value)} disabled={disabled} /></div>
      </div>
      {valid && <div className="qb-card" role="status"><p style={{ margin: 0 }}><strong>{n} places = {cost} Coins = GHS {cost}</strong>. You have <strong>{balance ?? "…"} Coins</strong>.</p>
        {missing > 0 && <p style={{ margin: "6px 0 0" }}>You need {missing} more Coin{missing === 1 ? "" : "s"}. The smallest online payment is {MIN_TOPUP} Coins, so we will ask you to pay for <strong>{buy} Coins (GHS {buy})</strong> with mobile money or card, then bring you back here.</p>}</div>}
      <div>{valid && missing > 0 ? <button className="qb-btn" disabled={!!busy || disabled || !closesOk} onClick={() => void topUp()}>{busy === "topup" ? "Opening payment…" : `Pay GHS ${buy} for ${buy} Coins`}</button>
        : <button className="qb-btn" disabled={!!busy || disabled || !valid || !closesOk} onClick={() => void pay(() => createLink(exam.id, n, closesIso), `Your link is ready for ${n} ${n === 1 ? "person" : "people"}.`)}>{busy === "pay" ? "Creating…" : valid ? `Use ${cost} Coins and create the link` : "Choose how many places"}</button>}</div>
      {!!info.links.length && <><h3 style={{ margin: "8px 0 0" }}>Your links</h3>
        <ul className="qb-list" style={{ display: "grid", gap: 12 }}>{info.links.map((l) => <LinkRow key={l.id} l={l} per={per} max={info.max_seats} balance={balance} busy={!!busy} copied={copied === l.id} onCopy={() => void copy(l)}
          onAdd={(total) => void pay(() => addLinkSeats(l.id, total), `Places added: this link now has ${total}.`)} onClose={() => { if (window.confirm("Close this link? Nobody new can join. Places not used are not refunded. People who already joined keep their exam.")) void pay(() => closeLink(l.id), "The link is closed."); }} />)}</ul></>}
      <p className="qb-small qb-muted" style={{ margin: 0 }}>Need to know how paying works? <Link className="qb-link" href="/guides/subscribe-and-coins">Read the guide</Link>.</p>
    </section>
  );
}

function LinkRow({ l, per, max, balance, busy, copied, onCopy, onAdd, onClose }: { l: ShareLink; per: number; max: number; balance: number | null; busy: boolean; copied: boolean; onCopy: () => void; onAdd: (total: number) => void; onClose: () => void }) {
  const [more, setMore] = useState("");
  const total = l.seats_paid + Number(more || 0), valid = Number(more) >= 1 && total <= max, cost = valid ? linkCost(total, l.coins_paid, per) : 0, short = valid && balance !== null && cost > balance;
  const state = l.status === "open" ? (l.joined >= l.seats_paid ? "Full" : "Open") : l.status === "closed" ? "Closed" : "Ended";
  return (
    <li className="qb-card" style={{ display: "grid", gap: 6 }}>
      <p style={{ margin: 0 }}><strong>{l.joined} of {l.seats_paid}</strong> places used · {state} · closes {formatDateTime(l.closes_at)} · version {l.version_no}{l.behind_current ? " (a newer version exists; this link still serves this one)" : ""}</p>
      <p className="qb-small" style={{ margin: 0, wordBreak: "break-all" }}>{typeof window !== "undefined" ? linkUrl(window.location.origin, l.code) : l.path}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="qb-btn secondary" onClick={onCopy}>{copied ? "Copied" : "Copy the link"}</button>
        {l.status === "open" && <>
          <input aria-label="Places to add" inputMode="numeric" style={{ width: 90 }} value={more} onChange={(e) => setMore(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="Add places" />
          <button type="button" className="qb-btn secondary" disabled={busy || !valid || short} onClick={() => onAdd(total)}>{valid ? `Add ${Number(more)} for ${cost} Coins` : "Add places"}</button>
          <button type="button" className="qb-link-btn" disabled={busy} onClick={onClose}>Close the link</button></>}
      </div>
      {short && <p className="qb-error qb-small" style={{ margin: 0 }}>You need {shortfall(cost, balance ?? 0)} more Coins to add these.</p>}
    </li>
  );
}
