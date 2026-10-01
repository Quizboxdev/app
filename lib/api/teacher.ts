import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function getTeacherDashboard(teacherId: string, userId: string) {
  const supabase = getSupabaseBrowserClient();

  const [classesRes, assignmentsRes, banksRes, gradebookRes] = await Promise.all([
    supabase
      .from("classes")
      .select("*")
      .or(`primary_teacher_id.eq.${teacherId}`),
    supabase
      .from("assignments")
      .select("*")
      .or(`teacher_id.eq.${teacherId},teacher_user_id.eq.${userId}`)
      .order("created_at", { ascending: false }),
    supabase
      .from("question_banks")
      .select("*")
      .eq("created_by", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("gradebook")
      .select("*")
      .order("graded_at", { ascending: false })
      .limit(100),
  ]);

  for (const res of [classesRes, assignmentsRes, banksRes, gradebookRes]) {
    if (res.error) throw res.error;
  }

  return {
    classes: classesRes.data ?? [],
    assignments: assignmentsRes.data ?? [],
    questionBanks: banksRes.data ?? [],
    gradebook: gradebookRes.data ?? [],
  };
}

export async function listTeacherClasses(teacherId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("classes")
    .select("*")
    .or(`primary_teacher_id.eq.${teacherId}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function listTeacherAssignments(teacherId: string, userId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("assignments")
    .select("*, classes(*)")
    .or(`teacher_id.eq.${teacherId},teacher_user_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createAssignment(payload: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("assignments")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

export async function listQuestionBanks(userId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("question_banks")
    .select("*, question_bank_items(count)")
    .eq("created_by", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function listGradebook(teacherId: string) {
  const supabase = getSupabaseBrowserClient();

  const { data: classes, error: classError } = await supabase
    .from("classes")
    .select("id")
    .or(`primary_teacher_id.eq.${teacherId}`);

  if (classError) throw classError;

  const ids = (classes ?? []).map((c: any) => c.id);
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from("gradebook")
    .select("*")
    .in("class_id", ids)
    .order("graded_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}
