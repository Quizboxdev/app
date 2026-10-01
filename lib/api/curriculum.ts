import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function listCurricula() {
  const { data, error } = await getSupabaseBrowserClient().from("curricula").select("id,code,name,version,country").eq("status", "ACTIVE").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listCurriculumNodes(filters: { curriculumId: string; parentId?: string | null; nodeType?: string; gradeCode?: string; subjectCode?: string }) {
  let query = getSupabaseBrowserClient().from("curriculum_nodes").select("id,parent_id,node_type,code,title,source_terminology,education_level,grade_code,subject_code,sort_order").eq("curriculum_id", filters.curriculumId).eq("is_active", true);
  query = filters.parentId === null ? query.is("parent_id", null) : filters.parentId ? query.eq("parent_id", filters.parentId) : query;
  if (filters.nodeType) query = query.eq("node_type", filters.nodeType);
  if (filters.gradeCode) query = query.eq("grade_code", filters.gradeCode);
  if (filters.subjectCode) query = query.eq("subject_code", filters.subjectCode);
  const { data, error } = await query.order("sort_order").order("title");
  if (error) throw error;
  return data ?? [];
}

export async function getQuestionAvailability(nodeIds: string[], grade?: string, subjectCode?: string) {
  if (!nodeIds.length) return [];
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_question_availability", { p_curriculum_node_ids: nodeIds, p_grade: grade ?? null, p_subject_code: subjectCode ?? null });
  if (error) throw error;
  return data ?? [];
}

export async function listApprovedQuestionsForNode(nodeId: string, grade?: string) {
  let query = getSupabaseBrowserClient().from("questions")
    .select("id,question_code,question_text,option_a,option_b,option_c,option_d,difficulty_label,answer_type")
    .eq("curriculum_node_id", nodeId).eq("status", "active").in("validation_status", ["approved", "validated"])
    .order("difficulty_label").order("question_code");
  if (grade) query = query.eq("grade", grade);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

