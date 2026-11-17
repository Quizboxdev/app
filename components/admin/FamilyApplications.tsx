"use client";

import { useEffect, useState } from "react";
import { decideFamilyApplication, pendingFamilyApplications, type PendingApplication } from "@/lib/api/family";

// Alumni sponsors' applications to create a family. QuizBox staff see every application; a school administrator sees those for their own school.
// Renders nothing for anyone with nothing waiting, so it can sit on both the staff and the school pages.
export default function FamilyApplications() {
  const [rows, setRows] = useState<PendingApplication[]>([]), [busy, setBusy] = useState(""), [error, setError] = useState(""), [note, setNote] = useState<Record<string, string>>({});
  useEffect(() => { let live = true; pendingFamilyApplications().then((r) => { if (live) setRows(r ?? []); }).catch(() => undefined); return () => { live = false; }; }, []);
  async function decide(id: string, approve: boolean) {
    setBusy(id); setError("");
    try { await decideFamilyApplication(id, approve, note[id]); setRows((list) => list.filter((x) => x.id !== id)); } catch (e) { setError((e as Error).message); }
    setBusy("");
  }
  if (!rows.length) return null;
  return (
    <section className="qb-card" aria-labelledby="family-applications-title" style={{ display: "grid", gap: 12 }}>
      <h2 id="family-applications-title" style={{ margin: 0 }}>Alumni applications to create a family</h2>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "grid", gap: 6, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 10 }}>
          <span><strong>{r.applicant_name}</strong> ({r.applicant_email ?? "no email"}) for <strong>{r.school_name}</strong>{r.matched_school ? "" : " (school not matched: staff only)"}</span>
          <span className="qb-muted qb-small"><strong>Connection:</strong> {r.alumni_note}</span>
          <span className="qb-muted qb-small"><strong>Who they want to support:</strong> {r.intended_students}</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input aria-label={`Note for ${r.applicant_name}`} placeholder="Note (optional)" maxLength={500} value={note[r.id] ?? ""} onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))} style={{ flex: "1 1 240px" }} />
            <button type="button" className="qb-btn" disabled={busy === r.id} onClick={() => void decide(r.id, true)}>Approve</button>
            <button type="button" className="qb-btn secondary" disabled={busy === r.id} onClick={() => void decide(r.id, false)}>Decline</button>
          </div>
        </div>
      ))}
      {error && <p className="qb-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}
