import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";

// The live text of a policy, read on the server (the database returns published text only, with the company details filled in). A failure is logged and treated as "nothing published",
// so a public page falls back to its built-in text instead of breaking.
export type PolicyVersionInfo = { version_no: number; effective_at: string | null; summary: string; state: "published" | "superseded" };
export type PublicPolicy = { slug: string; title: string; version_no: number; state: "published" | "superseded"; effective_at: string | null; summary: string; body: string; required: boolean; versions: PolicyVersionInfo[] };

export async function getPolicy(slug: string, version?: number): Promise<PublicPolicy | null> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("qb_policy_public", { p_slug: slug, p_version: version ?? null });
    if (error) { console.error(`[policy] ${slug} not read:`, `${error.code ?? ""} ${error.message}`.trim()); return null; }
    return (data ?? null) as PublicPolicy | null;
  } catch (e) { console.error(`[policy] ${slug} unavailable:`, e instanceof Error ? e.message : "unknown error"); return null; }
}
