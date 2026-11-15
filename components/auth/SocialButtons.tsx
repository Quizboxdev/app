"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { rememberNext } from "@/lib/auth/next-path";
import { enabledSocialProviders, SOCIAL_FAILED_MESSAGE, socialRedirectUrl, type SocialProvider } from "@/lib/auth/social";

// "Continue with Google / Facebook / LinkedIn / Apple" buttons. Renders nothing unless NEXT_PUBLIC_SOCIAL_PROVIDERS lists a provider.
// The provider sends the person back to /auth/callback, which signs them in and then sends a new person through onboarding (country and role).
const PROVIDERS = enabledSocialProviders(process.env.NEXT_PUBLIC_SOCIAL_PROVIDERS);

export default function SocialButtons({ disabled, onError }: { disabled?: boolean; onError: (message: string) => void }) {
  const [starting, setStarting] = useState<SocialProvider | null>(null);
  if (!PROVIDERS.length) return null;

  async function start(provider: SocialProvider) {
    if (starting) return;
    setStarting(provider);
    try {
      rememberNext(new URLSearchParams(window.location.search).get("next"));   // a shared link survives the round trip, as it does for email sign-up
      const { error } = await getSupabaseBrowserClient().auth.signInWithOAuth({ provider, options: { redirectTo: socialRedirectUrl(window.location.origin) } });
      if (error) throw error;   // on success the browser leaves for the provider
    } catch (cause) {
      console.error("[auth] social", provider, cause);
      onError(SOCIAL_FAILED_MESSAGE);
      setStarting(null);
    }
  }

  return (
    <div className="qb-oauth">
      <p className="qb-oauth-or">or</p>
      {PROVIDERS.map((p) => (
        <button key={p.id} type="button" className="qb-btn qb-btn-secondary qb-btn-block" disabled={disabled || starting !== null} aria-busy={starting === p.id} onClick={() => void start(p.id)}>
          {starting === p.id ? "Opening…" : `Continue with ${p.label}`}
        </button>
      ))}
    </div>
  );
}
