import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AttemptPayload } from "@/lib/types";
import type { PracticeFeedback } from "@/lib/learning/feedback";
import { userFacingError } from "@/lib/errors";
import { recordFailure } from "@/lib/api/operations";

function unwrapRpc<T>(data: T | null, error: any): T {
  if (error) throw new Error(userFacingError(error));
  if (data == null) throw new Error("EMPTY_RPC_RESPONSE");
  return data;
}

export async function listAvailableAssessments() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(
    "qb_list_available_assessments"
  );

  if (error) throw new Error(userFacingError(error));
  return data ?? [];
}

export async function startAttempt(args: {
  assessmentId: string;
  assignmentId?: string | null;
  classId?: string | null;
}) {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase.rpc("qb_start_attempt", {
    p_assessment_id: args.assessmentId,
    p_assignment_id: args.assignmentId ?? null,
    p_class_id: args.classId ?? null,
    p_client_session_id: crypto.randomUUID(),
  });

  return unwrapRpc<any>(data, error);
}

export async function getAttempt(attemptId: string) {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase.rpc("qb_get_attempt", {
    p_attempt_id: attemptId,
  });

  return unwrapRpc<AttemptPayload>(data, error);
}

export async function getAttemptMode(attemptId: string) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_attempt_mode", { p_attempt_id: attemptId });
  return unwrapRpc<string>(data, error);
}

export async function savePracticeResponse(args: { attemptId: string; questionId: string; selectedAnswer?: string | null; selectedValue?: unknown }) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_save_practice_response", {
    p_attempt_id: args.attemptId, p_question_id: args.questionId,
    p_selected_answer: args.selectedAnswer ?? null, p_selected_value: args.selectedValue ?? null,
  });
  return unwrapRpc<PracticeFeedback>(data, error);
}

export async function saveResponse(args: {
  attemptId: string;
  questionId: string;
  selectedAnswer?: string | null;
  selectedValue?: unknown;
  responseSeconds?: number;
}) {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase.rpc("qb_save_response", {
    p_attempt_id: args.attemptId,
    p_question_id: args.questionId,
    p_selected_answer: args.selectedAnswer ?? null,
    p_selected_value: args.selectedValue ?? null,
    p_response_seconds: args.responseSeconds ?? 0,
  });

  return unwrapRpc<any>(data, error);
}

export async function submitAttempt(
  attemptId: string,
  reason: string = "student_submit"
) {
  const supabase = getSupabaseBrowserClient();

  const { data, error } = await supabase.rpc("qb_complete_attempt", {
    p_attempt_id: attemptId,
    p_submission_reason: reason,
  });

  if(error) await recordFailure("ATTEMPT_COMPLETION",error).catch(()=>undefined);
  return unwrapRpc<any>(data, error);
}

export async function getAttemptLearningSummary(attemptId: string) {
  const supabase = getSupabaseBrowserClient();
  const [result, events, xp] = await Promise.all([
    getResult(attemptId),
    supabase.from("learning_events").select("is_correct,curriculum_node_id,curriculum_nodes(code,title)").eq("attempt_id", attemptId),
    supabase.from("xp_transactions").select("points,reason").eq("attempt_id", attemptId),
  ]);
  if (events.error) throw events.error;
  if (xp.error) throw xp.error;
  const byIndicator = new Map<string, { code: string; title: string; correct: number; total: number }>();
  for (const row of events.data ?? []) {
    const node: any = Array.isArray(row.curriculum_nodes) ? row.curriculum_nodes[0] : row.curriculum_nodes;
    const key = row.curriculum_node_id ?? "unmapped";
    const current = byIndicator.get(key) ?? { code: node?.code ?? "Unmapped", title: node?.title ?? "Unmapped curriculum", correct: 0, total: 0 };
    current.total += 1; if (row.is_correct) current.correct += 1; byIndicator.set(key, current);
  }
  return { result, indicators: [...byIndicator.values()].map((row) => ({ ...row, percentage: row.total ? row.correct / row.total * 100 : 0 })), xpEarned: (xp.data ?? []).reduce((sum, row) => sum + Number(row.points), 0) };
}

export async function getResult(attemptId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_get_result", {
    p_attempt_id: attemptId,
  });
  return unwrapRpc<any>(data, error);
}

export async function getAttemptReview(attemptId: string) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_get_attempt_review", {
    p_attempt_id: attemptId,
  });
  return unwrapRpc<any>(data, error);
}

export async function getMyResults(limit = 50) {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc("qb_my_results", {
    p_limit: limit,
  });
  return unwrapRpc<any[]>(data, error);
}

export async function getMyResultsPage(page = 1) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_my_results_page", { p_page: page, p_limit: 25 });
  return unwrapRpc<{ rows: any[]; total: number }>(data, error);
}

export async function getMyAttemptsPage(page = 1) {
  const { data, error } = await getSupabaseBrowserClient().rpc("qb_my_attempts_page", { p_page: page, p_limit: 25 });
  return unwrapRpc<{ rows: any[]; total: number }>(data, error);
}
