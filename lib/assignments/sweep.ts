import type { SupabaseClient } from "@supabase/supabase-js";

export type AssignmentSweepCounts = { published: number; skipped: number; missed: number; reminded: number; failed: number };

// One pass of the weekly-repeat runner and the due-soon reminders. Both are closed in the database until flags.repeat_assignments is on, so this is
// safe to call on every cron tick. The two parts do not depend on each other: if one fails the other still runs. Returns counts only.
export async function runAssignmentSweep(svc: SupabaseClient): Promise<AssignmentSweepCounts> {
  const out: AssignmentSweepCounts = { published: 0, skipped: 0, missed: 0, reminded: 0, failed: 0 };
  const run = await svc.rpc("qb_schedules_run", { p_limit: 50 });
  if (run.error) out.failed += 1;
  else if (run.data && typeof run.data === "object") {
    const d = run.data as { published?: number; skipped?: number; missed?: number };
    out.published = Number(d.published) || 0; out.skipped = Number(d.skipped) || 0; out.missed = Number(d.missed) || 0;
  }
  const rem = await svc.rpc("qb_assignment_reminders_run");
  if (rem.error) out.failed += 1;
  else if (rem.data && typeof rem.data === "object") out.reminded = Number((rem.data as { reminders?: number }).reminders) || 0;
  return out;
}
