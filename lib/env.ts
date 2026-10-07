export function validatePublicEnvironment(env: { NEXT_PUBLIC_SUPABASE_URL?: string; NEXT_PUBLIC_SUPABASE_ANON_KEY?: string }) {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("QuizBox requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  let url: URL;
  try { url = new URL(env.NEXT_PUBLIC_SUPABASE_URL); } catch { throw new Error("QuizBox Supabase project URL is invalid."); }
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("Use the base Supabase project URL without REST paths or credentials.");
  if (env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith("sb_secret_")) throw new Error("A secret key cannot be used in public configuration.");
  try {
    const part = env.NEXT_PUBLIC_SUPABASE_ANON_KEY.split(".")[1];
    const claims = part ? JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) : null;
    if (claims?.role === "service_role") throw new Error("PUBLIC_SERVICE_ROLE_KEY");
    // A legacy anon JWT names its project: it must be the project the URL points to, or every request fails with 401 "Invalid API key".
    const urlRef = url.hostname.endsWith(".supabase.co") ? url.hostname.split(".")[0] : null;
    if (claims?.ref && urlRef && claims.ref !== urlRef) throw new Error(`PUBLIC_KEY_PROJECT_MISMATCH:${claims.ref}:${urlRef}`);
  } catch (error) {
    if (error instanceof Error && error.message === "PUBLIC_SERVICE_ROLE_KEY") throw new Error("A service-role key cannot be used in public configuration.");
    if (error instanceof Error && error.message.startsWith("PUBLIC_KEY_PROJECT_MISMATCH:")) {
      const [, keyRef, urlRef] = error.message.split(":");
      throw new Error(`NEXT_PUBLIC_SUPABASE_ANON_KEY belongs to project ${keyRef} but NEXT_PUBLIC_SUPABASE_URL points to ${urlRef}. Use the anon/publishable key of ${urlRef}.`);
    }
  }
  return { url: env.NEXT_PUBLIC_SUPABASE_URL, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
}
