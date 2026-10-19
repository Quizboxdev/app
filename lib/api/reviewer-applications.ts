import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

// Reviewer applications. Teachers apply here; support staff and the owner decide. Every rule (who may apply, who may grant which rights) lives in the database.
const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(userFacingError(error));
  return data as T;
};

export type MyApplication = { status: "none" | "pending" | "approved" | "declined" | "suspended"; note?: string | null; decided_at?: string | null; can_reapply_after?: string | null;
  requested?: { subject_code: string; education_levels?: string[] }[]; qualifications?: string; years_experience?: number };
export const getMyApplication = () => rpc<MyApplication>("qb_my_reviewer_application");
export const applyAsReviewer = (a: { qualifications: string; years_experience: number; subjects: string[]; education_levels: string[] }) => rpc("qb_apply_reviewer", { p: a });

export type RequestedDomain = { subject_code: string; market_id?: string | null; education_levels?: string[] };
export type Application = { user_id: string; name: string; email: string; school: string | null; status: "pending" | "verified" | "suspended"; qualifications: string; years_experience: number;
  requested: RequestedDomain[]; applied_at: string; decision_note: string | null; decided_at: string | null; domains: number };
export const listApplications = (status: "pending" | "verified" | "suspended" | "all" = "pending") => rpc<Application[]>("qb_reviewer_applications", { p_status: status });

export type DomainGrant = { subject_code: string; market_id?: string | null; education_level?: string | null; grade_codes?: string[]; can_approve?: boolean; can_senior_review?: boolean };
export const decideApplication = (userId: string, decision: "approve" | "decline", note: string, domains: DomainGrant[] = []) =>
  rpc<{ decision: string; domains_granted: number }>("qb_reviewer_application_decide", { p_user: userId, p_decision: decision, p_note: note, p_domains: domains });
