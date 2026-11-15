import { getSupabaseBrowserClient } from "@/lib/supabase/client";

// Admin dashboard figures (migration 20261077100000). One read-only call; each section is null when that part is not available on the environment.
export type Dash = {
  generated_at: string; days: number;
  users: { total: number; new_7d: number; new_prev_7d: number; by_role: Record<string, number>; signups: { week: string; added: number }[] } | null;
  learning: { attempts_7d: number; attempts_prev_7d: number; attempts_total: number; daily: { week: string; started: number; submitted: number }[] } | null;
  content: { live: number; in_review: number; by_class: { grade: string; live: number; in_review: number }[]; batches_waiting: number } | null;
  queues: { support_open: number; support_waiting_for_user: number; support_new_7d: number } | null;
  markets: Record<string, number> | null;
  schools: { listed: number; waiting: number } | null;
};

export async function getAdminDashboard(days = 30): Promise<Dash> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_admin_dashboard", { p_days: days });
  if (error) throw new Error(/QB_FORBIDDEN/.test(error.message ?? "") ? "Only staff can see the dashboard." : "The dashboard could not be loaded. Please try again.");
  return data as Dash;
}

// "+12% vs last week", "no change", or "new" when there was nothing the week before.
export function changeText(now: number, before: number, unit = "last week"): string {
  if (before === 0 && now === 0) return `no change vs ${unit}`;
  if (before === 0) return `new vs ${unit}`;
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? `no change vs ${unit}` : `${pct > 0 ? "+" : ""}${pct}% vs ${unit}`;
}

// Classes in teaching order (Primary, JHS, SHS), then anything else.
const ORDER = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "SHS1", "SHS2", "SHS3"];
export const sortClasses = <T extends { grade: string }>(rows: T[]): T[] => [...rows].sort((a, b) => (ORDER.indexOf(a.grade) + 1 || 99) - (ORDER.indexOf(b.grade) + 1 || 99) || a.grade.localeCompare(b.grade));
