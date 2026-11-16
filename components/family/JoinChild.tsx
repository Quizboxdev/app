"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import BrandLockup from "@/components/BrandLockup";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

// The page a child opens from their single-use link: they choose a password, then sign in the normal way with their username. The link never signs anyone in.
type State = { kind: "checking" } | { kind: "invalid" } | { kind: "form"; firstName: string } | { kind: "done"; username: string };

export default function JoinChild({ token }: { token: string }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [password, setPassword] = useState(""), [again, setAgain] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/family/activate?token=${encodeURIComponent(token)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => { if (live) setState(d.valid ? { kind: "form", firstName: d.firstName ?? "" } : { kind: "invalid" }); }).catch(() => { if (live) setState({ kind: "invalid" }); });
    return () => { live = false; };
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (password !== again) { setError("The two passwords are not the same."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/family/activate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) { setError(typeof out.error === "string" ? out.error : "Something went wrong. Please try again."); if (res.status === 400 && /already been used|not valid/.test(String(out.error))) setState({ kind: "invalid" }); }
      else setState({ kind: "done", username: out.username });
    } catch { setError("Something went wrong. Please try again."); }
    setBusy(false);
  }

  return (
    <div className="qb-auth">
      <div className="qb-auth-card">
        <BrandLockup variant="responsive" href="/" size={36} />
        {state.kind === "checking" && <p className="qb-muted" role="status">Checking your link…</p>}
        {state.kind === "invalid" && <>
          <h1 style={{ fontSize: "1.25rem" }}>This link cannot be used</h1>
          <p className="qb-muted">It has already been used, has expired, or was replaced by a newer one. Ask your parent to send you a new link.</p>
          <Link className="qb-btn secondary" href="/login">Go to sign in</Link>
        </>}
        {state.kind === "form" && <form className="qb-form" onSubmit={submit}>
          <h1 style={{ fontSize: "1.25rem", margin: "8px 0 0" }}>{state.firstName ? `Welcome, ${state.firstName}` : "Welcome to QuizBox"}</h1>
          <p className="qb-muted" style={{ margin: 0 }}>Choose a password to open your QuizBox workspace. Keep it to yourself.</p>
          <div className="qb-field"><label htmlFor="jc-pass">New password</label><input id="jc-pass" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <div className="qb-field"><label htmlFor="jc-again">Type it again</label><input id="jc-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></div>
          <p className="qb-muted qb-small" style={{ margin: 0 }}>Use at least {PASSWORD_MIN_LENGTH} characters. Two short words work well, like &quot;mango cat&quot;.</p>
          {error && <div role="alert" className="qb-error">{error}</div>}
          <button className="qb-btn" type="submit" disabled={busy || password.length < PASSWORD_MIN_LENGTH}>{busy ? "Saving…" : "Save my password"}</button>
        </form>}
        {state.kind === "done" && <>
          <h1 style={{ fontSize: "1.25rem", margin: "8px 0 0" }}>You are all set</h1>
          <p>Your username is <strong>{state.username}</strong>. Use it with your new password to sign in.</p>
          <Link className="qb-btn" href="/login">Go to sign in</Link>
        </>}
      </div>
    </div>
  );
}
