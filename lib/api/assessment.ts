import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AttemptPayload } from "@/lib/types";

function unwrapRpc<T>(data: T | null, error: any): T {
  if (error) throw error;
  if (data == null) throw new Error("EMPTY_RPC_RESPONSE");
  return data;
}

export async function listAvailableAssessments() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc(
    "qb_list_available_assessments"
  );

  if (error) throw error;
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

  const { data, error } = await supabase.rpc("qb_submit_attempt", {
    p_attempt_id: attemptId,
    p_submission_reason: reason,
  });

  return unwrapRpc<any>(data, error);
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
