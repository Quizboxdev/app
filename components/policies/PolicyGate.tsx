"use client";

import { useEffect, useState, type ReactNode } from "react";
import { policyAccept, policyPending, type PendingPolicy } from "@/lib/api/policies";
import { signOut } from "@/lib/auth";

// After sign-up, and again after a material change, a person reads and accepts each required policy before using QuizBox. The record (who, which version, when) is kept by the database.
// If the policy section is not installed yet, or nothing is published, or the check fails, the page simply loads: this screen is a consent step, never a reason to lock someone out by mistake.
// The documents open in a new tab, so a person can read them and come back to this screen.
export default function PolicyGate({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingPolicy[] | null>(null), [agreed, setAgreed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { let alive = true; policyPending().then((p) => { if (alive) setPending(p); }).catch(() => { if (alive) setPending([]); }); return () => { alive = false; }; }, []);
  if (pending === null || pending.length === 0) return <>{children}</>;
  const changed = pending.some((p) => p.version_no > 1 && p.summary);
  async function accept() {
    setBusy(true); setError("");
    try { await policyAccept(pending!.map((p) => p.version_id)); setPending([]); } catch (e: any) { setError(e.message); setBusy(false); }
  }
  return (
    <section className="qb-card" role="dialog" aria-modal="false" aria-labelledby="policy-gate-title" style={{ maxWidth: 680, margin: "24px auto", display: "grid", gap: 12 }}>
      <h1 id="policy-gate-title" style={{ margin: 0 }}>{changed ? "We have updated our policies" : "Before you start"}</h1>
      <p className="qb-muted" style={{ margin: 0 }}>{changed ? "Please read what changed and accept to continue." : "Please read these documents. You need to accept them to use QuizBox."}</p>
      <ul className="qb-list" style={{ margin: 0 }}>
        {pending.map((p) => (
          <li key={p.version_id}>
            <a className="qb-link" href={`/${p.slug}`} target="_blank" rel="noopener noreferrer"><strong>{p.title}</strong> (opens in a new tab)</a>
            {p.version_no > 1 && p.summary ? <span className="qb-muted qb-small" style={{ display: "block" }}>What changed: {p.summary}</span> : null}
          </li>
        ))}
      </ul>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 4 }} />
        <span>I have read and accept the {pending.map((p) => p.title).join(" and the ")}.</span>
      </label>
      {error && <div className="qb-error" role="alert">{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="qb-btn" disabled={!agreed || busy} onClick={() => void accept()}>{busy ? "Saving…" : "I accept"}</button>
        <button className="qb-btn ghost" onClick={async () => { await signOut(); window.location.assign("/login"); }}>Sign out</button>
        <a className="qb-btn secondary" href="/contact" target="_blank" rel="noopener noreferrer">I have a question</a>
      </div>
      <p className="qb-muted qb-small" style={{ margin: 0 }}>QuizBox Solutions, Ghana. We record that you accepted, which version, and when.</p>
    </section>
  );
}
