import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

// Staff inbox for the public enquiry forms (super admin and support staff). Every rule lives in qb_admin_public_interest; these only call it.
export type InterestCategory = "SPONSOR" | "SME" | "SCHOOL" | "COUNTRY" | "CONTACT";
export type InterestStatus = "NEW" | "IN_REVIEW" | "CONTACTED" | "CLOSED" | "SPAM";
export type Enquiry = { id: string; category: InterestCategory; name: string; email: string; phone: string | null; country_name: string | null; organization: string | null;
  subject: string | null; message: string; metadata: Record<string, string>; status: InterestStatus; created_at: string; reviewed_at: string | null; review_note: string | null };

const call = async <T>(action: string, data: Record<string, unknown> = {}): Promise<T> => {
  const { data: out, error } = await getSupabaseBrowserClient().rpc("qb_admin_public_interest", { p_action: action, p_data: data });
  if (error) throw new Error(userFacingError(error));
  return out as T;
};
export const listEnquiries = (filter: { category?: string; status?: string } = {}) => call<Enquiry[]>("list", { ...filter, limit: 200 });
export const enquiryCounts = () => call<{ new: number; in_review: number; total: number }>("counts");
export const reviewEnquiry = (id: string, status: Exclude<InterestStatus, "NEW">, note: string) => call<{ ok: true }>("review", { id, status, note });
export const purgeEnquiries = () => call<{ deleted: number }>("purge");
