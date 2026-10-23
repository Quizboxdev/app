"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import BrandBanner from "@/components/BrandBanner";
import { getMyAccess, type MyAccess } from "@/lib/api/access";
import { getCatalog, startCheckout, type Catalog } from "@/lib/api/payments";
import { PLANS, planPriceMinor } from "@/lib/payments/plans";
import PricingCards from "@/components/pricing/PricingCards";
import { listPrices } from "@/lib/api/pricing";
import type { PriceRow } from "@/lib/pricing/format";
import { formatDate } from "@/lib/format";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const cedis = (minor: number) => `GHS ${(minor / 100).toFixed(2)}`;

function SubscribeInner() {
  const params = useSearchParams();
  const reason = params.get("reason"), returned = params.get("reference");
  const [access, setAccess] = useState<MyAccess | null>(null), [catalog, setCatalog] = useState<Catalog | null>(null);
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [errorCode, setErrorCode] = useState(""), [waited, setWaited] = useState(0);
  const [isMinor, setIsMinor] = useState(false);
  const polls = useRef(0);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  useEffect(() => { listPrices().then(setPrices).catch(() => setPrices([])); }, []);

  useEffect(() => { void getMyAccess().then(setAccess); void getCatalog().then(setCatalog);
    void getSupabaseBrowserClient().auth.getUser().then(async ({ data }) => { if (!data.user) return; const r = await getSupabaseBrowserClient().from("student_profiles").select("is_minor").eq("user_id", data.user.id).maybeSingle(); setIsMinor(!!(r.data as { is_minor?: boolean } | null)?.is_minor); }); }, []);
  // Coming back from the payment page: the provider confirms to our server a moment later, so check a few times before saying anything.
  useEffect(() => {
    if (!returned || access?.subscribed) return;
    const t = setInterval(async () => { polls.current += 1; setWaited(polls.current); const a = await getMyAccess(); setAccess(a); if (a.subscribed || polls.current >= 12) clearInterval(t); }, 5000);
    return () => clearInterval(t);
  }, [returned, access?.subscribed]);

  // A failed attempt is shown where the buyer is looking: the message is scrolled into view, with a short support code to quote.
  useEffect(() => { if (error) document.getElementById("pay-error")?.scrollIntoView({ behavior: "smooth", block: "center" }); }, [error, errorCode]);
  async function pay(planId: string) {
    setBusy(planId); setError(""); setErrorCode("");
    try { const { url } = await startCheckout(planId); window.location.assign(url); } catch (e: any) { setError(e?.message ?? "We could not start the payment."); setErrorCode(typeof e?.code === "string" ? e.code : ""); setBusy(""); }
  }
  const open = !!catalog?.payments_enabled && !isMinor;
  // Prices come from the admin price list; while a learner plan has no price there but the older Coins price exists, that price is shown so buying keeps working.
  const learnerCards = prices.filter((r) => r.audience === "learner").map((r) => { const plan = PLANS.find((p) => p.id === r.code); const old = plan ? planPriceMinor(plan, catalog?.unit_price_minor) : null; return r.price_minor === null && old !== null && open ? { ...r, price_minor: old } : r; });

  return (
    <>
      <BrandBanner src="/brand/pages/subscribe-hero.webp" />
      <div className="qb-page-head"><div>
        <h1>{returned ? "Thank you" : reason === "free_used" || access?.exhausted ? "You have used your free practice" : "Subscribe to QuizBox"}</h1>
        <p>{returned ? "We are confirming your payment." : reason === "free_used" || access?.exhausted
          ? "Well done on the practice so far. Subscribe to keep building your own practice sessions with no limit."
          : "Unlimited practice across all subjects for your grade."}</p>
      </div></div>

      {error && <div id="pay-error" className="qb-card qb-error" role="alert">{error}{errorCode && <span className="qb-muted qb-small" style={{ display: "block", marginTop: 4 }}>Support code: {errorCode}</span>}</div>}
      {access?.subscribed && <div className="qb-card" role="status"><strong>You are subscribed{(access as any).subscription_until ? ` until ${formatDate((access as any).subscription_until)}` : ""}.</strong> <Link href="/practise">Go to Practise</Link></div>}
      {returned && !access?.subscribed && <div className="qb-card" role="status">{waited >= 12
        ? "We have not received confirmation yet. If you were charged, do not pay again: your subscription is activated as soon as the payment is confirmed, and you can contact us with your payment reference."
        : "Waiting for your payment to be confirmed. This usually takes under a minute."} <span className="qb-muted qb-small">Reference {returned}</span></div>}

      {!(open && PLANS.some((p) => planPriceMinor(p, catalog?.unit_price_minor) !== null)) && <div className="qb-card" role="note">Prices are being finalised. Nothing is charged today.</div>}
      {learnerCards.length > 0 ? <PricingCards rows={learnerCards} onPay={(r) => void pay(r.code)} payable={(r) => open && !!r.coins && !!r.days} busy={busy} /> :
      <div className="qb-grid cols-3">
        {PLANS.map((p) => {
          const price = planPriceMinor(p, catalog?.unit_price_minor);
          const online = open && price !== null;
          return (
            <section className="qb-card" key={p.id} aria-labelledby={`plan-${p.id}`}>
              <span className="qb-pill">{p.audience}</span>
              <h3 id={`plan-${p.id}`} style={{ marginTop: 12 }}>{p.name}</h3>
              <p style={{ fontSize: 22, fontWeight: 800, margin: "6px 0" }}>
                {price !== null && open ? <>{cedis(price)} <span className="qb-muted" style={{ fontSize: 14 }}>/ {p.period}</span></> : <span className="qb-muted" style={{ fontSize: 15, fontWeight: 600 }}>Price to be announced</span>}
              </p>
              <ul className="qb-task-list">{p.includes.map((i) => <li key={i}><Check size={14} aria-hidden="true" /> {i}</li>)}</ul>
              {online && <button className="qb-btn" style={{ marginTop: 10 }} disabled={!!busy} onClick={() => void pay(p.id)}>{busy === p.id ? "Opening payment…" : "Pay with mobile money or card"}</button>}
            </section>
          );
        })}
      </div>}

      <section className="qb-card" style={{ marginTop: 16 }}>
        <h2>{isMinor ? "Ask your teacher or a parent" : open ? "Need help paying?" : "How to subscribe"}</h2>
        <p className="qb-muted">{isMinor ? "A subscription is arranged by your school or a parent. Ask your teacher." : open ? "Mobile money and cards are accepted. If a payment goes through but your subscription does not appear within a few minutes, contact us with your reference." : "Online payment is being switched on. Until then, contact us and we will activate your subscription."}</p>
        <Link className="qb-btn secondary" href="/contact">Contact QuizBox</Link>{" "}
        <Link className="qb-btn secondary" href="/practise">Back to Practise</Link>
      </section>
    </>
  );
}

export default function SubscribePage() { return <Suspense fallback={null}><SubscribeInner /></Suspense>; }
