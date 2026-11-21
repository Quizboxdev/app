import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

export type SponsorToVerify = { id: string; organization_name: string | null; sponsor_type: string | null; contact_name: string | null; email: string | null; website: string | null; country: string | null; status: string; verification_status: string; verification_note: string | null; verified_at: string | null; created_at: string };
export type VerificationFilter = "PENDING" | "VERIFIED" | "REJECTED" | "ALL";

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(fn, args);
  if (error) throw new Error(userFacingError(error));
  return data as T;
}
export const sponsorQueue = (status: VerificationFilter) => call<SponsorToVerify[]>("qb_admin_sponsor_queue", { p_status: status });
export const decideSponsor = (id: string, decision: "VERIFIED" | "REJECTED" | "PENDING", note?: string) => call<{ id: string }>("qb_admin_sponsor_decide", { p_sponsor: id, p_decision: decision, p_note: note ?? null });
