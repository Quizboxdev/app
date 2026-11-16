import type { AdminRow } from "@/lib/api/support";

// Figures for the Support requests screen, worked out in the browser from the queue the database already returns (the latest 200 requests).
export type SupportStats = {
  total: number; open: number; waiting: number; done: number; highOpen: number; oldestOpenDays: number | null; thisWeek: number; lastWeek: number;
  daily: { week: string; opened: number }[]; categories: { category: string; n: number }[];
};
const DAY = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function supportStats(rows: AdminRow[], now: Date = new Date(), days = 30): SupportStats {
  const t0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const byDay = new Map<string, number>();
  for (const r of rows) { const d = isoDay(new Date(r.created_at).getTime()); byDay.set(d, (byDay.get(d) ?? 0) + 1); }
  const age = (r: AdminRow) => Math.floor((now.getTime() - new Date(r.created_at).getTime()) / DAY);
  const open = rows.filter((r) => r.status === "open");
  const cats = new Map<string, number>(); for (const r of rows) cats.set(r.category, (cats.get(r.category) ?? 0) + 1);
  return {
    total: rows.length, open: open.length, waiting: rows.filter((r) => r.status === "waiting_for_user").length, done: rows.filter((r) => r.status === "resolved" || r.status === "closed").length,
    highOpen: open.filter((r) => r.priority === "high").length, oldestOpenDays: open.length ? Math.max(...open.map(age)) : null,
    thisWeek: rows.filter((r) => age(r) < 7).length, lastWeek: rows.filter((r) => age(r) >= 7 && age(r) < 14).length,
    daily: Array.from({ length: days }, (_, i) => { const d = isoDay(t0 - (days - 1 - i) * DAY); return { week: d, opened: byDay.get(d) ?? 0 }; }),
    categories: [...cats.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([category, n]) => ({ category, n })),
  };
}
