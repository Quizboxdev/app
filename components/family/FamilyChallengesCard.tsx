"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { myFamilyChallenges, type MyFamilyChallenge } from "@/lib/api/family";

// On a student's home: challenges their family invited them to. Shown only when there are some. A private challenge shows its access code, which is typed on the play page.
export default function FamilyChallengesCard() {
  const [rows, setRows] = useState<MyFamilyChallenge[]>([]);
  useEffect(() => { let live = true; myFamilyChallenges().then((r) => { if (live) setRows(r ?? []); }).catch(() => undefined); return () => { live = false; }; }, []);
  if (!rows.length) return null;
  return (
    <section className="qb-card" aria-labelledby="family-challenges-title" style={{ display: "grid", gap: 8 }}>
      <h2 id="family-challenges-title" style={{ margin: 0 }}>Challenges from your family</h2>
      {rows.map((c) => (
        <div key={c.campaign_id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span><strong>{c.title}</strong><span className="qb-muted"> · from {c.from}{c.ends_at ? ` · ends ${new Date(c.ends_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span>{c.access_code ? <span className="qb-small" style={{ display: "block" }}>Access code: <strong>{c.access_code}</strong></span> : null}</span>
          <Link className="qb-btn secondary" href={`/play/${c.slug}`}>Play</Link>
        </div>
      ))}
    </section>
  );
}
