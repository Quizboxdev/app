import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import type { HelpDetail, HelpMeta } from "./categories";

// Help guides read on the server for the public pages. A failure is logged and shown as "no guides yet" instead of breaking the page.
export async function getHelpList(audience?: string): Promise<HelpMeta[]> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("qb_help_list", { p_audience: audience ?? null });
    if (error) { console.error("[help] list not read:", `${error.code ?? ""} ${error.message}`.trim()); return []; }
    return (data ?? []) as HelpMeta[];
  } catch (e) { console.error("[help] list unavailable:", e instanceof Error ? e.message : "unknown error"); return []; }
}
export async function getHelpArticle(slug: string): Promise<HelpDetail | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 60) return null;
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("qb_help_get", { p_slug: slug });
    if (error) { console.error(`[help] ${slug} not read:`, `${error.code ?? ""} ${error.message}`.trim()); return null; }
    return (data ?? null) as HelpDetail | null;
  } catch (e) { console.error(`[help] ${slug} unavailable:`, e instanceof Error ? e.message : "unknown error"); return null; }
}
