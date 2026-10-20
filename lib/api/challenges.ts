import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { userFacingError } from "@/lib/errors";
import type { Analytics, AttemptResult, Award, Brand, Format, ContentAsset, EditableQuestion, LeaderRow, MyCampaign, Passage, Prize, StageInfo, StageProgress, StartedAttempt } from "@/lib/challenges/types";

// Participants and creators call the database functions directly; every rule (who may create, one scored submission, locked after going live) is enforced there.
const CODES: Record<string, string> = {
  NOT_AUTHORIZED: "You need to sign in with an account that can do this. Accounts for young learners cannot join challenges.",
  CHALLENGE_NOT_LIVE: "This challenge is not open right now.", WRONG_CODE: "That access code is not right.", NO_ATTEMPTS_LEFT: "You have used all your attempts.",
  RATE_LIMITED: "Too many tries. Please wait a little and try again.", NOT_ENOUGH_QUESTIONS: "Add enough questions before publishing.", ONLY_DRAFT_EDITABLE: "Questions and rules are locked once a challenge has gone live.",
  INVALID_TRANSITION: "That change is not allowed from the current status.", INVALID_QUESTIONS: "Every question needs 2 to 4 options and a correct answer.", ENDS_IN_THE_PAST: "The end date has already passed.",
  STAGE_LOCKED: "Reach the pass mark in the previous round to unlock this one.", STAGE_NOT_OPEN: "This round has not opened yet.", STAGE_CLOSED: "This round has closed.",
  QUOTE_NOT_IN_SOURCE: "A source quote is not word for word in the passage you chose.", INVALID_SOURCE: "A question points to a passage that is not in this challenge.", NOT_GROUNDED: "Every question in a book challenge needs a passage and a quote from it.",
  RIGHTS_NOT_CONFIRMED: "Please confirm you have the right to use this material.", INVALID_STAGES: "Add between 1 and 6 rounds.", INVALID_PRIZES: "Check the prize ranks and names.", TAKEN_DOWN: "This challenge was taken down after a review and cannot be published.", NOT_FOUND: "That challenge could not be found.",
  NOT_IN_AUDIENCE: "This is only open to the class or school it was made for.", ROUND_STILL_RUNNING: "The previous round is still running. The next round opens when it closes.", NOT_THROUGH: "You did not make it through to this round. Well done for taking part.",
  CHALLENGE_SINGLE_ROUND: "A challenge has one round. Make a competition if you want rounds.", INVALID_AUDIENCE: "Choose either a class or a school, not both.", INVALID_FORMAT: "Choose challenge or competition.",
  QB_FREE_ALLOWANCE_EXHAUSTED: "Your free practice is used up. Subscribe to keep joining challenges and competitions.",
  INVALID_BRAND: "Check the colour (like #1a7f5a) and the lengths of the texts.",
};
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabaseBrowserClient().rpc(fn, args);
  if (error) { const code = Object.keys(CODES).find((c) => error.message?.includes(c)); throw new Error(code ? CODES[code] : userFacingError(error)); }
  return data as T;
}
export const createChallenge = (a: { title: string; summary: string; category: string; visibility: string; questionCount: number; timeLimitSeconds: number; maxAttempts: number; startsAt?: string | null; endsAt?: string | null; rewardText?: string; accessCode?: string; format?: Format }) =>
  call<{ id: string; slug: string; format: Format }>("challenge_create", { p_format: a.format ?? "CHALLENGE", p_title: a.title, p_summary: a.summary, p_category: a.category, p_visibility: a.visibility, p_question_count: a.questionCount, p_time_limit_seconds: a.timeLimitSeconds, p_max_attempts: a.maxAttempts, p_starts_at: a.startsAt || null, p_ends_at: a.endsAt || null, p_reward_text: a.rewardText || null, p_access_code: a.accessCode || null });
export const myCampaigns = () => call<MyCampaign[]>("challenge_my_campaigns");
export const getCampaignForEdit = (id: string) => call<{ campaign: Record<string, any>; questions: EditableQuestion[]; stages: StageInfo[]; prizes: Prize[] }>("challenge_creator_get", { p_id: id });
export const updateCampaign = (id: string, patch: Record<string, unknown>) => call<{ ok: true }>("challenge_update", { p_id: id, p_patch: patch });
export const setQuestions = (id: string, questions: EditableQuestion[]) => call<{ ok: true; count: number }>("challenge_set_questions", { p_id: id, p_questions: questions.map(({ question_text, options, correct_index, explanation, stage_no, source_chunk_id, source_quote }) => ({ question_text, options, correct_index, explanation, stage_no: stage_no ?? 1, source_chunk_id: source_chunk_id ?? null, source_quote: source_quote ?? null })) });
export const pullBank = (id: string, subjectCode: string, grade: string | null, count: number, stage = 1) => call<{ added: number; total: number }>("challenge_pull_bank", { p_id: id, p_subject_code: subjectCode, p_grade: grade, p_count: count, p_stage: stage });
export const publishCampaign = (id: string) => call<{ ok: true; slug: string }>("challenge_publish", { p_id: id });
export const setCampaignStatus = (id: string, status: "PAUSED" | "COMPLETED" | "ARCHIVED") => call<{ ok: true }>("challenge_set_status", { p_id: id, p_status: status });
export const startChallenge = (slug: string, code?: string, stage = 1) => call<StartedAttempt>("challenge_start", { p_slug: slug, p_code: code || null, p_stage: stage });
export const submitChallenge = (attempt: string, answers: { question_id: string; chosen_index: number | null }[]) => call<AttemptResult>("challenge_submit", { p_attempt: attempt, p_answers: answers });
export const getLeaderboard = (slug: string) => call<LeaderRow[]>("challenge_leaderboard", { p_slug: slug, p_limit: 50 });
export const myAttempts = () => call<{ slug: string; title: string; attempt_no: number; score: number | null; max_score: number | null; duration_ms: number | null; started_at: string; submitted_at: string | null; expired: boolean }[]>("challenge_my_attempts");

export const setStages = (id: string, stages: { title: string; question_count: number; time_limit_seconds: number; pass_percent: number; advance_top_n?: number | null; starts_at?: string | null; ends_at?: string | null }[]) => call<{ ok: true; stages: number }>("challenge_set_stages", { p_id: id, p_stages: stages });
export const myAudiences = () => call<{ classes: { id: string; name: string }[]; institutions: { id: string; name: string }[] }>("challenge_my_audiences");
export const setAudience = (id: string, target: { classId?: string | null; institutionId?: string | null }) => call<{ ok: true }>("challenge_set_audience", { p_id: id, p_class: target.classId ?? null, p_institution: target.institutionId ?? null });
export const openCompetitions = (format: Format = "COMPETITION") => call<import("@/lib/challenges/types").PublicChallenge[]>("challenge_public_list", { p_limit: 24, p_offset: 0, p_format: format });
export const myProgress = (slug: string) => call<StageProgress[]>("challenge_my_progress", { p_slug: slug });
export const contentList = (campaign: string) => call<ContentAsset[]>("challenge_content_list", { p_campaign: campaign });
export const contentChunks = (campaign: string, version: string, offset = 0) => call<Passage[]>("challenge_content_chunks", { p_campaign: campaign, p_version: version, p_limit: 50, p_offset: offset });
export const setPrizes = (id: string, prizes: Prize[]) => call<{ ok: true; count: number }>("challenge_set_prizes", { p_id: id, p_prizes: prizes });
export const finalizeChallenge = (id: string) => call<{ ok: true; awards?: number; already_finalized?: boolean }>("challenge_finalize", { p_id: id });
export const awardsList = (id: string) => call<Award[]>("challenge_awards_list", { p_id: id });
export const updateAward = (award: string, status: string, note?: string) => call<{ ok: true }>("challenge_award_update", { p_award: award, p_status: status, p_note: note || null });
export const myAwards = () => call<{ campaign: string; slug: string; rank: number; prize: string; details: string | null; status: string; updated_at: string }[]>("challenge_my_awards");
export const setBrand = (id: string, brand: Brand) => call<{ ok: true; brand: Brand }>("challenge_set_brand", { p_id: id, p_brand: brand });
export const getAnalytics = (id: string) => call<Analytics>("challenge_analytics", { p_id: id });
export const adminOverview = () => call<{ campaigns: Record<string, number>; attempts_30d: number; players_30d: number; awards_pending: number; top: { slug: string; title: string; status: string; players: number }[] }>("challenge_admin_overview");

// Uploading a book goes through a server route (it extracts the text); everything else is a direct database call.
export async function uploadContent(a: { campaignId: string; title: string; kind: string; assetId?: string; file?: File | null; text?: string }): Promise<{ asset_id: string; version: number; passages: number }> {
  const { data } = await getSupabaseBrowserClient().auth.getSession();
  if (!data.session?.access_token) throw new Error("Please sign in again.");
  const form = new FormData();
  form.set("campaignId", a.campaignId); form.set("title", a.title); form.set("kind", a.kind); form.set("rights", "true");
  if (a.assetId) form.set("assetId", a.assetId);
  if (a.file) form.set("file", a.file); else form.set("text", a.text ?? "");
  const res = await fetch("/api/challenges/content", { method: "POST", headers: { Authorization: `Bearer ${data.session.access_token}` }, body: form });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out?.ok) throw new Error(typeof out?.error === "string" ? out.error : "The upload failed. Please try again.");
  return out;
}

export type ReportReason = "inappropriate" | "misleading" | "copyright" | "spam" | "wrong_answers" | "other";
export const reportChallenge = (slug: string, reason: ReportReason, details?: string) => call<{ ok: true }>("challenge_report", { p_slug: slug, p_reason: reason, p_details: details || null });
export type ChallengeReport = { id: string; reason: ReportReason; details: string | null; status: string; created_at: string; handled_note: string | null; campaign_id: string; slug: string; title: string; campaign_status: string; moderation_state: "OK" | "UNDER_REVIEW" | "TAKEN_DOWN"; owner_name: string | null; open_reports: number };
export const listReports = (status = "OPEN") => call<ChallengeReport[]>("challenge_reports_list", { p_status: status });
export const resolveReport = (report: string, action: "DISMISS" | "TAKE_DOWN" | "RESTORE", note?: string) => call<{ ok: true }>("challenge_report_resolve", { p_report: report, p_action: action, p_note: note || null });
