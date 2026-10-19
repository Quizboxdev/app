import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import type { AttemptResult, EditableQuestion, LeaderRow, MyCampaign, StartedAttempt } from "@/lib/challenges/types";

// Participants and creators call the database functions directly; every rule (who may create, one scored submission, locked after going live) is enforced there.
const CODES: Record<string, string> = {
  NOT_AUTHORIZED: "You need to sign in with an account that can do this. Accounts for young learners cannot join challenges.",
  CHALLENGE_NOT_LIVE: "This challenge is not open right now.", WRONG_CODE: "That access code is not right.", NO_ATTEMPTS_LEFT: "You have used all your attempts.",
  RATE_LIMITED: "Too many tries. Please wait a little and try again.", NOT_ENOUGH_QUESTIONS: "Add enough questions before publishing.", ONLY_DRAFT_EDITABLE: "Questions and rules are locked once a challenge has gone live.",
  INVALID_TRANSITION: "That change is not allowed from the current status.", INVALID_QUESTIONS: "Every question needs 2 to 4 options and a correct answer.", ENDS_IN_THE_PAST: "The end date has already passed.",
};
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(fn, args);
  if (error) { const code = Object.keys(CODES).find((c) => error.message?.includes(c)); throw new Error(code ? CODES[code] : userFacingError(error)); }
  return data as T;
}
export const createChallenge = (a: { title: string; summary: string; category: string; visibility: string; questionCount: number; timeLimitSeconds: number; maxAttempts: number; startsAt?: string | null; endsAt?: string | null; rewardText?: string; accessCode?: string }) =>
  call<{ id: string; slug: string }>("challenge_create", { p_title: a.title, p_summary: a.summary, p_category: a.category, p_visibility: a.visibility, p_question_count: a.questionCount, p_time_limit_seconds: a.timeLimitSeconds, p_max_attempts: a.maxAttempts, p_starts_at: a.startsAt || null, p_ends_at: a.endsAt || null, p_reward_text: a.rewardText || null, p_access_code: a.accessCode || null });
export const myCampaigns = () => call<MyCampaign[]>("challenge_my_campaigns");
export const getCampaignForEdit = (id: string) => call<{ campaign: Record<string, any>; questions: EditableQuestion[] }>("challenge_creator_get", { p_id: id });
export const updateCampaign = (id: string, patch: Record<string, unknown>) => call<{ ok: true }>("challenge_update", { p_id: id, p_patch: patch });
export const setQuestions = (id: string, questions: EditableQuestion[]) => call<{ ok: true; count: number }>("challenge_set_questions", { p_id: id, p_questions: questions.map(({ question_text, options, correct_index, explanation }) => ({ question_text, options, correct_index, explanation })) });
export const pullBank = (id: string, subjectCode: string, grade: string | null, count: number) => call<{ added: number; total: number }>("challenge_pull_bank", { p_id: id, p_subject_code: subjectCode, p_grade: grade, p_count: count });
export const publishCampaign = (id: string) => call<{ ok: true; slug: string }>("challenge_publish", { p_id: id });
export const setCampaignStatus = (id: string, status: "PAUSED" | "COMPLETED" | "ARCHIVED") => call<{ ok: true }>("challenge_set_status", { p_id: id, p_status: status });
export const startChallenge = (slug: string, code?: string) => call<StartedAttempt>("challenge_start", { p_slug: slug, p_code: code || null });
export const submitChallenge = (attempt: string, answers: { question_id: string; chosen_index: number | null }[]) => call<AttemptResult>("challenge_submit", { p_attempt: attempt, p_answers: answers });
export const getLeaderboard = (slug: string) => call<LeaderRow[]>("challenge_leaderboard", { p_slug: slug, p_limit: 50 });
export const myAttempts = () => call<{ slug: string; title: string; attempt_no: number; score: number | null; max_score: number | null; duration_ms: number | null; started_at: string; submitted_at: string | null; expired: boolean }[]>("challenge_my_attempts");
