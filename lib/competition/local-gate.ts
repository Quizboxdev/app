export function sponsorEngineEnabled(env: Record<string, string | undefined>): boolean {
  if (env.QUIZBOX_SPONSOR_ENGINE_ENABLED !== "true") return false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol);
  } catch { return false; }
}
