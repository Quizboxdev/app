import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type SmeContext = { super_admin: boolean; finance_admin: boolean; content_admin: boolean; reviewer: boolean };
export type RecordRow = Record<string, any>;
export type ConfigEntity = "currencies" | "countries" | "markets" | "sme_profiles" | "sme_domain_assignments" | "compensation_policies" | "compensation_policy_versions" | "user_capabilities";
export type ReadEntity = ConfigEntity | "sme_review_assignments" | "sme_review_queue" | "sme_review_events" | "sme_performance" | "sme_financial_performance" | "sme_earnings_current" | "sme_payout_batches" | "sme_payout_items" | "sme_payout_batch_summary" | "sme_payout_item_details";

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export const getSmeContext = () => call<SmeContext>("qb_sme_context");
export async function listSmeRecords(entity: ReadEntity, filters: Record<string, string> = {}, page = 1) {
  let query = getSupabaseBrowserClient().from(entity).select("*", { count: "exact" });
  for (const [key, value] of Object.entries(filters)) if (value) query = query.eq(key, value);
  const order = entity === "currencies" ? "code" : entity === "sme_performance" || entity === "sme_financial_performance" ? "reviewer_id"
    : entity === "sme_profiles" || entity === "user_capabilities" ? "user_id" : entity === "sme_payout_items" || entity === "sme_payout_item_details" ? "earning_id" : "id";
  const { data, error, count } = await query.order(order).range((page - 1) * 50, page * 50 - 1);
  if (error) throw error;
  return { rows: (data ?? []) as RecordRow[], total: count ?? 0 };
}
export const saveSmeConfiguration = (entity: ConfigEntity, data: Record<string, unknown>) => call<RecordRow>("qb_sme_configure", { p_entity: entity, p_data: data });
export const assignSmeReview = (args: { question: string; reviewer: string; domain: string; kind: string; sponsor?: string; prior?: string }) => call<RecordRow>("qb_sme_assign_review", {
  p_question: args.question, p_reviewer: args.reviewer, p_domain: args.domain, p_kind: args.kind, p_sponsor: args.sponsor || null, p_prior: args.prior || null,
});
export const getSmeReviewDetail = (assignment: string) => call<RecordRow>("qb_sme_review_detail", { p_assignment: assignment });
export const completeSmeReview = (assignment: string, decision: string, note: string, humanReviewed: boolean, version: number) => call<RecordRow>("qb_sme_complete_review", {
  p_assignment: assignment, p_decision: decision, p_note: note, p_human_reviewed: humanReviewed, p_version: version,
});
export const releaseSmeEarning = (id: string, status: string, note: string) => call<void>("qb_sme_release_earning", { p_earning: id, p_status: status, p_note: note });
export const createSmePayout = (market: string, currency: string, start: string, end: string, earnings: string[]) => call<RecordRow>("qb_sme_create_payout", {
  p_market: market || null, p_currency: currency, p_start: start, p_end: end, p_earnings: earnings,
});
export const actOnSmePayout = (batch: string, action: string) => call<RecordRow>("qb_sme_payout_action", { p_batch: batch, p_action: action });
export const publishSmeQuestion = (question: string, version: number) => call<RecordRow>("qb_sme_publish_question", { p_question: question, p_version: version });
