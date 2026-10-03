import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

export async function getStudentDashboard(studentId: string) {
  const supabase = getSupabaseBrowserClient();

  const [
    resultsRes,
    membershipsRes,
    assignmentsRes,
    notificationsRes,
    xpRes,
  ] = await Promise.all([
    supabase.rpc("qb_my_results", { p_limit: 10 }),
    supabase
      .from("class_memberships")
      .select("*, classes(*)")
      .eq("student_id", studentId)
      .order("joined_at", { ascending: false }),
    supabase
      .from("assignment_targets")
      .select("*, assignments(*)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false }),
    supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.rpc("qb_student_xp"),
  ]);

  if (resultsRes.error) throw new Error(userFacingError(resultsRes.error));
  if (membershipsRes.error) throw new Error(userFacingError(membershipsRes.error));
  if (assignmentsRes.error) throw new Error(userFacingError(assignmentsRes.error));
  if (notificationsRes.error) throw new Error(userFacingError(notificationsRes.error));
  if (xpRes.error) throw new Error(userFacingError(xpRes.error));

  const results = (resultsRes.data ?? []) as any[];
  const average =
    results.length > 0
      ? results.reduce((sum, row) => sum + Number(row.percentage ?? 0), 0) /
        results.length
      : 0;

  return {
    results,
    memberships: membershipsRes.data ?? [],
    assignments: assignmentsRes.data ?? [],
    notifications: notificationsRes.data ?? [],
    xp: Array.isArray(xpRes.data) ? xpRes.data[0] ?? { total_xp: 0, level: 1, current_level_xp: 0, next_level_xp: 100 } : xpRes.data,
    stats: {
      completed: results.length,
      average,
      best: results.length
        ? Math.max(...results.map((r) => Number(r.percentage ?? 0)))
        : 0,
    },
  };
}

export async function getStudentClassroom(studentId: string) {
  const supabase = getSupabaseBrowserClient();

  const { data: memberships, error: membershipError } = await supabase
    .from("class_memberships")
    .select("*, classes(*)")
    .eq("student_id", studentId)
    .order("joined_at", { ascending: false });

  if (membershipError) throw new Error(userFacingError(membershipError));

  const classIds = (memberships ?? [])
    .map((m: any) => m.class_id)
    .filter(Boolean);

  let assignments: any[] = [];
  if (classIds.length) {
    const { data, error } = await supabase
      .from("assignments")
      .select("*")
      .in("class_id", classIds)
      .order("created_at", { ascending: false });

    if (error) throw new Error(userFacingError(error));
    assignments = data ?? [];
  }

  return { memberships: memberships ?? [], assignments };
}

export async function joinClass(joinCode: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_join_class", { p_join_code: joinCode.trim().toUpperCase() });
  if (error) throw new Error(userFacingError(error));
  if (data?.error) throw new Error(userFacingError({ message: data.error }));
  return data;
}

export async function getStudentXp() {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_student_xp");
  if (error) throw new Error(userFacingError(error));
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function getStudentCompetitionAnalytics(studentId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_student_competition_analytics", { p_student_id: studentId });
  if (error) throw new Error(userFacingError(error));
  return data;
}

export async function getStudentAchievements(studentId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_student_achievements", { p_student_id: studentId });
  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}
