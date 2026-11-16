"use client";

import { FormEvent, useState } from "react";
import { requestLink } from "@/lib/api/family";

// Link a child who already has a QuizBox account. The answer is always the same, so nobody can find out who has an account; the student must accept before anything is shared.
export default function LinkExistingForm({ onSent, onCancel }: { onSent: () => void; onCancel: () => void }) {
  const [email, setEmail] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError("");
    try { await requestLink(email); setSent(true); onSent(); } catch (cause) { setError((cause as Error).message); }
    setBusy(false);
  }
  if (sent) return (
    <section className="qb-card" role="status" style={{ display: "grid", gap: 8 }}>
      <h2 style={{ margin: 0 }}>Request sent</h2>
      <p style={{ margin: 0 }}>If an account exists with that email, the student will see your request when they next open QuizBox. You will see them here once they accept. We never say whether an account exists.</p>
      <button type="button" className="qb-btn secondary" style={{ justifySelf: "start" }} onClick={onCancel}>Done</button>
    </section>
  );
  return (
    <form className="qb-card qb-form" onSubmit={submit} aria-labelledby="link-title" style={{ display: "grid", gap: 12 }}>
      <h2 id="link-title" style={{ margin: 0 }}>Link an existing student</h2>
      <p className="qb-muted" style={{ margin: 0 }}>Type the email your child uses on QuizBox. They must accept before you can see anything about them.</p>
      <div className="qb-field"><label htmlFor="le-email">Their email</label><input id="le-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" /></div>
      {error && <div role="alert" className="qb-error">{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="qb-btn" type="submit" disabled={busy || !email.includes("@")}>{busy ? "Sending…" : "Send request"}</button>
        <button className="qb-btn secondary" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
