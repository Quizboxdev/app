import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

export type PracticeTopic = { id: string; title: string; strand: string; available: number };
export type PracticeSubject = { id: string; name: string; subject_code: string | null; available: number; topics: PracticeTopic[] };
export type PracticeMenu = { grade: string; subjects: PracticeSubject[]; grades?: string[] };

// What the learner can practise: subjects of their own grade with topic names and counts. The curriculum hierarchy stays in the database.
export async function getPracticeMenu(grade?: string): Promise<PracticeMenu> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_practice_menu", grade ? { p_grade: grade } : {});
  if (error) throw new Error(userFacingError(error));
  const menu = data as PracticeMenu;
  return { grade: String(menu?.grade ?? ""), subjects: Array.isArray(menu?.subjects) ? menu.subjects : [], grades: Array.isArray(menu?.grades) ? menu.grades : undefined };
}

export async function buildQuickPractice(topicIds: string[], count: number, grade?: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_start_quick_practice", { p_topic_ids: topicIds, p_count: count, ...(grade ? { p_grade: grade } : {}) });
  if (error) throw new Error(userFacingError(error));
  return data as { assessment_id: string; subject: string; question_count: number; requested: number; short: boolean };
}

// The counts a learner can pick: 5, 10, 15, 20 and 30, never more than the ticked topics can supply (a smaller option is offered instead).
export function countChoices(available: number): number[] {
  if (available < 3) return [];
  const steps = [5, 10, 15, 20, 30].filter((n) => n <= available);
  return steps.length ? steps : [Math.max(3, available)];
}
