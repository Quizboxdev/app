"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { myFamilySets, type MySet } from "@/lib/api/family";

// On a student's home: question sets their family gave them. Shown only when there are some.
export default function FamilySetsCard() {
  const [sets, setSets] = useState<MySet[]>([]);
  useEffect(() => { let live = true; myFamilySets().then((s) => { if (live) setSets(s ?? []); }).catch(() => undefined); return () => { live = false; }; }, []);
  if (!sets.length) return null;
  return (
    <section className="qb-card" aria-labelledby="family-sets-title" style={{ display: "grid", gap: 8 }}>
      <h2 id="family-sets-title" style={{ margin: 0 }}>Question sets from your family</h2>
      {sets.map((s) => (
        <div key={s.item_id} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span><strong>{s.title}</strong><span className="qb-muted"> · {s.subject} · from {s.from}{s.best !== null ? ` · best ${Math.round(Number(s.best))}%` : ""}</span></span>
          <Link className="qb-btn secondary" href={`/student/sets/${s.item_id}`}>Practise</Link>
        </div>
      ))}
    </section>
  );
}
