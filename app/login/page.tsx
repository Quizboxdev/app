"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";
import { userFacingError } from "@/lib/errors";
import { RESET_SUCCESS_MESSAGE } from "@/lib/auth-recovery";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [grade, setGrade] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("password_reset") === "success") setStatus(RESET_SUCCESS_MESSAGE);
  }, []);

  async function routeAfterAuth() {
    const ctx = await bootstrapUser();
    router.replace(getHomeRouteForRole(String(ctx.role)));
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
        if (error) throw error;
        await routeAfterAuth();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            grade,
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
          {mode === "register" && <div className="qb-field"><label htmlFor="auth-grade">Grade</label><select id="auth-grade" value={grade} onChange={(e) => setGrade(e.target.value)} required><option value="">Select grade</option>{["B4","B5","B6","B7","B8","B9","SHS1","SHS2","SHS3"].map((value) => <option key={value}>{value}</option>)}</select></div>}

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

          <button className="qb-btn" type="submit" disabled={busy}>
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
