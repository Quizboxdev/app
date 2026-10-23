"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getMyWallet } from "@/lib/api/core";
import { startTopup } from "@/lib/api/payments";
import { buySeats, MAX_SEATS, MIN_SEATS, SEAT_TIERS, seatCost, seatsInfo, shortfall, topupAmount, type SeatsInfo } from "@/lib/api/seats";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// "People" tab of a quiz: how many have joined, how many places there are, and a way to add more. A quiz is free for a few players; a bundle is 1 Coin per player, paid from your Coins.
// If you do not have enough Coins, you buy exactly what is missing (the smallest online payment is 5), come back here, and finish. Nothing is charged until you press the button.
export default function SeatsPanel({ id, noun, onError }: { id: string; noun: string; onError: (m: string) => void }) {
  const params = useSearchParams(), topup = params.get("topup");
  const [info, setInfo] = useState<SeatsInfo | null>(null), [balance, setBalance] = useState<number | null>(null), [target, setTarget] = useState<number>(0), [custom, setCustom] = useState(""), [busy, setBusy] = useState(""), [done, setDone] = useState(""), [waited, setWaited] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const [i, u] = await Promise.all([seatsInfo(id), getSupabaseBrowserClient().auth.getUser()]);
      setInfo(i);
      const w = u.data.user ? await getMyWallet(u.data.user.id).catch(() => null) : null;
      setBalance(w ? Number(w.purchased_balance) + Number(w.promotional_balance) : 0);
    } catch (e: any) { onError(e.message); }
  }, [id, onError]);
  useEffect(() => { void refresh(); }, [refresh]);
  // Coming back from paying for Coins: the provider confirms to our server a moment later, so look a few times.
  useEffect(() => {
    if (!topup) return;
    let n = 0; const t = setInterval(() => { n += 1; setWaited(n); void refresh(); if (n >= 12) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [topup, refresh]);

  if (!info) return <div className="qb-card"><p className="qb-muted">Loading…</p></div>;
  if (info.class_targeted) return <div className="qb-card"><h2>People</h2><p>This {noun} is for one class or school, so there is no limit on players and nothing to pay. {info.joined} joined so far.</p></div>;
  if (!info.enabled) return <div className="qb-card"><h2>People</h2><p>{info.joined} joined so far. Limits on the number of players are not switched on yet, so there is no limit and nothing to pay.</p></div>;

  const paid = info.seats_paid, cap = info.seat_cap ?? info.free_seats, tiers = SEAT_TIERS.filter((t) => t > paid);
  const chosen = custom.trim() ? Number(custom) : target;
  const valid = Number.isInteger(chosen) && chosen >= MIN_SEATS && chosen <= MAX_SEATS && chosen > paid;
  const cost = valid ? seatCost(chosen, paid) : 0, missing = valid && balance !== null ? shortfall(cost, balance) : 0, buy = topupAmount(missing);
  async function pay() {
    setBusy("pay"); onError(""); setDone("");
    try { await buySeats(id, chosen); setDone(`Done. This ${noun} now has places for ${chosen} players.`); setTarget(0); setCustom(""); await refresh(); } catch (e: any) { onError(e.message); }
    setBusy("");
  }
  async function topUp() {
    setBusy("topup"); onError("");
    try { const { url } = await startTopup(buy, `/creator/${id}`); window.location.assign(url); } catch (e: any) { onError(e.message); setBusy(""); }
  }
  return (
    <div className="qb-card qb-form">
      <h2>People</h2>
      <p><strong>{info.joined} of {cap}</strong> places used. {paid === 0 ? `The first ${info.free_seats} players are free.` : `You have paid for ${paid} players.`} When all places are used, new people are told the {noun} is full; people already in keep their place.</p>
      {topup && <div className="qb-card" role="status">{waited < 12 ? "Thank you. We are confirming your payment. Your Coins appear here within a minute." : "We have not received confirmation yet. If you were charged, do not pay again: your Coins are added as soon as the payment is confirmed."}</div>}
      {done && <div className="qb-card" role="status"><strong>{done}</strong></div>}
      <p className="qb-muted">Add places: <strong>1 Coin per player</strong> (1 Coin = GHS 1). {paid > 0 ? "You pay only for the extra places. " : ""}You also get full access to QuizBox while the {noun} runs, for up to 90 days. You have <strong>{balance ?? "…"} Coins</strong>. <Link className="qb-link" href="/guides/subscribe-and-coins">How Coins work</Link></p>
      <div role="radiogroup" aria-label="How many players" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tiers.map((t) => <button key={t} type="button" role="radio" aria-checked={!custom.trim() && target === t} className={`qb-btn ${!custom.trim() && target === t ? "" : "qb-btn-secondary"}`} onClick={() => { setTarget(t); setCustom(""); }}>{t} players</button>)}
      </div>
      <label className="qb-field" style={{ maxWidth: 260 }}>Or choose your own number ({MIN_SEATS} to {MAX_SEATS})<input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="e.g. 35" /></label>
      {valid && (
        <div className="qb-card" role="status">
          <p style={{ margin: 0 }}><strong>{chosen} players = {cost} Coins = GHS {cost}</strong>{paid > 0 ? ` (${chosen - paid} more than you have paid for)` : ""}.</p>
          {missing > 0 ? <p style={{ margin: "6px 0 0" }}>You need {missing} more Coin{missing === 1 ? "" : "s"}. The smallest online payment is 5 Coins, so we will ask you to pay for <strong>{buy} Coins (GHS {buy})</strong> with mobile money or card, then bring you back here.</p> : null}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {valid && missing > 0
          ? <button className="qb-btn" disabled={!!busy} onClick={() => void topUp()}>{busy === "topup" ? "Opening payment…" : `Pay GHS ${buy} for ${buy} Coins`}</button>
          : <button className="qb-btn" disabled={!valid || !!busy} onClick={() => void pay()}>{busy === "pay" ? "Adding places…" : valid ? `Use ${cost} Coins for ${chosen} players` : "Choose how many players"}</button>}
      </div>
    </div>
  );
}
