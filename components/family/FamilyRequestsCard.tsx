"use client";

import { useEffect, useState } from "react";
import { answerLinkRequest, myLinkRequests, type LinkRequest } from "@/lib/api/family";

// Shown on a student's home only when a parent has asked to link to their account. Nothing is shared with the parent until the student says yes.
export default function FamilyRequestsCard() {
  const [rows, setRows] = useState<LinkRequest[]>([]), [busy, setBusy] = useState(""), [error, setError] = useState("");
  useEffect(() => { let live = true; myLinkRequests().then((r) => { if (live) setRows(r ?? []); }).catch(() => undefined); return () => { live = false; }; }, []);
  if (!rows.length) return null;
  async function answer(r: LinkRequest, accept: boolean) {
    setBusy(r.id); setError("");
    try { await answerLinkRequest(r.id, accept); setRows((list) => list.filter((x) => x.id !== r.id)); } catch (e) { setError((e as Error).message); }
    setBusy("");
  }
  return (
    <section className="qb-card" aria-labelledby="family-requests-title" style={{ display: "grid", gap: 10 }}>
      <h2 id="family-requests-title" style={{ margin: 0 }}>Someone wants to link to your account</h2>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <span><strong>{r.parent_name}</strong> asked to be linked as your parent. They would see your progress and could give you work and buy coins for you.</span>
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
