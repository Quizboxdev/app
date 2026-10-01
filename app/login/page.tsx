"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const router = useRouter();

  async function routeAfterAuth() {
    const ctx = await bootstrapUser();
    router.replace(getHomeRouteForRole(String(ctx.role)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
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
      setStatus(error?.message ?? "Authentication failed.");
    }
  }

  return (
    <div className="qb-auth">
      <div className="qb-auth-card">
        <div className="qb-brand">QuizBox</div>
        <p className="qb-muted">Learn. Practice. Compete.</p>

        <form className="qb-form" onSubmit={submit}>
          {mode === "register" && (
            <div className="qb-field">
              <label>Full name</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="qb-field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="qb-field">
            <label>Password</label>
            <input
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {status && <div className="qb-error">{status}</div>}

          <button className="qb-btn" type="submit">
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
