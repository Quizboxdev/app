import { schoolAction } from "@/lib/api/platform";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// School administration reads/writes go through the qb_school RPC (institution admin/owner only).
export type SchoolRef = { id: string; name: string; role: string };
export type SchoolTeacher = { user_id: string; name: string | null; role: string };
export type SchoolClass = { id: string; name: string; grade: string | null; status: string; teacher: string | null; teacher_user_id?: string | null; students: number };
// `summary` is server-side (unique learners, joins in 30 days); absent until the school-performance migration is applied.
export type SchoolOverview = { institution: string; teachers: SchoolTeacher[]; classes: SchoolClass[]; summary?: { unique_learners: number; joined_last_30d: number } };
export type SchoolHistoryRow = { class: string; student: string; status: string; joined_at: string; left_at?: string | null };
export type ClassMember = { id: string; class_id: string; student_name: string };

export const listMySchools = () => schoolAction<SchoolRef[]>("my_schools");
export const getSchoolOverview = (institutionId: string) => schoolAction<SchoolOverview>("overview", { institution_id: institutionId });
export const getSchoolHistory = (institutionId: string) => schoolAction<SchoolHistoryRow[]>("history", { institution_id: institutionId });
// Aggregates are per rostered learner (latest final grade). null scores mean "no assessed learners", never 0.
export type PerfCounts = { learner_count: number; assessed_count: number; average_score: number | null; completion_rate: number | null };
export type SchoolPerformance = {
  summary: { learner_count: number; assessed_learner_count: number; average_score: number | null; assignment_completion_rate: number | null; due_target_count: number; active_assignment_count: number };
  by_grade: Array<PerfCounts & { grade: string }>;
  by_class: Array<PerfCounts & { class_id: string; class_name: string; grade: string | null }>;
  by_subject: Array<{ subject: string; assessed_count: number; average_score: number | null }>;
  weak_indicators: Array<{ node_id: string; code: string; label: string; assessed_count: number; response_count: number; average_score: number; low_evidence: boolean }>;
};
// Resolves null when the contract is not deployed yet so the UI can say so instead of failing the page.
export async function getSchoolPerformance(institutionId: string): Promise<SchoolPerformance | null> {
  try { return await schoolAction<SchoolPerformance>("performance", { institution_id: institutionId }); }
  catch (error) { if (/not available yet/.test((error as Error).message)) return null; throw error; }
}
export const runSchoolAction = (action: string, data: Record<string, unknown>) => schoolAction(action, data);

// Per-class roster (needed for transfers, which take a membership id). Same query the School page always used.
export async function listClassMembers(classId: string): Promise<ClassMember[]> {
  const { data, error } = await getSupabaseBrowserClient().from("class_memberships").select("id,class_id,student_name").eq("class_id", classId).eq("status", "active");
  if (error) throw new Error(error.message);
  return data ?? [];
}
