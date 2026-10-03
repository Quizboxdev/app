// Never enable the sponsor engine against the production project, whatever else is configured.
const PRODUCTION_PROJECT_REF = "fmgccmqxfjppqydkhaiu";

export function sponsorEngineEnabled(env: Record<string, string | undefined>): boolean {
  if (env.QUIZBOX_SPONSOR_ENGINE_ENABLED !== "true") return false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol)) return true;
    // A single explicitly named preview branch may be used for hosted acceptance.
    const branch = env.QUIZBOX_SPONSOR_BRANCH_REF ?? "";
    return /^[a-z]{20}$/.test(branch) && branch !== PRODUCTION_PROJECT_REF && branch !== env.QB_PRODUCTION_PROJECT_REF
      && url.protocol === "https:" && url.hostname === `${branch}.supabase.co` && url.port === "";
  } catch { return false; }
}
