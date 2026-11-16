// Social sign-in (Google, Facebook, LinkedIn, Apple/iCloud) through Supabase Auth. A button shows only for providers listed in NEXT_PUBLIC_SOCIAL_PROVIDERS,
// so each can be turned on the day its Supabase provider is configured, and with the variable empty the login screen is exactly as before.
import { AUTH_CALLBACK_PATH } from "@/lib/auth-links";

export type SocialProvider = "google" | "facebook" | "linkedin_oidc" | "apple";
export const SOCIAL_PROVIDERS: { id: SocialProvider; label: string; aliases: string[] }[] = [
  { id: "google", label: "Google", aliases: ["google"] },
  { id: "facebook", label: "Facebook", aliases: ["facebook"] },
  { id: "linkedin_oidc", label: "LinkedIn", aliases: ["linkedin", "linkedin_oidc"] },
  { id: "apple", label: "Apple (iCloud)", aliases: ["apple", "icloud"] },
];

// "google, LinkedIn,icloud" -> Google, LinkedIn, Apple, always in the fixed order above; unknown or repeated names are ignored.
export function enabledSocialProviders(list: string | undefined): { id: SocialProvider; label: string }[] {
  const wanted = new Set((list ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  return SOCIAL_PROVIDERS.filter((p) => p.aliases.some((a) => wanted.has(a))).map(({ id, label }) => ({ id, label }));
}

// Where the provider sends the person back: the same page that completes email links (it exchanges the code, then routes to onboarding or the workspace).
export const socialRedirectUrl = (origin: string) => new URL(AUTH_CALLBACK_PATH, origin).href;

export const SOCIAL_FAILED_MESSAGE = "We could not start that sign-in. Try again, or use your email and password.";
