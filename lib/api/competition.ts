import { getSupabaseBrowserClient } from "@/lib/supabase/client";

function ensure<T>(data: T | null, error: any): T {
  if (error) throw error;
  if (data == null) throw new Error("EMPTY_RESPONSE");
  return data;
}

export async function listCompetitions() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("competitions")
    .select("*")
    .order("starts_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function registerSchool(
  competitionId: string,
  institutionId: string
) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(
    "qb_register_competition_school",
    {
      p_competition_id: competitionId,
      p_institution_id: institutionId,
    }
  );
  return ensure<any>(data, error);
}

export async function createTeam(
  competitionId: string,
  institutionId: string,
  teamName: string
) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_create_competition_team", {
    p_competition_id: competitionId,
    p_institution_id: institutionId,
    p_team_name: teamName,
  });
  return ensure<any>(data, error);
}

export async function addTeamMember(
  teamId: string,
  studentId: string,
  role = "MEMBER"
) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_add_team_member", {
    p_team_id: teamId,
    p_student_id: studentId,
    p_role: role,
  });
  return ensure<any>(data, error);
}

export async function verifyTeamMember(teamMemberId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_verify_team_member", {
    p_team_member_id: teamMemberId,
  });
  return ensure<any>(data, error);
}

export async function getLeaderboard(competitionId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(
    "qb_competition_leaderboard",
    { p_competition_id: competitionId }
  );
  return ensure<any[]>(data, error);
}

export async function finalizeLeaderboard(competitionId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(
    "qb_finalize_competition_leaderboard",
    { p_competition_id: competitionId }
  );
  return ensure<any>(data, error);
}

export async function listCompetitionTeams(competitionId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("competition_teams")
    .select("*, institutions(*)")
    .eq("competition_id", competitionId)
    .order("team_name");

  if (error) throw error;
  return data ?? [];
}

export async function listTeamMembers(teamId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("competition_team_members")
    .select("*, student_profiles(*)")
    .eq("team_id", teamId)
    .order("created_at");

  if (error) throw error;
  return data ?? [];
}
