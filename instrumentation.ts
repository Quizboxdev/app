import { validatePublicEnvironment } from "./lib/env";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") validatePublicEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
