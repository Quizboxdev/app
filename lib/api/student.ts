import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function getStudentDashboard(studentId: string) {
  const supabase = getSupabaseBrowserClient();

  const [
    resultsRes,
    membershipsRes,
    assignmentsRes,
    notificationsRes,
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
  ]);

  if (resultsRes.error) throw resultsRes.error;
  if (membershipsRes.error) throw membershipsRes.error;
  if (assignmentsRes.error) throw assignmentsRes.error;
  if (notificationsRes.error) throw notificationsRes.error;

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

  if (membershipError) throw membershipError;

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

    if (error) throw error;
    assignments = data ?? [];
  }

  return { memberships: memberships ?? [], assignments };
}
