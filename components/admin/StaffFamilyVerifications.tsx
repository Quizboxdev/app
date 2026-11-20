"use client";

import { useEffect, useState } from "react";
import { decideStaffVerification, staffVerifications, type StaffVerification } from "@/lib/api/family";

// Staff queue: a sponsor asks to link to a school-managed or under-13 child who has no guardian linked. Staff approve or decline.
// Staff see the sponsor's name and email and the child's name, grade and school, and nothing else about the child.
export default function StaffFamilyVerifications() {
  const [rows, setRows] = useState<StaffVerification[] | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState("");
  useEffect(() => { let live = true; staffVerifications().then((r) => { if (live) setRows(r ?? []); }).catch(() => { if (live) setRows([]); }); return () => { live = false; }; }, []);
  async function decide(id: string, approve: boolean) {
    setBusy(id); setError("");
    try { await decideStaffVerification(id, approve); setRows((list) => (list ?? []).filter((x) => x.id !== id)); } catch (e) { setError((e as Error).message); }
    setBusy("");
  }
  if (rows === null) return null;
  return (
    <section className="qb-card" aria-labelledby="staff-family-title" style={{ display: "grid", gap: 10 }}>
      <h2 id="staff-family-title" style={{ margin: 0 }}>Sponsor links waiting for approval</h2>
      <p className="qb-muted qb-small" style={{ margin: 0 }}>These children have no parent or guardian linked. Approve only after checking the sponsor.</p>
      {rows.length === 0 ? <p style={{ margin: 0 }}>Nothing is waiting.</p> : rows.map((r) => (
        <div key={r.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <span><strong>{r.sponsor_name}</strong> ({r.sponsor_email ?? "no email"}) asked to link to <strong>{r.child_name}</strong>{r.child_grade ? `, ${r.child_grade}` : ""}{r.child_school ? `, ${r.child_school}` : ""}. Requested {new Date(r.created_at).toLocaleDateString("en-GB")}.</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="qb-btn" disabled={busy === r.id} onClick={() => void decide(r.id, true)}>Approve</button>
            <button type="button" className="qb-btn secondary" disabled={busy === r.id} onClick={() => void decide(r.id, false)}>Decline</button>
          </span>
        </div>
      ))}
      {error && <p className="qb-error" role="alert" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}
