import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { COVERAGE_TARGETS, type GenerationSpec, type Candidate } from "@/lib/content/factory/contract";

async function call(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw error;
  return data;
}
export const listContentQueue = (filters: Record<string, string>, page = 1) => call("qb_content_queue", { p_filters: filters, p_page: page, p_limit: 25 });
export const getContentDetail = (id: string) => call("qb_content_detail", { p_id: id });
export const getContentCoverage = (filters: Record<string, string>, page = 1) => call("qb_content_coverage", { p_filters: filters, p_page: page, p_limit: 25, p_target: COVERAGE_TARGETS.minimum });
export const reviewContent = (q: { id: string; version: number; validation_status: string }, action: string, note: string, humanReviewed = false, patch: Record<string, unknown> = {}) => call("qb_content_review", { p_id: q.id, p_action: action, p_version: q.version, p_expected_state: q.validation_status, p_patch: patch, p_note: note, p_human_reviewed: humanReviewed });
export const requestGeneration = (spec: GenerationSpec) => call("qb_content_request_generation", { p_spec: spec });
export const importCandidates = (spec: Record<string, unknown>, candidates: Candidate[], source = "candidate.json") => call("qb_content_ingest", { p_spec: spec, p_candidates: candidates, p_source_file: source, p_provider: "local-json", p_model: null });
export const listContentBatches = (page = 1) => call("qb_content_batches", { p_page: page, p_limit: 25 });
