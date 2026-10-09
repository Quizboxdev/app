"use client";

import Link from "next/link";
import AuthShell from "@/components/auth/AuthShell";
import PasswordUpdateForm from "@/components/auth/PasswordUpdateForm";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { passwordChecks, PASSWORD_REQUIREMENTS, browserRecoveryStorage, initializePasswordRecovery, recoveryErrorMessage, recoveryFailureMessage, recoveryFailureOf, RESET_SUCCESS_MESSAGE, updateRecoveryPassword, validateResetPasswords } from "@/lib/auth-recovery";

// Canonical password-recovery screen. A valid recovery session (the PASSWORD_RECOVERY event for this link, or the same verified
// user resuming after a refresh) is required before the form appears; anything else shows why the link cannot be used.
export default function UpdatePasswordPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [failure, setFailure] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const recovery = useRef<Promise<string> | null>(null);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    recovery.current ??= initializePasswordRecovery(new URL(window.location.href), browserRecoveryStorage, () => new URL(window.location.href));
    void recovery.current.then(id => { if (active) setUserId(id); }).catch(cause => { if (active) setFailure(recoveryFailureMessage(cause)); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!success) return;
    const timer = window.setTimeout(() => router.replace(success), 1500);
    return () => window.clearTimeout(timer);
  }, [success, router]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !userId) return;
    const validation = validateResetPasswords(password, confirmation);
    if (validation) { setError(validation); return; }
    setBusy(true); setError("");
    try {
      const destination = await updateRecoveryPassword(password, confirmation, userId, browserRecoveryStorage);
      setPassword(""); setConfirmation(""); setSuccess(destination);
    } catch (cause) {
      if (recoveryFailureOf(cause)) setFailure(recoveryErrorMessage(cause)); else setError(recoveryErrorMessage(cause));
    } finally { setBusy(false); }
  }
  return <AuthShell title="Set a new password" subtitle={checking || failure || success ? undefined : "Choose a strong password you don't use anywhere else."} footer={<Link href="/login">← Back to sign in</Link>}>
    {checking ? <div className="qb-auth-progress" role="status" aria-live="polite"><span className="qb-spinner" aria-hidden /> Checking reset link…</div>
      : failure ? <><p role="alert" className="qb-auth-alert is-error">{failure}</p><Link className="qb-btn qb-btn-block" href="/auth/forgot-password">Request a new reset email</Link></>
      : success ? <><p role="status" className="qb-auth-alert is-success">{RESET_SUCCESS_MESSAGE}</p><Link className="qb-btn qb-btn-block" href={success}>Continue to sign in</Link></>
      : <PasswordUpdateForm password={password} confirmation={confirmation} visible={visible} busy={busy} error={error} requirements={PASSWORD_REQUIREMENTS} met={passwordChecks(password, confirmation)} onPassword={setPassword} onConfirmation={setConfirmation} onToggleVisible={() => setVisible(value => !value)} onSubmit={submit} />}
  </AuthShell>;
}
