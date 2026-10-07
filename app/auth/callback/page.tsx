"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";
import { browserRecoveryStorage, completeAuthCallback, recoveryFailureMessage, RESET_PASSWORD_PATH } from "@/lib/auth-recovery";

// Landing page for every Supabase email link. Recovery links continue to the new-password form; confirmation / magic links
// sign the user in and continue to onboarding or their workspace.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [failure, setFailure] = useState("");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const kind = await completeAuthCallback(new URL(window.location.href), browserRecoveryStorage);
      if (kind === "recovery") { router.replace(RESET_PASSWORD_PATH); return; }
      try { router.replace(getHomeRouteForRole(String((await bootstrapUser()).role))); }
      catch (error) {
        const code = error instanceof Error ? error.message : "";
        router.replace(code === "ACCOUNT_SUSPENDED" ? "/login?suspended=1" : code === "ONBOARDING_REQUIRED" ? "/onboarding" : "/login");
      }
    })().catch((cause) => setFailure(recoveryFailureMessage(cause).replace("password reset link", "email link").replace("reset email", "email")));
  }, [router]);
  return <AuthShell title={failure ? "This link can't be used" : "Signing you in"} subtitle={failure ? undefined : "Verifying your email link…"}>
    {failure
      ? <><p role="alert" className="qb-auth-alert is-error">{failure}</p>
          <div className="qb-auth-links"><Link href="/login">Go to sign in</Link><Link href="/auth/forgot-password">Reset password</Link></div></>
      : <div className="qb-auth-progress" role="status" aria-live="polite"><span className="qb-spinner" aria-hidden /> Please wait…</div>}
  </AuthShell>;
}
