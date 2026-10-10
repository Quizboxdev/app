import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PoolFee = { currency: string; review: number; approve: number; revision: number; reject: number };
export type PoolGroup = { subject: string; grade: string; level: string | null; sponsor: boolean; count: number; fee: PoolFee | null };
export type PoolHeld = { assignment_id: string; question_id: string; subject: string; grade: string; topic: string | null; assigned_at: string; return_at: string | null; started: boolean; from_pool: boolean };
export type Pool = {
  settings: { pick_size: number; daily_cap: number; max_open: number; release_hours: number };
  today: { picked: number; completed: number; open: number; remaining_today: number; room_to_hold: number; earned: Record<string, string> };
  available: { total: number; without_fee: number; capped: boolean; groups: PoolGroup[] };
  mine: PoolHeld[];
};
export type PickResult = { picked: number; assignment_ids: string[]; reason: "DAILY_CAP_REACHED" | "OPEN_QUEUE_FULL" | "POOL_EMPTY" | null; remaining_today: number; room_to_hold: number };

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw error;
  return data as T;
}
export const getPool = () => call<Pool>("qb_sme_pool");
export const pickQuestions = (count: number, subject?: string, grade?: string) => call<PickResult>("qb_sme_pick", { p_count: count, p_subject: subject ?? null, p_grade: grade ?? null });
export const releasePick = (assignment: string, reason?: string) => call<{ released: string }>("qb_sme_release", { p_assignment: assignment, p_reason: reason ?? null });
