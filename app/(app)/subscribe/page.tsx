"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import BrandBanner from "@/components/BrandBanner";
import { getMyAccess, type MyAccess } from "@/lib/api/access";
import plansFile from "../../../config/subscription-plans.json";

type Plan = { id: string; name: string; audience: string; period: string; price: number | null; includes: string[] };

function SubscribeInner() {
  const reason = useSearchParams().get("reason");
  const [access, setAccess] = useState<MyAccess | null>(null);
  useEffect(() => { getMyAccess().then(setAccess); }, []);
  const plans = plansFile.plans as Plan[];

  return (
    <>
      <BrandBanner src="/brand/pages/subscribe-hero.webp" />
      <div className="qb-page-head"><div>
        <h1>{reason === "free_used" || access?.exhausted ? "You have used your free practice" : "Subscribe to QuizBox"}</h1>
        <p>{reason === "free_used" || access?.exhausted
          ? "Well done on the practice so far. Subscribe to keep building your own practice sessions with no limit."
          : "Unlimited practice across all subjects for your grade."}</p>
      </div></div>

      {access?.subscribed && <div className="qb-card" role="status"><strong>You are subscribed.</strong> <Link href="/practise">Go to Practise</Link></div>}

      <div className="qb-grid cols-3">
        {plans.map((p) => (
          <section className="qb-card" key={p.id} aria-labelledby={`plan-${p.id}`}>
            <span className="qb-pill">{p.audience}</span>
            <h3 id={`plan-${p.id}`} style={{ marginTop: 12 }}>{p.name}</h3>
            <p style={{ fontSize: 22, fontWeight: 800, margin: "6px 0" }}>
              {p.price === null ? <span className="qb-muted" style={{ fontSize: 15, fontWeight: 600 }}>Price to be announced</span> : <>{plansFile.currency} {p.price.toFixed(2)} <span className="qb-muted" style={{ fontSize: 14 }}>/ {p.period}</span></>}
            </p>
            <ul className="qb-task-list">{p.includes.map((i) => <li key={i}><Check size={14} aria-hidden="true" /> {i}</li>)}</ul>
          </section>
        ))}
      </div>

      <section className="qb-card" style={{ marginTop: 16 }}>
        <h2>How to subscribe</h2>
        <p className="qb-muted">Online payment is being switched on. Until then, contact us and we will activate your subscription.</p>
        <Link className="qb-btn" href="/contact">Contact QuizBox</Link>{" "}
        <Link className="qb-btn secondary" href="/practise">Back to Practise</Link>
      </section>
    </>
  );
}

export default function SubscribePage() { return <Suspense fallback={null}><SubscribeInner /></Suspense>; }
