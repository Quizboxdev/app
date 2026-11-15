"use client";

import Link from "next/link";
import AuthShell from "@/components/auth/AuthShell";
import { FormEvent, useEffect, useState } from "react";
import { recoveryErrorMessage, requestPasswordReset } from "@/lib/auth-recovery";
import { useTurnstile } from "@/components/auth/useTurnstile";
import { CAPTCHA_FAILED_MESSAGE, CAPTCHA_WAIT_MESSAGE } from "@/lib/auth/captcha";
import { browserCooldownStore, createResetEmailRequest, isResetEmailRateLimit, RESET_EMAIL_RATE_LIMIT, RESET_EMAIL_SENT, RESET_EMAIL_SPAM_HINT } from "@/lib/password-reset-request";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [request] = useState(() => createResetEmailRequest(Date.now, browserCooldownStore()));
  const [remaining, setRemaining] = useState(0);
  const captcha = useTurnstile();   // off (nothing shown) until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set
  useEffect(() => {
    setRemaining(request.remainingSeconds()); // a refresh keeps the wait that was already running
    const timer = window.setInterval(() => setRemaining(request.remainingSeconds()), 1000);
    return () => window.clearInterval(timer);
  }, [request]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || request.remainingSeconds() > 0) return;
    if (captcha.enabled && !captcha.token) { setError(captcha.failed ? CAPTCHA_FAILED_MESSAGE : CAPTCHA_WAIT_MESSAGE); return; }
    setBusy(true); setError("");
    try {
      if (await request.send(() => requestPasswordReset(email.trim().toLowerCase(), window.location.origin, undefined, captcha.token ?? undefined))) setSent(true);
    }
    catch (cause) { console.error("[auth] reset email", cause); setError(isResetEmailRateLimit(cause) ? RESET_EMAIL_RATE_LIMIT : recoveryErrorMessage(cause)); }
    finally { setRemaining(request.remainingSeconds()); setBusy(false); captcha.reset(); }   // a captcha token works once
  }
  return <AuthShell title="Reset password" subtitle="Enter your account email and we'll send you a secure link to set a new password." footer={<Link href="/login">← Back to sign in</Link>}>
    {sent && <p role="status" className="qb-auth-alert is-success">{RESET_EMAIL_SENT} The link opens a page where you choose your new password. {RESET_EMAIL_SPAM_HINT}</p>}
    {!sent && remaining > 0 && <p role="status" className="qb-auth-alert">You asked for a reset email a moment ago. {RESET_EMAIL_SPAM_HINT}</p>}
    <form className="qb-form" onSubmit={submit}>
      <div className="qb-field"><label htmlFor="reset-email">Email</label><input id="reset-email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></div>
      {captcha.widget}
      {error && <p className="qb-auth-alert is-error" role="alert">{error}</p>}
      <button className="qb-btn qb-btn-block" disabled={busy || remaining > 0} type="submit" aria-busy={busy}>{busy && <span className="qb-spinner" aria-hidden />}{busy ? "Sending…" : remaining > 0 ? `Resend in ${remaining}s` : sent ? "Send again" : "Send reset link"}</button>
    </form>
  </AuthShell>;
}
