import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { SettingRow } from "@/lib/admin/feature-switches";

// Every global switch row (platform_settings is readable by signed-in accounts; only staff can change it).
export async function listSwitchRows(): Promise<SettingRow[]> {
  const { data, error } = await getSupabaseBrowserClient().from("platform_settings")
    .select("key,value,description,updated_at").eq("scope_type", "global").like("key", "flags.%").order("key");
  if (error) throw new Error("Could not read the feature switches. Refresh the page to try again.");
  return (data ?? []) as SettingRow[];
}

// Uses the existing staff-only save, which also writes the change to the audit log.
export async function setSwitch(key: string, on: boolean): Promise<void> {
  if (!/^flags\.[a-z0-9_.]+$/.test(key)) throw new Error("That is not a feature switch.");
  const { error } = await getSupabaseBrowserClient().rpc("qb_setting_set", { p_key: key, p_value: on });
  if (error) throw new Error(error.message.includes("QB_FORBIDDEN") ? "Only QuizBox staff can change feature switches." : "The switch was not changed. Try again.");
}
