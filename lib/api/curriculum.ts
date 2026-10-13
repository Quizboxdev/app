import { canonicalFilterGrade } from "@/lib/content/grades";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

export async function listCurricula() {
  const { data, error } = await getSupabaseBrowserClient().from("curricula").select("id,code,name,version,country").eq("status", "ACTIVE").order("name");
  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function listCurriculumNodes(filters: { curriculumId: string; parentId?: string | null; nodeType?: string; gradeCode?: string; subjectCode?: string }) {
  let query = getSupabaseBrowserClient().from("curriculum_nodes").select("id,parent_id,node_type,code,title,source_terminology,education_level,grade_code,subject_code,sort_order").eq("curriculum_id", filters.curriculumId).eq("is_active", true);
  query = filters.parentId === null ? query.is("parent_id", null) : filters.parentId ? query.eq("parent_id", filters.parentId) : query;
  if (filters.nodeType) query = query.eq("node_type", filters.nodeType);
  if (filters.gradeCode) query = query.eq("grade_code", canonicalFilterGrade(filters.gradeCode));
  if (filters.subjectCode) query = query.eq("subject_code", filters.subjectCode);
  const { data, error } = await query.order("sort_order").order("title");
  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function getQuestionAvailability(nodeIds: string[], grade?: string, subjectCode?: string) {
  if (!nodeIds.length) return [];
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_question_availability", { p_curriculum_node_ids: nodeIds, p_grade: grade ?? null, p_subject_code: subjectCode ?? null });
  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function listApprovedQuestionsForNode(nodeId: string, grade?: string) {
  let query = getSupabaseBrowserClient().from("questions")
    .select("id,question_code,question_text,option_a,option_b,option_c,option_d,difficulty_label,answer_type")
    .eq("curriculum_node_id", nodeId).eq("status", "active").in("validation_status", ["approved", "validated"])
    .order("difficulty_label").order("question_code").range(0, 99);
  if (grade) query = query.eq("grade", grade);
  const { data, error } = await query;
  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}


// The grade node(s) a learner belongs to, across the curricula they may read. Legacy umbrella curricula come last so the dedicated
// curriculum of their level wins when both carry the grade.
const LEGACY_CODES = new Set(["GH-CCP-2020", "GH-SOURCE"]);
export async function findLearnerGradeRoot(variants: string[]) {
  if (!variants.length) return null;
  const supabase = getSupabaseBrowserClient();
  const list = variants.map((v) => `"${v.replace(/"/g, "")}"`).join(",");
  const [{ data: nodes, error }, curricula] = await Promise.all([
    supabase.from("curriculum_nodes").select("id,curriculum_id,parent_id,node_type,code,title,source_terminology,education_level,grade_code,subject_code")
      .eq("node_type", "grade").eq("is_active", true).or(`canonical_grade_code.in.(${list}),grade_code.in.(${list})`).limit(20),
    listCurricula(),
  ]);
  if (error) throw new Error(userFacingError(error));
  const codeOf = new Map((curricula as Array<{ id: string; code: string }>).map((c) => [c.id, c.code]));
  const usable = (nodes ?? []).filter((n: any) => codeOf.has(n.curriculum_id));
  usable.sort((a: any, b: any) => Number(LEGACY_CODES.has(codeOf.get(a.curriculum_id) ?? "")) - Number(LEGACY_CODES.has(codeOf.get(b.curriculum_id) ?? "")));
  return (usable[0] as any) ?? null;
}
