import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { COVERAGE_TARGETS, type GenerationSpec, type Candidate } from "@/lib/content/factory/contract";
import { filterReviewRows } from "@/lib/content/factory/review";
import { resolveGenerationSources } from "@/lib/api/content-context";

async function call(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw error;
  return data;
}
export async function listContentQueue(filters: Record<string, string>, page = 1) {
  const rpcFilters = { ...filters };
  if (filters.indicator) {
    let query = getSupabaseBrowserClient().from("curriculum_nodes").select("id").eq("code", filters.indicator);
    if (filters.subject) query = query.eq("subject_code", filters.subject);
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) return { rows: [], total: 0 };
    if (data.length !== 1) throw new Error("Select a subject for this indicator.");
    rpcFilters.node = data[0].id;
  }
  if (!filters.reviewStatus && !filters.validation) return call("qb_content_queue", { p_filters: rpcFilters, p_page: page, p_limit: 25 });
  // Local lifecycle/warning filters preserve RPC authorization and truthful pagination.
  const all: any[] = [];
  for (let current = 1; current <= 100; current++) {
    const result = await call("qb_content_queue", { p_filters: rpcFilters, p_page: current, p_limit: 25 });
    all.push(...(result.rows ?? []));
    if (all.length >= result.total) {
      if (filters.validation) {
        for (let start=0;start<all.length;start+=10) await Promise.all(all.slice(start,start+10).map(async row=>{
          const detail=await call("qb_content_detail",{p_id:row.id});
          row.validation_errors=detail.validation_errors??[];
        }));
      }
      const rows = filterReviewRows(all, filters);
      return { rows: rows.slice((page - 1) * 25, page * 25), total: rows.length };
    }
  }
  throw new Error("Narrow the review filters before loading this queue.");
}
export async function getContentDetail(id: string) {
  const detail = await call("qb_content_detail", { p_id: id });
  const ancestry = [], seen = new Set<string>();
  let node = detail.mapping;
  while (node && !seen.has(node.id) && ancestry.length < 10) {
    ancestry.push(node); seen.add(node.id);
    if (!node.parent_id) break;
    const result = await getSupabaseBrowserClient().from("curriculum_nodes").select("id,parent_id,node_type,code,title").eq("id", node.parent_id).maybeSingle();
    if (result.error) throw result.error;
    node = result.data;
  }
  return { ...detail, ancestry };
}
export const getContentCoverage = (filters: Record<string, string>, page = 1) => call("qb_content_coverage", { p_filters: filters, p_page: page, p_limit: 25, p_target: COVERAGE_TARGETS.minimum });
export const reviewContent = (q: { id: string; version: number; validation_status: string }, action: string, note: string, humanReviewed = false, patch: Record<string, unknown> = {}) => call("qb_content_review", { p_id: q.id, p_action: action, p_version: q.version, p_expected_state: q.validation_status, p_patch: patch, p_note: note, p_human_reviewed: humanReviewed });
export const requestGeneration = async (spec: GenerationSpec) => {
  const resolved = await resolveGenerationSources(spec);
  return call("qb_content_request_generation", { p_spec: resolved.spec });
};
export const importCandidates = (spec: Record<string, unknown>, candidates: Candidate[], source = "candidate.json") => call("qb_content_ingest", { p_spec: spec, p_candidates: candidates, p_source_file: source, p_provider: "local-json", p_model: null });
export const listContentBatches = (page = 1) => call("qb_content_batches", { p_page: page, p_limit: 25 });
