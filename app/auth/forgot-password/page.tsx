"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { recoveryErrorMessage, requestPasswordReset } from "@/lib/auth-recovery";
import { createResetEmailRequest, isResetEmailRateLimit, RESET_EMAIL_RATE_LIMIT, RESET_EMAIL_SENT } from "@/lib/password-reset-request";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [request] = useState(() => createResetEmailRequest());
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(request.remainingSeconds()), 1000);
    return () => window.clearInterval(timer);
  }, [request]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || request.remainingSeconds() > 0) return;
    setBusy(true); setError("");
    try {
      if (await request.send(() => requestPasswordReset(email, window.location.origin))) setSent(true);
    }
    catch (cause) { setError(isResetEmailRateLimit(cause) ? RESET_EMAIL_RATE_LIMIT : recoveryErrorMessage(cause)); }
    finally { setRemaining(request.remainingSeconds()); setBusy(false); }
  }
  return <div className="qb-auth"><div className="qb-auth-card">
    <div className="qb-brand">QuizBox</div><h1>Reset password</h1>
    {sent && <p role="status">{RESET_EMAIL_SENT}</p>}
    <form className="qb-form" onSubmit={submit}>
      <div className="qb-field"><label htmlFor="reset-email">Email</label><input id="reset-email" type="email" autoComplete="email" required value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/></div>
      {error && <p className="qb-error" role="alert">{error}</p>}
      <button className="qb-btn" disabled={busy || remaining > 0} type="submit">{busy ? "Sending..." : remaining > 0 ? `Resend in ${remaining}s` : "Send reset email"}</button>
    </form>
    <p><Link href="/login">Back to sign in</Link></p>
  </div></div>;
}
