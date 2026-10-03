import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import type { ImportRow } from "@/lib/content/factory/import";

// Thin clients for the Content Factory and SME Workforce RPCs. Authorization, planning and scheduling are server-side.
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(userFacingError(error));
  return data as T;
}
export type Campaign = { id: string; name: string; status: string; market: string; curriculum: string; market_id: string; curriculum_id: string; target_question_count: number; batch_size: number; provider: string; model: string;
  priority: number; generated_count: number; accepted_count: number; rejected_count: number; review_pending_count: number; duplicate_flagged_count: number; generation_paused: boolean; assignment_paused: boolean;
  max_jobs_per_execution: number; large_campaign_threshold: number; allocated: number; source_scope: Record<string, unknown>; difficulty_mix: Record<string, number>; cognitive_mix: Record<string, number>; question_types: Record<string, number>; review_policy: Record<string, unknown>;
  jobs: { total: number; queued: number; running: number; completed: number; failed: number; cancelled: number }; created_at: string };
export type Allocation = { id: string; subject_code: string; grade_code: string; education_level: string; strand_title: string | null; indicator_code: string; indicator_title: string; difficulty: string; cognitive_level: string; answer_type: string; planned_count: number; target_count: number };
export type Estimate = { target_questions: number; allocated_questions: number; indicators: number; expected_jobs: number; executions_needed: number; batch_size: number; provider: string; model: string; provider_calls: number; estimated_tokens: number | null; cost_note: string; estimated_primary_reviews: number; estimated_senior_reviews: number; confirmation_required: boolean };
export type CampaignDetail = Campaign & { estimate: Estimate; plan: Allocation[]; plan_rows: number; events: Array<{ at: string; action: string; details: Record<string, unknown> }> };
export type FactoryOptions = { markets: Array<{ id: string; name: string }>; curricula: Array<{ id: string; code: string; market_id: string; authority: string }>; sources: Array<{ id: string; title: string; market_id: string; curriculum_id: string }>; scope: Array<{ subject: string; grade: string; level: string }> };

export const factory = <T = unknown>(action: string, data: Record<string, unknown> = {}) => call<T>("qb_content_factory", { p_action: action, p_data: data });
export const factoryOptions = (curriculumId?: string) => factory<FactoryOptions>("options", curriculumId ? { curriculum_id: curriculumId } : {});
export const importQuestions = (data: { market_id: string; curriculum_id: string; source_document_ids: string[]; campaign_id?: string; origin?: "IMPORTED" | "HUMAN_AUTHOR"; file_name?: string; rows: ImportRow[] }) =>
  call<{ inserted: number; rejected: number; row_errors: Array<{ row: number; code: string }>; published: number }>("qb_content_factory_import", { p_data: data });
export const workforce = <T = unknown>(action: string, data: Record<string, unknown> = {}) => call<T>("qb_sme_workforce", { p_action: action, p_data: data });

// Bounded server-side generation execution (one click = at most max_jobs_per_execution provider calls).
export async function runCampaignJobs(campaignId: string) {
  const supabase = getSupabaseBrowserClient(); const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token; if (!token) throw new Error(userFacingError(new Error("AUTH_REQUIRED")));
  const response = await fetch("/api/admin/content-factory/run", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ campaign_id: campaignId }) });
  const body = await response.json();
  if (!response.ok) throw new Error(userFacingError(new Error(body.error ?? "GENERATION_FAILED")));
  return body as { claimed: number; outcomes: Array<{ job_id: string; status: string; valid?: number; duplicates?: number; duplicates_skipped?: number; error?: string }> };
}
