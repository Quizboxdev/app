import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function ensure<T>(data: T | null, error: any): T {
  if (error) throw error;
  if (data == null) throw new Error("EMPTY_RESPONSE");
  return data;
}

export async function getMySponsorProfile(userId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("sponsor_profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getSponsorCompetitions(sponsorId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("competition_sponsors")
    .select("*, competitions(*)")
    .eq("sponsor_id", sponsorId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getCompetitionFundingSummary(competitionId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(
    "qb_competition_funding_summary",
    { p_competition_id: competitionId }
  );
  return ensure<any>(data, error);
}
