"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";
import { userFacingError } from "@/lib/errors";
import { authErrorMessage } from "@/lib/auth-errors";
import { AUTH_CALLBACK_PATH, RESET_SUCCESS_MESSAGE } from "@/lib/auth-recovery";
import { listSignupCountries, type SignupCountry } from "@/lib/api/markets";
import { recordAuthFailure } from "@/lib/api/platform";
import type { RegistrationParams } from "@/lib/public/registration-params";
import AuthShell from "@/components/auth/AuthShell";
import PasswordField from "@/components/auth/PasswordField";

type Notice = { kind: "error" | "success" | "info"; text: string } | null;

// Initial values come from parseRegistrationParams() on the server and are already validated;
// the country is applied only if it is also present in the live signup market list.
export default function LoginForm({ initial }: { initial: RegistrationParams }) {
  const [mode, setMode] = useState<"login" | "register">(initial.mode);
  const [fullName, setFullName] = useState("");
  const [countries, setCountries] = useState<SignupCountry[]>([]);
  const [countriesFailed, setCountriesFailed] = useState(false);
  const [countryCode, setCountryCode] = useState("");
  const [role, setRole] = useState<string>(initial.role ?? "student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("password_reset") === "success") setNotice({ kind: "success", text: RESET_SUCCESS_MESSAGE });
    if (params.get("suspended") === "1") setNotice({ kind: "error", text: userFacingError(new Error("ACCOUNT_SUSPENDED")) });
  }, []);
  useEffect(() => {
    if (mode !== "register" || countries.length) return;
    listSignupCountries().then((list) => { setCountries(list); setCountriesFailed(false); }).catch(() => setCountriesFailed(true));
  }, [mode, countries.length]);
  useEffect(() => {
    if (initial.country && countries.some((c) => c.country_code === initial.country)) setCountryCode((current) => current || initial.country!);
  }, [countries, initial.country]);
  const country = countries.find((c) => c.country_code === countryCode);
  const smeIntent = initial.intent === "sme" && role === "teacher";

  // Authentication succeeded; anything failing here is about loading the account, not the credentials.
  async function routeAfterAuth() {
    try {
      const ctx = await bootstrapUser();
      router.replace(getHomeRouteForRole(String(ctx.role)));
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "ONBOARDING_REQUIRED") { router.replace("/onboarding"); return; }
      if (code === "ACCOUNT_SUSPENDED") throw error;
      console.error("[auth] signed in but the account could not be loaded", error);
      throw new Error(`ACCOUNT_LOAD_FAILED:${userFacingError(error).startsWith("The operation") ? authErrorMessage(error) : userFacingError(error)}`);
    }
  }

  function switchMode(next: "login" | "register") { setNotice(null); setMode(next); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const supabase = getSupabaseBrowserClient();
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) { void recordAuthFailure(error.code ?? "invalid_credentials"); throw error; }
        await routeAfterAuth();
        return;
      }
      if (!country?.available) throw new Error("QB_COUNTRY_NOT_AVAILABLE");
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: new URL(AUTH_CALLBACK_PATH, window.location.origin).href,
          data: { full_name: fullName.trim(), country_code: countryCode, role, ...(smeIntent ? { sme_intent: true } : {}) },
        },
      });
      if (error) throw error;
      // Supabase returns a user with no identities when the email is already registered (enumeration protection).
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        setNotice({ kind: "info", text: "An account with this email may already exist. Sign in, or reset your password." });
        setMode("login");
        return;
      }
      if (!data.session) {
        setNotice({ kind: "success", text: `Check ${normalizedEmail} for a confirmation link, then sign in.` });
        setMode("login");
        return;
      }
      await routeAfterAuth();
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith("ACCOUNT_LOAD_FAILED:")
        ? `You're signed in, but your account could not be loaded: ${error.message.slice("ACCOUNT_LOAD_FAILED:".length)}`
        : authErrorMessage(error);
      if (!(error instanceof Error && error.message.startsWith("ACCOUNT_LOAD_FAILED:"))) console.error("[auth]", mode, error);
      setNotice({ kind: "error", text: message });
    } finally { setBusy(false); }
  }

  const register = mode === "register";
  return (
    <AuthShell
      title={register ? "Create your QuizBox account" : "Welcome back"}
      subtitle={register ? "Start learning, teaching or sponsoring in minutes." : "Sign in to continue to QuizBox."}
      footer={<span>By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</span>}
    >
      <div className="qb-segmented" role="tablist" aria-label="Account">
        <button type="button" role="tab" aria-selected={!register} className={!register ? "is-active" : ""} onClick={() => switchMode("login")}>Sign in</button>
        <button type="button" role="tab" aria-selected={register} className={register ? "is-active" : ""} onClick={() => switchMode("register")}>Create account</button>
      </div>
      {register && smeIntent && <p className="qb-auth-alert is-info">After you create your teacher account, you can apply to review content as a subject-matter expert during setup. Applications require approval.</p>}

      <form className="qb-form" onSubmit={submit}>
        {register && (
          <div className="qb-field">
            <label htmlFor="auth-name">Full name</label>
            <input id="auth-name" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required disabled={busy} />
          </div>
        )}
        {register && (
          <div className="qb-field">
            <label htmlFor="auth-country">Country</label>
            <select id="auth-country" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} required disabled={busy}>
              <option value="">{countries.length ? "Select your country" : countriesFailed ? "Countries unavailable — retry" : "Loading countries…"}</option>
              {countries.map((c) => <option key={c.country_code} value={c.country_code}>{c.country}</option>)}
            </select>
            {countriesFailed && <button type="button" className="qb-link-btn" onClick={() => { setCountriesFailed(false); setCountries([]); listSignupCountries().then(setCountries).catch(() => setCountriesFailed(true)); }}>Retry loading countries</button>}
            {country && !country.available && <div className="qb-error" role="alert">QuizBox is not yet available in this country.</div>}
          </div>
        )}
        {register && (
          <div className="qb-field">
            <label htmlFor="auth-role">I am a</label>
            <select id="auth-role" value={role} onChange={(e) => setRole(e.target.value)} required disabled={busy}>
              <option value="student">Student</option><option value="teacher">Teacher</option><option value="sponsor">Sponsor / organization</option>
            </select>
          </div>
        )}

        <div className="qb-field">
          <label htmlFor="auth-email">Email</label>
          <input id="auth-email" autoComplete="email" inputMode="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={busy} />
        </div>
        <PasswordField id="auth-password" label="Password" autoComplete={register ? "new-password" : "current-password"} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required disabled={busy} />
        {!register && <div className="qb-auth-row"><Link href="/auth/forgot-password">Forgot password?</Link></div>}
        {register && <p className="qb-auth-hint">At least 8 characters. Avoid passwords you use elsewhere.</p>}

        {notice && <div role={notice.kind === "error" ? "alert" : "status"} className={`qb-auth-alert is-${notice.kind}`}>{notice.text}</div>}

        <button className="qb-btn qb-btn-block" type="submit" disabled={busy || (register && !country?.available)} aria-busy={busy}>
          {busy && <span className="qb-spinner" aria-hidden />}
          {busy ? (register ? "Creating account…" : "Signing in…") : register ? "Create account" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}
