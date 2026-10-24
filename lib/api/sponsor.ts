import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ParticipationFunnel, QuestionPerformanceRow, ScoreBucket, SponsorCompetitionRow, SponsorDemographics, SponsorProfile } from "@/lib/api/sponsor-types";

function ensure<T>(data: T | null, error: unknown): T {
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
  return data as SponsorProfile | null;
}

export async function getSponsorCompetitions(sponsorId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("competition_sponsors")
    .select("*, competitions(*)")
    .eq("sponsor_id", sponsorId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as SponsorCompetitionRow[];
}

export async function getCompetitionFundingSummary(competitionId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(
    "qb_competition_funding_summary",
    { p_competition_id: competitionId }
  );
  return ensure<Record<string, unknown>>(data, error);
}

export async function getSponsorParticipationFunnel(sponsorId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_sponsor_participation_funnel", { p_sponsor_id: sponsorId });
  return ensure<ParticipationFunnel>(data, error);
}

export async function getSponsorScoreDistribution(sponsorId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_sponsor_score_distribution", { p_sponsor_id: sponsorId });
  return ensure<ScoreBucket[]>(data, error);
}

export async function getSponsorDemographics(sponsorId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_sponsor_demographics", { p_sponsor_id: sponsorId });
  return ensure<SponsorDemographics>(data, error);
}

export async function getSponsorQuestionPerformance(sponsorId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_sponsor_question_performance", { p_sponsor_id: sponsorId });
  return ensure<QuestionPerformanceRow[]>(data, error);
}
