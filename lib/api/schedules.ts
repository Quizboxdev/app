import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { describeErrorMessage } from "@/lib/errors";
import type { ApiSection } from "@/lib/learning/blueprint";

export type Schedule = {
  id: string; class_id: string; class_name: string; title: string; mode: "PRACTICE" | "ASSESSMENT"; subjects: string[]; total: number;
  publish_dow: number; publish_time: string; due_after_days: number; active: boolean; next_run_at: string; last_run_at: string | null;
  last_status: "PUBLISHED" | "SKIPPED" | "MISSED" | null; last_error: string | null; runs: number;
};

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
// ISO weekday (1 = Monday) from a JavaScript Date (0 = Sunday).
export const isoWeekday = (d: Date) => (d.getDay() === 0 ? 7 : d.getDay());

// Keeps the server's detail (which topic is short) in the message; the code is turned into plain language.
async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(describeErrorMessage(error.message));
  return data as T;
}

export const createSchedule = (a: {
  classId: string; title: string; description: string; sections: ApiSection[]; difficulty?: string; mode: "PRACTICE" | "ASSESSMENT";
  attempts: number; minutes: number; weekday: number; time: string; dueAfterDays: number;
}) => call<{ id: string; next_run_at: string }>("qb_schedule_create", {
  p_class_id: a.classId, p_title: a.title, p_description: a.description, p_sections: a.sections, p_difficulty: a.difficulty || null, p_mode: a.mode,
  p_attempts_allowed: a.attempts, p_time_limit_minutes: a.minutes, p_publish_dow: a.weekday, p_publish_time: a.time, p_due_after_days: a.dueAfterDays,
});
export const listSchedules = () => call<Schedule[]>("qb_schedule_list");
export const setScheduleActive = (id: string, active: boolean) => call<void>("qb_schedule_set_active", { p_id: id, p_active: active });
export const deleteSchedule = (id: string) => call<void>("qb_schedule_delete", { p_id: id });
