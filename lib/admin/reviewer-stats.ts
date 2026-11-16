import type { Application } from "@/lib/api/reviewer-applications";

// Figures for the Reviewer applications screen, worked out in the browser from the list the database already returns (applications are few, so no extra database call is needed).
export type ReviewerStats = {
  waiting: number; approved: number; declined: number; total: number;
  oldestWaitingDays: number | null; medianDecisionDays: number | null; thisWeek: number; lastWeek: number;
  weekly: { week: string; applied: number; decided: number }[];
  subjects: { subject: string; n: number }[];
};

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
// Monday (UTC) of the week a time falls in.
export function weekStart(t: Date | string | number): string {
  const d = new Date(t); const u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  u.setUTCDate(u.getUTCDate() - ((u.getUTCDay() + 6) % 7)); return isoDay(u);
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function reviewerStats(apps: Application[], now: Date = new Date(), weeks = 12): ReviewerStats {
  const waitingApps = apps.filter((a) => a.status === "pending");
  const decided = apps.filter((a) => a.status !== "pending" && a.decided_at);
  const thisW = weekStart(now), lastW = weekStart(new Date(new Date(thisW).getTime() - 7 * DAY));
  const series = Array.from({ length: weeks }, (_, i) => weekStart(new Date(new Date(thisW).getTime() - (weeks - 1 - i) * 7 * DAY)));
  const applied = new Map<string, number>(), done = new Map<string, number>();
  for (const a of apps) { const w = weekStart(a.applied_at); applied.set(w, (applied.get(w) ?? 0) + 1); }
  for (const a of decided) { const w = weekStart(a.decided_at as string); done.set(w, (done.get(w) ?? 0) + 1); }
  const subj = new Map<string, number>();
  for (const a of apps) for (const r of a.requested ?? []) { const k = (r.subject_code ?? "").trim(); if (k) subj.set(k, (subj.get(k) ?? 0) + 1); }
  const waits = waitingApps.map((a) => Math.floor((now.getTime() - new Date(a.applied_at).getTime()) / DAY));
  return {
    waiting: waitingApps.length, approved: apps.filter((a) => a.status === "verified").length, declined: apps.filter((a) => a.status === "suspended").length, total: apps.length,
    oldestWaitingDays: waits.length ? Math.max(...waits) : null,
    medianDecisionDays: median(decided.map((a) => Math.max(0, (new Date(a.decided_at as string).getTime() - new Date(a.applied_at).getTime()) / DAY))),
    thisWeek: applied.get(thisW) ?? 0, lastWeek: applied.get(lastW) ?? 0,
    weekly: series.map((w) => ({ week: w, applied: applied.get(w) ?? 0, decided: done.get(w) ?? 0 })),
    subjects: [...subj.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([subject, n]) => ({ subject, n })),
  };
}

export const daysText = (d: number | null) => (d === null ? "—" : d < 1 ? "under a day" : d < 10 ? `${(Math.round(d * 10) / 10).toString().replace(/\.0$/, "")} days` : `${Math.round(d)} days`);
