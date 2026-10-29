// Pure helpers for the Student Home: today's goal, the day streak and what to do next. No data fetching here, so each rule is tested on its own.
export type ResultLike = { submitted_at?: string | null; percentage?: number | string | null; subject_code?: string | null };
export type AssignmentLike = { id?: string | number; assignment_id?: string; class_id?: string | null; assignments?: { assessment_id?: string; title?: string | null; due_at?: string | null; subject_code?: string | null } | null };

export const DAILY_GOAL_SESSIONS = 1;   // hypothetical default while the system is in development; one finished practice or assessment a day

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Finished sessions today against the goal.
export function todayGoal(results: ResultLike[], now = new Date(), goal = DAILY_GOAL_SESSIONS) {
  const today = dayKey(now);
  const done = results.filter((r) => r.submitted_at && dayKey(new Date(r.submitted_at)) === today).length;
  return { done, goal, pct: Math.min(100, Math.round((done / goal) * 100)), met: done >= goal };
}

// Consecutive days with at least one finished session, counting back from today (or from yesterday if today has none yet, so a streak is not
// lost before the day is over). Only the latest results are known, so `capped` says the count may be higher than shown.
export function dayStreak(results: ResultLike[], now = new Date(), knownLimit = 10) {
  const days = new Set(results.filter((r) => r.submitted_at).map((r) => dayKey(new Date(r.submitted_at!))));
  const cursor = new Date(now); cursor.setHours(12, 0, 0, 0);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(cursor))) { n += 1; cursor.setDate(cursor.getDate() - 1); }
  // The streak reached the oldest result we know about, so it may really be longer.
  const oldest = [...days].sort()[0];
  return { days: n, capped: results.length >= knownLimit && n > 0 && oldest !== undefined && dayKey(cursor) < oldest };
}

export type UpNext =
  | { kind: "assignment"; title: string; due: string | null; overdue: boolean; row: AssignmentLike }
  | { kind: "weak"; subjectCode: string; subjectName: string; percentage: number }
  | { kind: "start" };

// What to do next, in order: the assignment due soonest (overdue first), then the subject with the lowest score under 68%, then just start.
export function upNext(assignments: AssignmentLike[], subjects: { code: string; name: string; percentage: number }[], now = new Date()): UpNext {
  const due = assignments.filter((a) => a.assignments).map((a) => ({ a, t: a.assignments?.due_at ? new Date(a.assignments.due_at).getTime() : Number.POSITIVE_INFINITY }))
    .sort((x, y) => x.t - y.t)[0];
  if (due) return { kind: "assignment", title: String(due.a.assignments?.title ?? "Assignment"), due: due.a.assignments?.due_at ?? null, overdue: due.t < now.getTime(), row: due.a };
  const weakest = [...subjects].sort((a, b) => a.percentage - b.percentage)[0];
  if (weakest && weakest.percentage < 68) return { kind: "weak", subjectCode: weakest.code, subjectName: weakest.name, percentage: weakest.percentage };
  return { kind: "start" };
}
