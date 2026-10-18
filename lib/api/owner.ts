import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

// Owner (super admin) controls that used to need the SQL editor: the free allowance, manual subscriptions, and question-batch approval.
// Every rule is enforced by the database functions; these helpers only call them.
const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(userFacingError(error));
  return data as T;
};

export type Subscription = { id: string; email: string; name: string; plan: string; status: string; source: string; valid_from: string; valid_until: string; note: string | null; created_at: string };
export type AccessOverview = { free_limit: number | null; learners: number; subscribed_now: number; subscriptions: Subscription[] };
export const getAccessOverview = () => rpc<AccessOverview>("qb_admin_access_overview");
export const setFreeAllowance = (sessions: number | null) => rpc("qb_admin_set_free_allowance", { p_sessions: sessions });
export const grantSubscription = (email: string, days: number, plan: string, note: string) =>
  rpc("qb_admin_grant_subscription_email", { p_email: email, p_days: days, p_plan: plan, p_note: note });
export const revokeSubscription = (id: string, note: string) => rpc("qb_admin_revoke_subscription", { p_id: id, p_note: note });

export type LoadBatch = { id: string; file_name: string; status: string; rows_total: number; rows_loaded: number; rows_rejected: number; created_at: string };
export type BatchApproval = { id: string; batch_id: string; status: string; questions_approved: number; questions_skipped: number; sample_reviewed: number; note: string; created_at: string; revoked_at: string | null };
export type SampleQuestion = { id: string; question: string; a: string | null; b: string | null; c: string | null; d: string | null; correct: string; difficulty: string | null };
export type BatchPreview = { batch_id: string; file: string; batch_status: string; questions_found: number; by_state: Record<string, number>; would_approve: number;
  already_available_to_learners: number; min_sample_required: number; sample: SampleQuestion[] };

export async function listLoadBatches(): Promise<LoadBatch[]> {
  const { data, error } = await getSupabaseBrowserClient().from("question_load_batches")
    .select("id,file_name,status,rows_total,rows_loaded,rows_rejected,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(userFacingError(error));
  return (data ?? []) as LoadBatch[];
}
export async function listBatchApprovals(): Promise<BatchApproval[]> {
  const { data, error } = await getSupabaseBrowserClient().from("question_batch_approvals")
    .select("id,batch_id,status,questions_approved,questions_skipped,sample_reviewed,note,created_at,revoked_at").order("created_at", { ascending: false }).limit(200);
  if (error) return [];   // the approvals table arrives with migration 20261014110000; before that, nothing is approved
  return (data ?? []) as BatchApproval[];
}
export const previewBatch = (batchId: string) => rpc<BatchPreview>("qb_owner_batch_preview", { p_batch: batchId });
export const approveBatch = (batchId: string, note: string, sampleRead: number) =>
  rpc<{ approval_id: string; questions_found: number; approved: number; skipped: number; published: boolean }>("qb_owner_approve_batch", { p_batch: batchId, p_note: note, p_sample_reviewed: sampleRead, p_publish: true });
export const revokeBatchApproval = (approvalId: string, note: string) => rpc<{ returned_to_review: number }>("qb_owner_revoke_batch_approval", { p_approval: approvalId, p_note: note });
