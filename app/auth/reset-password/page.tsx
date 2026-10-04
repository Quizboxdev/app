"use client";

import Link from "next/link";
import BrandLockup from "@/components/BrandLockup";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { browserRecoveryStorage, initializePasswordRecovery, INVALID_RESET_MESSAGE, recoveryErrorMessage, RESET_SUCCESS_MESSAGE, updateRecoveryPassword, validateResetPasswords } from "@/lib/auth-recovery";

export default function ResetPasswordPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const recovery = useRef<Promise<string> | null>(null);
  const router = useRouter();
  useEffect(() => {
    let active = true;
    recovery.current ??= initializePasswordRecovery(new URL(window.location.href), browserRecoveryStorage, () => new URL(window.location.href));
    void recovery.current.then(id=>{if(active)setUserId(id);}).catch(()=>{if(active)setInvalid(true);}).finally(()=>{if(active)setChecking(false);});
    return () => { active = false; };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !userId) return;
    const validation = validateResetPasswords(password, confirmation);
    if (validation) { setError(validation); return; }
    setBusy(true); setError("");
    try {
      const destination = await updateRecoveryPassword(password, confirmation, userId, browserRecoveryStorage);
      setPassword(""); setConfirmation(""); setSuccess(true);
      router.replace(destination);
    } catch (cause) {
      const message = recoveryErrorMessage(cause);
      if (message === INVALID_RESET_MESSAGE) setInvalid(true); else setError(message);
    } finally { setBusy(false); }
  }
  return <div className="qb-auth"><div className="qb-auth-card">
    <BrandLockup variant="responsive" href="/" size={36} /><h1>Set a new password</h1>
    {checking ? <p role="status">Checking reset link...</p> : invalid ? <><p role="alert" className="qb-error">{INVALID_RESET_MESSAGE}</p><Link href="/auth/forgot-password">Request a new reset email</Link></> : success ? <p role="status">{RESET_SUCCESS_MESSAGE}</p> : <form className="qb-form" onSubmit={submit}>
      <div className="qb-field"><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={password} onChange={event=>setPassword(event.target.value)}/></div>
      <div className="qb-field"><label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></div>
      {error && <p role="alert" className="qb-error">{error}</p>}
      <button type="submit" className="qb-btn" disabled={busy || !userId}>{busy ? "Updating..." : "Update password"}</button>
    </form>}
  </div></div>;
}
