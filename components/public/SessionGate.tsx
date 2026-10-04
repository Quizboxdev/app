"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { bootstrapUser, getHomeRouteForRole } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Rendered only when the request carries a Supabase session cookie. The cookie is a hint, not
// proof: bootstrapUser() verifies the session exactly as before, then routes by role. Until that
// resolves the homepage is not shown, so signed-in users never see it flash. A stale or invalid
// session falls back to the public homepage (children).
// After the session is confirmed invalid, remove any leftover Supabase auth cookies (for example
// from a previous project ref) so later visits render the homepage directly instead of re-checking.
function clearStaleAuthCookies() {
  for (const part of document.cookie.split(";")) {
    const name = part.split("=")[0]?.trim();
    if (name && /^sb-.+-auth-token(\.\d+)?$/.test(name)) document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  }
}

export default function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [anonymous, setAnonymous] = useState(false);

  useEffect(() => {
    let active = true;
    bootstrapUser()
      .then((ctx) => router.replace(getHomeRouteForRole(String(ctx.role))))
      .catch(async (error: unknown) => {
        const code = error instanceof Error ? error.message : "";
        if (code === "ONBOARDING_REQUIRED") { router.replace("/onboarding"); return; }
        if (code === "ACCOUNT_SUSPENDED") { router.replace("/login?suspended=1"); return; }
        if (code === "AUTH_REQUIRED") {
          await getSupabaseBrowserClient().auth.signOut({ scope: "local" }).catch(() => undefined);
          clearStaleAuthCookies();
        }
        if (active) setAnonymous(true);
      });
    return () => { active = false; };
  }, [router]);

  if (anonymous) return <>{children}</>;
  return <div className="qbp-session" role="status" aria-live="polite">Opening QuizBox…</div>;
}
