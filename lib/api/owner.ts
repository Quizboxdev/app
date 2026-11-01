import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError, userFacingErrorWithDetail } from "@/lib/errors";
import { isMissingFunction, runSteps } from "@/lib/question-loading/steps";

// Owner (super admin) controls that used to need the SQL editor: the free allowance, manual subscriptions, and question-batch approval.
// Every rule is enforced by the database functions; these helpers only call them.
const STEP = 100;   // questions per database step: small enough to finish well inside the time limit, large enough that a big batch takes seconds

// A failure keeps the database's own code and text (for retrying and for reports) next to the plain sentence the screen shows.
const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw Object.assign(new Error(userFacingErrorWithDetail(error)), { code: error.code, rawMessage: error.message });
  return data as T;
};

export type Subscription = { id: string; email: string; name: string; plan: string; status: string; source: string; valid_from: string; valid_until: string; note: string | null; created_at: string };
export type AccessOverview = { free_limit: number | null; learners: number; subscribed_now: number; subscriptions: Subscription[] };
export const getAccessOverview = () => rpc<AccessOverview>("qb_admin_access_overview");
export const setFreeAllowance = (sessions: number | null) => rpc("qb_admin_set_free_allowance", { p_sessions: sessions });
export const grantSubscription = (email: string, days: number, plan: string, note: string) =>
  rpc("qb_admin_grant_subscription_email", { p_email: email, p_days: days, p_plan: plan, p_note: note });
export const revokeSubscription = (id: string, note: string) => rpc("qb_admin_revoke_subscription", { p_id: id, p_note: note });

export type LoadBatch = { id: string; file_name: string; status: string; rows_total: number; rows_loaded: number; rows_rejected: number; created_at: string; report?: Record<string, unknown> | null };
export type BatchApproval = { id: string; batch_id: string; status: string; questions_approved: number; questions_skipped: number; sample_reviewed: number; note: string; created_at: string; revoked_at: string | null; in_progress?: boolean };
export type SampleQuestion = { id: string; question: string; a: string | null; b: string | null; c: string | null; d: string | null; correct: string; difficulty: string | null };
export type BatchPreview = { batch_id: string; file: string; batch_status: string; questions_found: number; by_state: Record<string, number>; would_approve: number;
  already_available_to_learners: number; min_sample_required: number; sample: SampleQuestion[] };

export async function listLoadBatches(): Promise<LoadBatch[]> {
  const { data, error } = await getSupabaseBrowserClient().from("question_load_batches")
    .select("id,file_name,status,rows_total,rows_loaded,rows_rejected,created_at,report").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(userFacingError(error));
  return (data ?? []) as LoadBatch[];
}
export async function listBatchApprovals(): Promise<BatchApproval[]> {
  const table = () => getSupabaseBrowserClient().from("question_batch_approvals");
  const columns = "id,batch_id,status,questions_approved,questions_skipped,sample_reviewed,note,created_at,revoked_at";
  // in_progress arrives with migration 20261052100000; until then the list is read without it, so approved batches never look unapproved.
  let { data, error } = await table().select(`${columns},in_progress`).order("created_at", { ascending: false }).limit(200);
  if (error) ({ data, error } = await table().select(columns).order("created_at", { ascending: false }).limit(200));
  if (error) return [];   // the approvals table arrives with migration 20261014110000; before that, nothing is approved
  return (data ?? []) as unknown as BatchApproval[];
}
const NOT_INSTALLED = "The database change for this feature has not been applied yet (migration 20261052100000). Ask the developer to apply it, then try again.";
// Withdraw a batch that cannot be finished (stopped partway, failed, or not wanted) and free its file to be loaded again. Refused while the batch is live for learners.
// Runs in short steps; `onStep` receives how many questions have been withdrawn so far.
export async function discardBatch(batchId: string, note: string, onStep?: (withdrawnSoFar: number) => void): Promise<{ batch_id: string; withdrawn: number }> {
  let sofar = 0;
  try {
    const r = await runSteps(() => rpc<{ batch_id: string; done: boolean; withdrawn?: number; withdrawn_now?: number }>("qb_owner_batch_discard_step", { p_batch: batchId, p_note: note, p_limit: STEP }),
      { onStep: (x) => { sofar += x.withdrawn_now ?? 0; onStep?.(x.done ? (x.withdrawn ?? sofar) : sofar); } });
    return { batch_id: r.batch_id, withdrawn: r.withdrawn ?? sofar };
  } catch (e) { throw isMissingFunction(e) ? new Error(NOT_INSTALLED) : e; }
}
export const previewBatch = (batchId: string) => rpc<BatchPreview>("qb_owner_batch_preview", { p_batch: batchId });

type Approved = { approval_id: string; questions_found: number; approved: number; skipped: number; published: boolean };
// Approves in short steps; `onStep` receives how many questions are live so far. If the step function is not installed yet, the original single call is used.
export async function approveBatch(batchId: string, note: string, sampleRead: number, onStep?: (approvedSoFar: number) => void): Promise<Approved> {
  try {
    const r = await runSteps(() => rpc<Approved & { done: boolean }>("qb_owner_approve_batch_step", { p_batch: batchId, p_note: note, p_sample_reviewed: sampleRead, p_publish: true, p_limit: STEP }),
      { onStep: (x) => onStep?.(x.approved) });
    return r;
  } catch (e) {
    if (!isMissingFunction(e)) throw e;
    return rpc<Approved>("qb_owner_approve_batch", { p_batch: batchId, p_note: note, p_sample_reviewed: sampleRead, p_publish: true });
  }
}
// Finishes an approval that was started and cut off. It carries no note or sample: if no unfinished approval exists, the database refuses rather than approve without a review.
export const finishApproval = (batchId: string, onStep?: (approvedSoFar: number) => void) => approveBatch(batchId, "", 0, onStep);

export async function revokeBatchApproval(approvalId: string, note: string, onStep?: (returnedSoFar: number) => void): Promise<{ returned_to_review: number }> {
  try {
    return await runSteps(() => rpc<{ done: boolean; returned_to_review: number }>("qb_owner_revoke_batch_approval_step", { p_approval: approvalId, p_note: note, p_limit: STEP }),
      { onStep: (x) => onStep?.(x.returned_to_review) });
  } catch (e) {
    if (!isMissingFunction(e)) throw e;
    return rpc<{ returned_to_review: number }>("qb_owner_revoke_batch_approval", { p_approval: approvalId, p_note: note });
  }
}
