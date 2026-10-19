// Shapes returned by the Challenges database functions (supabase/migrations/20261021100000_challenges_foundation.sql).
export const CHALLENGE_CATEGORIES = [
  { id: "school", label: "School" },
  { id: "book", label: "Book or reading" },
  { id: "general_knowledge", label: "General knowledge" },
  { id: "curriculum", label: "Curriculum revision" },
  { id: "sponsor", label: "Sponsored" },
  { id: "community", label: "Community" },
] as const;
export type ChallengeCategory = (typeof CHALLENGE_CATEGORIES)[number]["id"];
export type Visibility = "PUBLIC" | "UNLISTED" | "PRIVATE";
export type CampaignStatus = "DRAFT" | "LIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";

export type PublicChallenge = { slug: string; title: string; summary: string; category: ChallengeCategory; starts_at: string | null; ends_at: string | null; question_count: number; time_limit_seconds: number; max_attempts: number; reward_text: string | null; participants: number };
export type ChallengeCard = PublicChallenge & { visibility: Visibility; status: CampaignStatus; live: boolean; private?: boolean };
export type LeaderRow = { rank: number; name: string; score: number; max_score: number; duration_ms: number; is_me: boolean };
export type MyCampaign = { id: string; slug: string; title: string; status: CampaignStatus; visibility: Visibility; category: ChallengeCategory; question_count: number; starts_at: string | null; ends_at: string | null; created_at: string; questions_loaded: number; participants: number; access_code: string | null };
export type EditableQuestion = { id?: string; position?: number; question_text: string; options: string[]; correct_index: number; explanation?: string | null };
export type StartedAttempt = { attempt_id: string; expires_at: string; time_limit_seconds: number; title: string; questions: { id: string; question_text: string; options: string[] }[] };
export type AttemptResult = { ok: boolean; expired?: boolean; score: number; max_score: number; duration_ms?: number; already_submitted?: boolean; review?: { question_id: string; chosen_index: number | null; is_correct: boolean; correct_index: number; explanation: string | null }[] };

export const formatDuration = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
