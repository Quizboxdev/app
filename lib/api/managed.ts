import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

// Teacher-managed learners under 13. Account creation, password reset and ending an account go through server routes (they need the service role);
// the roster is a direct database call that only the class's own teacher can make.
const token = async () => {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session?.access_token) throw new Error("Please sign in again.");
  return data.session.access_token;
};
async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok && !out?.created) throw new Error(typeof out?.error === "string" ? out.error : "Something went wrong. Please try again.");
  return out as T;
}

export type NewLearner = { first_name: string; username: string; password: string };
export type CreateResult = { ok: boolean; created: NewLearner[]; failed: { name: string; reason: string }[] };
export const createManagedLearners = (classId: string, names: string[], consentReference: string) =>
  post<CreateResult>("/api/teacher/learners", { classId, names, consentConfirmed: true, consentReference });
export const resetManagedPassword = (learnerId: string) => post<{ ok: true; password: string }>("/api/teacher/learners/reset", { learnerId });
export const archiveManagedLearner = (learnerId: string) => post<{ ok: true }>("/api/teacher/learners/archive", { learnerId });

export type ManagedLearner = { user_id: string; first_name: string; username: string; status: string; created_at: string; archived_at: string | null };
export async function listManagedLearners(classId: string): Promise<ManagedLearner[]> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_managed_learner_list", { p_class: classId });
  if (error) throw new Error(userFacingError(error));
  return (data ?? []) as ManagedLearner[];
}
