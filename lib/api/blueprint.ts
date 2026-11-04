import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { describeErrorMessage } from "@/lib/errors";
import type { ApiSection } from "@/lib/learning/blueprint";

export type PlannedTopic = { topic_id: string; title: string; share: number; available: number; easy: number; medium: number; hard: number };
export type PlannedSection = { position: number; subject: string; quota: number; topics: PlannedTopic[] };
export type BlueprintPlan = { total: number; sections: PlannedSection[] };

// Keeps the server's detail (which topic or subject is short) in the message; the code is turned into plain language.
async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(name, args);
  if (error) throw new Error(describeErrorMessage(error.message));
  return data as T;
}

export const previewBlueprint = (classId: string, sections: ApiSection[], difficulty?: string) =>
  call<BlueprintPlan>("qb_blueprint_plan", { p_class_id: classId, p_sections: sections, p_difficulty: difficulty || null });

export const publishBlueprint = (args: {
  classId: string; title: string; description: string; sections: ApiSection[]; difficulty?: string; mode: "PRACTICE" | "ASSESSMENT";
  attempts: number; minutes: number; startAt?: string; dueAt?: string; targetStudentIds?: string[];
}) => call<{ assignment_id: string; sections: PlannedSection[] }>("qb_publish_blueprint_assignment", {
  p_class_id: args.classId, p_title: args.title, p_description: args.description, p_sections: args.sections, p_difficulty: args.difficulty || null,
  p_mode: args.mode, p_attempts_allowed: args.attempts, p_time_limit_minutes: args.minutes, p_start_at: args.startAt ?? new Date().toISOString(),
  p_due_at: args.dueAt || null, p_target_student_ids: args.targetStudentIds?.length ? args.targetStudentIds : null,
});

export type BreakdownTopic = { topic_id: string; title: string; total: number; correct: number; percent: number };
export type BreakdownSubject = { subject: string; position: number | null; total: number; correct: number; percent: number; topics: BreakdownTopic[] };
export type AttemptBreakdown = { attempt_id: string; subjects: BreakdownSubject[]; weakest: Array<{ subject: string; topic_id: string; title: string; correct: number; total: number; percent: number }> };

export const getAttemptBreakdown = (attemptId: string) => call<AttemptBreakdown>("qb_attempt_breakdown", { p_attempt: attemptId });
