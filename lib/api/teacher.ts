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
    .select("*, curriculum_nodes!subject_node_id(id,title,subject_code)")
    .or(`primary_teacher_id.eq.${teacherId}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createClass(payload: Record<string, unknown>) {
  const { data, error } = await getSupabaseBrowserClient().from("classes").insert(payload).select("*").single();
  if (error) throw error;
  return data;
}

export async function archiveClass(classId: string) {
  const { data, error } = await getSupabaseBrowserClient().from("classes").update({ status: "ARCHIVED", updated_at: new Date().toISOString() }).eq("id", classId).select("*").single();
  if (error) throw error;
  return data;
}

export async function listClassRoster(classId: string) {
  const { data, error } = await getSupabaseBrowserClient().from("class_memberships").select("id,student_name,student_email,joined_at,status").eq("class_id", classId).order("joined_at");
  if (error) throw error;
  return data ?? [];
}

export async function listQuestions(filters: { search?: string; grade?: string; subject?: string; status?: string; difficulty?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  let query = getSupabaseBrowserClient().from("questions").select("id,question_code,question_text,grade,subject_code,strand_name,substrand_name,content_standard_code,indicator_code,difficulty_label,answer_type,status,source_type,created_at", { count: "exact" });
  if (filters.search) query = query.ilike("question_text", `%${filters.search.replace(/[%_]/g, "")}%`);
  if (filters.grade) query = query.eq("grade", filters.grade);
  if (filters.subject) query = query.eq("subject_code", filters.subject);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.difficulty) query = query.or(`difficulty_code.eq.${filters.difficulty},difficulty_label.eq.${filters.difficulty}`);
  const { data, error, count } = await query.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw error;
  return { rows: data ?? [], count: count ?? 0, page, pageSize };
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

export async function publishAssignment(payload: {
  classId: string; title: string; description: string; curriculumNodeIds: string[];
  questionCount: number; difficulty?: string; selectionMode: "AUTOMATIC" | "MANUAL";
  questionIds?: string[]; mode: "PRACTICE" | "ASSESSMENT"; attemptsAllowed: number;
  timeLimitMinutes: number; startAt?: string; dueAt?: string;
}) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_publish_assignment", {
    p_class_id: payload.classId, p_title: payload.title, p_description: payload.description,
    p_curriculum_node_ids: payload.curriculumNodeIds, p_question_count: payload.questionCount,
    p_difficulty: payload.difficulty || null, p_selection_mode: payload.selectionMode,
    p_question_ids: payload.questionIds ?? null, p_mode: payload.mode,
    p_attempts_allowed: payload.attemptsAllowed, p_time_limit_minutes: payload.timeLimitMinutes,
    p_start_at: payload.startAt ?? new Date().toISOString(), p_due_at: payload.dueAt ?? null,
  });
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

export async function getTeacherSubmission(attemptId: string) {
  const supabase = getSupabaseBrowserClient();
  const [grade, events] = await Promise.all([
    supabase.from("gradebook").select("*").eq("attempt_id", attemptId).single(),
    supabase.from("learning_events").select("is_correct,response_seconds,curriculum_node_id,curriculum_nodes(code,title)").eq("attempt_id", attemptId),
  ]);
  if (grade.error) throw grade.error;
  if (events.error) throw events.error;
  return { grade: grade.data, events: events.data ?? [] };
}
