import { canonicalFilterGrade } from "@/lib/content/grades";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import { indicatorsFromSummary, summarizeClassLearners, type IndicatorSummaryRow } from "@/lib/learning/analytics";

export async function getTeacherDashboard(teacherId: string, userId: string) {
  const supabase = getSupabaseBrowserClient();

  const [classesRes, assignmentsRes, banksRes, gradebookRes] = await Promise.all([
    supabase
      .from("classes")
      .select("*")
      .or(`primary_teacher_id.eq.${teacherId},teacher_id.eq.${teacherId}`),
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
    if (res.error) throw new Error(userFacingError(res.error));
  }

  return {
    classes: classesRes.data ?? [],
    assignments: assignmentsRes.data ?? [],
    questionBanks: banksRes.data ?? [],
    gradebook: gradebookRes.data ?? [],
  };
}

export async function getTeacherAnalytics(teacherId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data: classes, error: classError } = await supabase.from("classes").select("id,class_name").or(`primary_teacher_id.eq.${teacherId},teacher_id.eq.${teacherId}`);
  if (classError) throw new Error(userFacingError(classError));
  const classIds = (classes ?? []).map((row) => row.id);
  if (!classIds.length) return { classes: [], indicators: [], needsAttention: [] };
  const [grades, summary, rosters] = await Promise.all([
    supabase.from("gradebook").select("class_id,student_user_id,percentage,status,graded_at").in("class_id", classIds).eq("status", "final"),
    // Indicator aggregation runs in the database under the teacher's RLS (same rows as before, no event download).
    supabase.rpc("qb_teacher_indicator_summary", { p_class_ids: classIds }),
    supabase.from("class_memberships").select("class_id,student_user_id").in("class_id", classIds).eq("status", "active"),
  ]);
  for (const result of [grades, summary, rosters]) if (result.error) throw new Error(userFacingError(result.error));
  const classAnalytics = (classes ?? []).map((row) => ({ ...row, ...summarizeClassLearners((grades.data ?? []).filter((grade) => grade.class_id === row.id), (rosters.data ?? []).filter((member) => member.class_id === row.id).map((member) => member.student_user_id)) }));
  const summaryRows: IndicatorSummaryRow[] = summary.data ?? [];
  const indicators = indicatorsFromSummary(summaryRows);
  return { classes: classAnalytics, indicators, needsAttention: indicators.filter((row) => row.averageMastery < 68 || row.averageAccuracy < 68).map((row) => ({ ...row, className: "Teacher class", classId: summaryRows.find((s) => s.code === row.code)?.class_id, curriculumNodeId: summaryRows.find((s) => s.code === row.code)?.curriculum_node_id })) };
}

export async function listIndicatorLearnersPage(classId: string, curriculumNodeId: string, page = 1) {
  const { data,error }=await getSupabaseBrowserClient().rpc("qb_indicator_learners_page",{p_class_id:classId,p_node_id:curriculumNodeId,p_page:page,p_limit:25});
  if(error)throw new Error(userFacingError(error));
  return data as {rows:any[];total:number};
}

export async function listIndicatorLearners(classId: string, curriculumNodeId: string) {
  return (await listIndicatorLearnersPage(classId,curriculumNodeId)).rows;
}

export async function listTeacherClasses(teacherId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("classes")
    .select("*, curriculum_nodes!subject_node_id(id,title,subject_code)")
    .or(`primary_teacher_id.eq.${teacherId},teacher_id.eq.${teacherId}`)
    .order("created_at", { ascending: false });

  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function createClass(payload: Record<string, unknown>) {
  const { data, error } = await getSupabaseBrowserClient().from("classes").insert(payload).select("*").single();
  if (error) throw new Error(userFacingError(error));
  return data;
}

export async function archiveClass(classId: string) {
  const { data, error } = await getSupabaseBrowserClient().from("classes").update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", classId).select("*").single();
  if (error) throw new Error(userFacingError(error));
  return data;
}

export async function listClassRoster(classId: string) {
  const { data, error } = await getSupabaseBrowserClient().from("class_memberships").select("id,student_name,student_email,joined_at,status").eq("class_id", classId).order("joined_at");
  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function listQuestions(filters: { search?: string; grade?: string; subject?: string; status?: string; difficulty?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filters.pageSize ?? 25));
  let query = getSupabaseBrowserClient().from("questions").select("id,question_code,question_text,grade,subject_code,strand_name,substrand_name,content_standard_code,indicator_code,difficulty_label,answer_type,status,source_type,created_at", { count: "exact" });
  if (filters.search) query = query.ilike("question_text", `%${filters.search.replace(/[%_]/g, "")}%`);
  if (filters.grade) query = query.eq("canonical_grade_code", canonicalFilterGrade(filters.grade));
  if (filters.subject) query = query.eq("subject_code", filters.subject);
  if (filters.status) query = query.eq("validation_status", filters.status.toLowerCase());
  if (filters.difficulty) query = query.or(`difficulty_code.eq.${filters.difficulty},difficulty_label.eq.${filters.difficulty}`);
  const { data, error, count } = await query.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new Error(userFacingError(error));
  return { rows: data ?? [], count: count ?? 0, page, pageSize };
}

export async function listTeacherAssignments(teacherId: string, userId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("assignments")
    .select("*, classes(*)")
    .or(`teacher_id.eq.${teacherId},teacher_user_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function createAssignment(payload: Record<string, unknown>) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("assignments")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(userFacingError(error));
  return data;
}

export async function publishAssignment(payload: {
  classId: string; title: string; description: string; curriculumNodeIds: string[];
  questionCount: number; difficulty?: string; selectionMode: "AUTOMATIC" | "MANUAL";
  questionIds?: string[]; mode: "PRACTICE" | "ASSESSMENT"; attemptsAllowed: number;
  timeLimitMinutes: number; startAt?: string; dueAt?: string;
  targetStudentIds?: string[]; remediationSourceAssignmentId?: string; remediationNodeId?: string;
}) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_publish_assignment", {
    p_class_id: payload.classId, p_title: payload.title, p_description: payload.description,
    p_curriculum_node_ids: payload.curriculumNodeIds, p_question_count: payload.questionCount,
    p_difficulty: payload.difficulty || null, p_selection_mode: payload.selectionMode,
    p_question_ids: payload.questionIds ?? null, p_mode: payload.mode,
    p_attempts_allowed: payload.attemptsAllowed, p_time_limit_minutes: payload.timeLimitMinutes,
    p_start_at: payload.startAt ?? new Date().toISOString(), p_due_at: payload.dueAt ?? null,
    p_target_student_ids: payload.targetStudentIds ?? null, p_remediation_source_assignment_id: payload.remediationSourceAssignmentId ?? null, p_remediation_node_id: payload.remediationNodeId ?? null,
  });
  if (error) throw new Error(userFacingError(error));
  return data;
}

export async function listQuestionBanks(userId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("question_banks")
    .select("*, question_bank_items(count)")
    .eq("created_by", userId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function listGradebook(teacherId: string, filters: { page?: number; classId?: string; assignmentId?: string } = {}) {
  const supabase = getSupabaseBrowserClient();

  const { data: classes, error: classError } = await supabase
    .from("classes")
    .select("id")
    .or(`primary_teacher_id.eq.${teacherId},teacher_id.eq.${teacherId}`);

  if (classError) throw new Error(userFacingError(classError));

  const ids = (classes ?? []).map((c: any) => c.id);
  if (!ids.length) return [];

  const page = Math.max(1, Math.floor(filters.page ?? 1));
  let query = supabase
    .from("gradebook")
    .select("*")
    .in("class_id", ids)
    .order("graded_at", { ascending: false })
    .order("id")
    .range((page - 1) * 50, page * 50 - 1);
  if (filters.classId) query = query.eq("class_id", filters.classId);
  if (filters.assignmentId) query = query.eq("assignment_id", filters.assignmentId);
  const { data, error } = await query;

  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function getTeacherSubmission(attemptId: string) {
  const supabase = getSupabaseBrowserClient();
  const [grade, events] = await Promise.all([
    supabase.from("gradebook").select("*").eq("attempt_id", attemptId).single(),
    supabase.from("learning_events").select("is_correct,response_seconds,curriculum_node_id,curriculum_nodes(code,title)").eq("attempt_id", attemptId),
  ]);
  if (grade.error) throw new Error(userFacingError(grade.error));
  if (events.error) throw new Error(userFacingError(events.error));
  return { grade: grade.data, events: events.data ?? [] };
}
