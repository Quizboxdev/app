"use client";

import { useEffect, useState } from "react";
import { answerGuardianRequest, guardianRequests, type GuardianRequest } from "@/lib/api/family";

// Shown to a parent or guardian when a sponsor asks to link to one of their children who has a school-managed or under-13 account.
// The child never sees this request. Nothing is shared with the sponsor until the guardian says yes.
export default function GuardianRequestsCard() {
  const [rows, setRows] = useState<GuardianRequest[]>([]), [busy, setBusy] = useState(""), [error, setError] = useState("");
  useEffect(() => { let live = true; guardianRequests().then((r) => { if (live) setRows(r ?? []); }).catch(() => undefined); return () => { live = false; }; }, []);
  if (!rows.length) return null;
  async function answer(r: GuardianRequest, accept: boolean) {
    setBusy(r.id); setError("");
    try { await answerGuardianRequest(r.id, accept); setRows((list) => list.filter((x) => x.id !== r.id)); } catch (e) { setError((e as Error).message); }
    setBusy("");
  }
  return (
    <section className="qb-card" aria-labelledby="guardian-requests-title" style={{ display: "grid", gap: 10 }}>
      <h2 id="guardian-requests-title" style={{ margin: 0 }}>A sponsor wants to support one of your children</h2>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <span><strong>{r.sponsor_name}</strong> asked to be linked to <strong>{r.child_name}</strong>{r.child_grade ? ` (${r.child_grade})` : ""} as a sponsor. They would see subject and topic progress and could buy Coins or a subscription for your child. They cannot give work.</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="qb-btn" disabled={busy === r.id} onClick={() => void answer(r, true)}>Accept</button>
            <button type="button" className="qb-btn secondary" disabled={busy === r.id} onClick={() => void answer(r, false)}>Decline</button>
          </span>
        </div>
      ))}
      {error && <p className="qb-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}
