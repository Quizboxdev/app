import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type MyAccess = { gated: boolean; free_limit: number | null; used: number; remaining: number | null; subscribed: boolean; exhausted: boolean };
const OPEN: MyAccess = { gated: false, free_limit: null, used: 0, remaining: null, subscribed: false, exhausted: false };

// Where a learner stands on the free allowance. A failed lookup never blocks practice (the server still enforces the real limit).
export async function getMyAccess(): Promise<MyAccess> {
  try {
    const { data, error } = await getSupabaseBrowserClient().rpc("qb_my_access");
    if (error || !data) return OPEN;
    return { ...OPEN, ...(data as Partial<MyAccess>) };
  } catch { return OPEN; }
}

export const SUBSCRIBE_PATH = "/subscribe?reason=free_used";
// The server raises this code when the allowance is used up; the message may arrive wrapped, so match on the code.
export const isAllowanceExhausted = (e: unknown) => /QB_FREE_ALLOWANCE_EXHAUSTED|free practice is used up/i.test(String((e as { message?: string })?.message ?? e ?? ""));
