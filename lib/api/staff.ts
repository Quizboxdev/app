import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

// Staff access: a super admin gives a colleague connected workflows by email (see lib/staff/workflows.ts). Everything is enforced in the database.
export type StaffAccount = { user_id: string; email: string; full_name: string; role: string; status: string; is_super: boolean; workflows: string[] };
export type StaffMember = { user_id: string; email: string; full_name: string; role: string; status: string; workflows: string[]; since: string };
export type MyStaffAccess = { enabled: boolean; workflows: string[] };

const OFF = "Staff access is not switched on yet.";
const SAME = "Nothing is different from what this person already has, so nothing was saved.";

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) {
    const text = `${error.message ?? ""} ${(error as { code?: string }).code ?? ""}`;
    if (text.includes("QB_FEATURE_DISABLED")) throw new Error(OFF);
    if (text.includes("NOTHING_CHANGED")) throw new Error(SAME);
    throw new Error(userFacingError(error));
  }
  return data as T;
}

export const getMyStaffAccess = () => call<MyStaffAccess>("qb_my_staff_access");
export const listStaff = () => call<StaffMember[]>("qb_staff_list");
export const findStaff = (email: string) => call<StaffAccount>("qb_staff_find", { p_email: email });
export const setStaffAccess = (userId: string, workflows: string[]) => call<{ ok: true; user_id: string; workflows: string[] }>("qb_staff_set", { p_user: userId, p_workflows: workflows });
export const STAFF_OFF_MESSAGE = OFF;
