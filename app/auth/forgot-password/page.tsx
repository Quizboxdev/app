"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { recoveryErrorMessage, requestPasswordReset } from "@/lib/auth-recovery";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try { await requestPasswordReset(email, window.location.origin); setSent(true); }
    catch (cause) { setError(recoveryErrorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <div className="qb-auth"><div className="qb-auth-card">
    <div className="qb-brand">QuizBox</div><h1>Reset password</h1>
    {sent ? <p role="status">If an account exists for this email, a password reset email has been sent.</p> : <form className="qb-form" onSubmit={submit}>
      <div className="qb-field"><label htmlFor="reset-email">Email</label><input id="reset-email" type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/></div>
      {error && <p className="qb-error" role="alert">{error}</p>}
      <button className="qb-btn" disabled={busy} type="submit">{busy ? "Sending..." : "Send reset email"}</button>
    </form>}
    <p><Link href="/login">Back to sign in</Link></p>
  </div></div>;
}
