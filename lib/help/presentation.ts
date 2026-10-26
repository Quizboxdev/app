import { getSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { flagsFromSettings } from "@/lib/core/config";
import type { HelpMeta } from "./categories";

// Same global platform-settings architecture as the existing pilot. Unknown,
// missing, non-boolean or unreadable settings fail closed. No setting is written.
export async function helpCentreEnabled(): Promise<boolean> {
  try {
    const { data, error } = await getSupabaseAdminClient().from("platform_settings").select("key,value").eq("key", "flags.design_v02_help").eq("scope_type", "global").is("scope_id", null);
    return !error && flagsFromSettings(data ?? []).design_v02_help;
  } catch { return false; }
}

// Keep failure distinct from a successful empty list for the new state sheet.
// The legacy reader and all its callers remain unchanged.
export async function getHelpCentreArticles(): Promise<{ guides: HelpMeta[]; unavailable: boolean }> {
  try {
    const { data, error } = await getSupabaseAdminClient().rpc("qb_help_list", { p_audience: null });
    if (error || !Array.isArray(data)) return { guides: [], unavailable: true };
    return { guides: data as HelpMeta[], unavailable: false };
  } catch { return { guides: [], unavailable: true }; }
}
