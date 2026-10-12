import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";

export type PracticeTopic = { id: string; title: string; strand: string; available: number };
export type PracticeSubject = { id: string; name: string; subject_code: string | null; available: number; topics: PracticeTopic[] };
export type PracticeMenu = { grade: string; subjects: PracticeSubject[] };

// What the learner can practise: subjects of their own grade with topic names and counts. The curriculum hierarchy stays in the database.
export async function getPracticeMenu(): Promise<PracticeMenu> {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_practice_menu");
  if (error) throw new Error(userFacingError(error));
  const menu = data as PracticeMenu;
  return { grade: String(menu?.grade ?? ""), subjects: Array.isArray(menu?.subjects) ? menu.subjects : [] };
}

export async function buildQuickPractice(topicIds: string[], count: number) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_start_quick_practice", { p_topic_ids: topicIds, p_count: count });
  if (error) throw new Error(userFacingError(error));
  return data as { assessment_id: string; subject: string; question_count: number; requested: number; short: boolean };
}

// The counts a learner can pick: 5, 10, 15, 20 and 30, never more than the ticked topics can supply (a smaller option is offered instead).
export function countChoices(available: number): number[] {
  if (available < 3) return [];
  const steps = [5, 10, 15, 20, 30].filter((n) => n <= available);
  return steps.length ? steps : [Math.max(3, available)];
}
