"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cedis, listFamilyOrders, listFamilyWallets, startFamilyOrder, unitPriceMinor, type FamilyOrder, type FamilyWallet } from "@/lib/api/family";
import ChildChoiceTable, { type Picks } from "@/components/family/ChildChoiceTable";

// Coins and wallet: each child's balance, and buy Coins for the children you tick. The packages are per child; "Same for everyone" fills them all in one go, and each child can still be changed.
// One payment covers every ticked child and each child's own wallet is credited, or none is. Coins appear only after the payment is confirmed.
const PACKS = [5, 10, 20, 50, 100];
const STATE: Record<FamilyOrder["status"], string> = { initiated: "Waiting for payment", paid: "Paid", fulfilled: "Paid", failed: "Not paid", refunded: "Refunded", mismatch: "Needs checking" };

export default function FamilyWalletPage() {
  const [wallets, setWallets] = useState<FamilyWallet[] | null>(null), [orders, setOrders] = useState<FamilyOrder[]>([]), [unit, setUnit] = useState(0);
  const [picks, setPicks] = useState<Picks>({}), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    listFamilyWallets().then(setWallets).catch((e: Error) => { setWallets([]); setError(e.message); });
    listFamilyOrders().then((o) => setOrders(o.filter((x) => x.kind === "coins"))).catch(() => undefined);
    unitPriceMinor().then(setUnit).catch(() => setUnit(0));
  }, []);

  const buyable = (wallets ?? []).filter((w) => w.can_buy_coins);
  const lines = useMemo(() => buyable.filter((w) => picks[w.student_id] !== undefined).map((w) => ({ w, coins: Number(picks[w.student_id]) })), [buyable, picks]);
  const totalCoins = lines.reduce((n, l) => n + l.coins, 0), total = totalCoins * unit;

  async function pay() {
    setBusy(true); setError("");
    try { const r = await startFamilyOrder("coins", lines.map((l) => ({ studentId: l.w.student_id, coins: l.coins }))); window.location.assign(r.url); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  if (wallets === null) return <div className="qb-card qb-skeleton" style={{ minHeight: 160 }} aria-busy="true" aria-label="Loading" />;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p style={{ margin: 0 }}><Link className="qb-link" href="/family">&larr; My family</Link></p>
      <header><h1 style={{ margin: 0 }}>Coins and wallet</h1><p className="qb-muted" style={{ margin: "4px 0 0" }}>Each child has their own Coins. Buy for one child, a few, or everyone.</p></header>
      {error && <div className="qb-card qb-error" role="alert">{error}</div>}

      <section aria-labelledby="w-bal"><h2 id="w-bal" style={{ margin: "0 0 8px" }}>Balances</h2>
        {!wallets.length ? <div className="qb-card qb-empty"><strong>No children yet</strong>Add a child first.</div>
          : <div className="qb-grid cols-3">{wallets.map((w) => <div key={w.student_id} className="qb-card" style={{ display: "grid", gap: 2 }}><strong>{w.name}</strong><span style={{ fontSize: 26, fontWeight: 700 }}>{Number(w.coins).toLocaleString("en-GB")}</span><span className="qb-muted qb-small">Coins{w.plan ? ` · ${w.plan.replace(/^plan_/, "")} plan` : ""}</span></div>)}</div>}
      </section>

      {buyable.length > 0 && <section className="qb-card" aria-labelledby="w-buy" style={{ display: "grid", gap: 12 }}>
        <h2 id="w-buy" style={{ margin: 0 }}>Buy Coins</h2>
        {!unit && <p className="qb-muted" role="status">Online payment is not open yet. Please check back soon.</p>}
        <ChildChoiceTable legend="Who are you buying for?" rows={buyable.map((w) => ({ id: w.student_id, name: w.name }))} picks={picks} onChange={setPicks} choiceLabel="Coins" bulkLabel="Same amount for everyone"
          choices={PACKS.map((c) => ({ value: String(c), label: `${c} Coins`, cost: unit ? cedis(c * unit) : undefined }))} />
        {lines.length > 0 && <div className="qb-card" style={{ display: "grid", gap: 4 }} role="status" aria-label="Payment summary">
          {lines.map((l) => <div key={l.w.student_id} style={{ display: "flex", justifyContent: "space-between" }}><span>{l.w.name}</span><span>{l.coins} Coins{unit ? ` · ${cedis(l.coins * unit)}` : ""}</span></div>)}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line, #e2e8f0)", paddingTop: 6, fontWeight: 700 }}><span>Total: {totalCoins} Coins</span><span>{unit ? cedis(total) : ""}</span></div>
        </div>}
        <button className="qb-btn" style={{ justifySelf: "start" }} disabled={busy || !lines.length || !unit} onClick={() => void pay()}>{busy ? "Opening payment…" : lines.length ? `Pay ${unit ? cedis(total) : ""} for ${lines.length} ${lines.length === 1 ? "child" : "children"}` : "Pay"}</button>
        <p className="qb-muted qb-small" style={{ margin: 0 }}>You pay once. Each child&apos;s Coins are added to their own wallet after the payment is confirmed. The smallest amount for one child is 5 Coins.</p>
      </section>}

      <section aria-labelledby="w-hist"><h2 id="w-hist" style={{ margin: "0 0 8px" }}>Your Coin purchases</h2>
        {!orders.length ? <div className="qb-card qb-empty"><strong>Nothing yet</strong>Purchases appear here with what each child received.</div>
          : <div style={{ display: "grid", gap: 8 }}>{orders.map((o) => <div key={o.reference} className="qb-card" style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}><strong>{cedis(o.total_minor)}</strong><span className="qb-muted qb-small">{new Date(o.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {STATE[o.status]}</span></div>
            <span className="qb-muted qb-small">{o.items.map((i) => `${i.name}: ${i.coins}`).join(" · ")}</span></div>)}</div>}
      </section>
    </div>
  );
}
