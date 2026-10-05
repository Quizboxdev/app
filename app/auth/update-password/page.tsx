"use client";

import Link from "next/link";
import BrandLockup from "@/components/BrandLockup";
import PasswordUpdateForm from "@/components/auth/PasswordUpdateForm";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENTS, browserRecoveryStorage, initializePasswordRecovery, recoveryErrorMessage, recoveryFailureMessage, recoveryFailureOf, RESET_SUCCESS_MESSAGE, updateRecoveryPassword, validateResetPasswords } from "@/lib/auth-recovery";

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
  return <div className="qb-auth"><div className="qb-auth-card">
    <BrandLockup variant="responsive" href="/" size={36} /><h1>Set a new password</h1>
    {checking ? <p role="status">Checking reset link...</p>
      : failure ? <><p role="alert" className="qb-error">{failure}</p><p><Link href="/auth/forgot-password">Request a new reset email</Link></p></>
      : success ? <><p role="status">{RESET_SUCCESS_MESSAGE}</p><p><Link href={success}>Continue to sign in</Link></p></>
      : <PasswordUpdateForm password={password} confirmation={confirmation} visible={visible} busy={busy} error={error} minLength={PASSWORD_MIN_LENGTH} requirements={PASSWORD_REQUIREMENTS} onPassword={setPassword} onConfirmation={setConfirmation} onToggleVisible={() => setVisible(value => !value)} onSubmit={submit} />}
  </div></div>;
}
