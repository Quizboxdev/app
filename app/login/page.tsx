"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";
import { userFacingError } from "@/lib/errors";
import { RESET_SUCCESS_MESSAGE } from "@/lib/auth-recovery";
import { listSignupCountries, type SignupCountry } from "@/lib/api/markets";
import { recordAuthFailure } from "@/lib/api/platform";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [countries, setCountries] = useState<SignupCountry[]>([]);
  const [countryCode, setCountryCode] = useState("");
  const [role, setRole] = useState("student");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("password_reset") === "success") setStatus(RESET_SUCCESS_MESSAGE);
    if (new URLSearchParams(window.location.search).get("suspended") === "1") setStatus(userFacingError(new Error("ACCOUNT_SUSPENDED")));
  }, []);
  useEffect(() => { if (mode === "register" && !countries.length) listSignupCountries().then(setCountries).catch(() => setCountries([])); }, [mode, countries.length]);
  const country = countries.find((c) => c.country_code === countryCode);

  async function routeAfterAuth() {
    try {
      const ctx = await bootstrapUser();
      router.replace(getHomeRouteForRole(String(ctx.role)));
    } catch (error) {
      if (error instanceof Error && error.message === "ONBOARDING_REQUIRED") { router.replace("/onboarding"); return; }
      throw error;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus("");

    try {
      const supabase = getSupabaseBrowserClient();

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) { void recordAuthFailure(error.code ?? "invalid_credentials"); throw error; }
        await routeAfterAuth();
        return;
      }

      if (!country?.available) throw new Error("QB_COUNTRY_NOT_AVAILABLE");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            country_code: countryCode,
            role,
          },
        },
      });
      if (error) throw error;

      if (!data.session) {
        setStatus(
          "Registration created. Complete email verification, then sign in."
        );
        setMode("login");
        return;
      }

      await routeAfterAuth();
    } catch (error: any) {
      setStatus(userFacingError(error));
    } finally { setBusy(false); }
  }

  return (
    <div className="qb-auth">
      <div className="qb-auth-card">
        <div className="qb-brand">QuizBox</div>
        <p className="qb-muted">Learn. Practice. Compete.</p>

        <form className="qb-form" onSubmit={submit}>
          {mode === "register" && (
            <div className="qb-field">
              <label htmlFor="auth-name">Full name</label>
              <input
                id="auth-name"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
          )}
          {mode === "register" && <div className="qb-field"><label htmlFor="auth-country">Country</label><select id="auth-country" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} required><option value="">Select your country</option>{countries.map((c) => <option key={c.country_code} value={c.country_code}>{c.country}</option>)}</select>{country && !country.available && <div className="qb-error" role="alert">QuizBox is not yet available in this country.</div>}</div>}
          {mode === "register" && <div className="qb-field"><label htmlFor="auth-role">I am a</label><select id="auth-role" value={role} onChange={(e) => setRole(e.target.value)} required><option value="student">Student</option><option value="teacher">Teacher</option><option value="sponsor">Sponsor / organization</option></select></div>}

          <div className="qb-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              autoComplete="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="qb-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {mode === "login" && <Link href="/auth/forgot-password">Forgot password?</Link>}
          {status && <div role="status" className={status === RESET_SUCCESS_MESSAGE ? "qb-muted" : "qb-error"}>{status}</div>}

          <button className="qb-btn" type="submit" disabled={busy || (mode === "register" && !country?.available)}>
            {mode === "login" ? "Sign in" : "Create account"}
          </button>

          <button
            className="qb-btn secondary"
            type="button"
            onClick={() => {
              setStatus("");
              setMode(mode === "login" ? "register" : "login");
            }}
          >
            {mode === "login"
              ? "Create a QuizBox account"
              : "I already have an account"}
          </button>
        </form>
      </div>
    </div>
  );
}
