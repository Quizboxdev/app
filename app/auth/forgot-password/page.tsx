"use client";

import Link from "next/link";
import AuthShell from "@/components/auth/AuthShell";
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
      if (await request.send(() => requestPasswordReset(email.trim().toLowerCase(), window.location.origin))) setSent(true);
    }
    catch (cause) { console.error("[auth] reset email", cause); setError(isResetEmailRateLimit(cause) ? RESET_EMAIL_RATE_LIMIT : recoveryErrorMessage(cause)); }
    finally { setRemaining(request.remainingSeconds()); setBusy(false); }
  }
  return <AuthShell title="Reset password" subtitle="Enter your account email and we'll send you a secure link to set a new password." footer={<Link href="/login">← Back to sign in</Link>}>
    {sent && <p role="status" className="qb-auth-alert is-success">{RESET_EMAIL_SENT} The link opens a page where you choose your new password.</p>}
    <form className="qb-form" onSubmit={submit}>
      <div className="qb-field"><label htmlFor="reset-email">Email</label><input id="reset-email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></div>
      {error && <p className="qb-auth-alert is-error" role="alert">{error}</p>}
      <button className="qb-btn qb-btn-block" disabled={busy || remaining > 0} type="submit" aria-busy={busy}>{busy && <span className="qb-spinner" aria-hidden />}{busy ? "Sending…" : remaining > 0 ? `Resend in ${remaining}s` : sent ? "Send again" : "Send reset link"}</button>
    </form>
  </AuthShell>;
}
