import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

// Owner tools for under-13 data: find a learner for a guardian's written request, list ended accounts past the 12-month retention period, and erase.
const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(userFacingError(error));
  return data as T;
};
export type FoundLearner = { user_id: string; first_name: string; username: string; school?: string | null; status: string; erased: boolean };
export type QueuedLearner = { user_id: string; first_name: string; username: string; ended_at: string };
export const findManagedLearner = (username: string) => rpc<FoundLearner[]>("qb_managed_learner_find", { p_username: username });
export const erasureQueue = () => rpc<QueuedLearner[]>("qb_managed_erasure_queue");

export async function eraseManagedLearner(learnerId: string, reason: string): Promise<{ ok: true; already: boolean }> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session?.access_token) throw new Error("Please sign in again.");
  const res = await fetch("/api/admin/managed-learners/erase", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ learnerId, reason }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof out?.error === "string" ? out.error : "Could not erase. Please try again.");
  return out;
}
