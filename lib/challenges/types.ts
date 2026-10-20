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

export type Brand = { organiser_name?: string; tagline?: string; welcome?: string; accent?: string; logo?: string };
export type StageInfo = { stage_no: number; title: string; question_count: number; time_limit_seconds: number; pass_percent: number; advance_top_n?: number | null; starts_at?: string | null; ends_at?: string | null };
export type Format = "CHALLENGE" | "COMPETITION";
export type Audience = "ANYONE" | "CLASS" | "SCHOOL";
// The words and the page address for each format: a Challenge is one timed round, a Competition has rounds that pass people on.
export const FORMATS: Record<Format, { noun: string; plural: string; base: string }> = {
  CHALLENGE: { noun: "challenge", plural: "challenges", base: "/challenges" },
  COMPETITION: { noun: "competition", plural: "competitions", base: "/competitions" },
};
export const formatOf = (f: string | null | undefined): Format => (f === "COMPETITION" ? "COMPETITION" : "CHALLENGE");
export type Prize = { rank_from: number; rank_to: number; kind: "cash" | "goods" | "voucher" | "certificate" | "recognition"; title: string; details?: string | null };
export type PublicChallenge = { material?: { closes: "START" | "END"; types: string[]; documents: number; sections: number } | null; target_levels?: string[]; format?: Format; stage_count?: number; brand?: Brand; slug: string; title: string; summary: string; category: ChallengeCategory; starts_at: string | null; ends_at: string | null; question_count: number; time_limit_seconds: number; max_attempts: number; reward_text: string | null; participants: number };
export type ChallengeCard = PublicChallenge & { audience?: Audience; visibility: Visibility; status: CampaignStatus; live: boolean; private?: boolean; stages?: StageInfo[]; prizes?: Prize[]; finalized?: boolean };
export type LeaderRow = { rank: number; name: string; score: number; max_score: number; duration_ms: number; is_me: boolean; stages_done?: number };
export type MyCampaign = { cloned_from?: string | null; has_logo?: boolean; reader_enabled?: boolean; format?: Format; stage_count?: number; has_audience?: boolean; id: string; slug: string; title: string; status: CampaignStatus; visibility: Visibility; category: ChallengeCategory; question_count: number; starts_at: string | null; ends_at: string | null; created_at: string; questions_loaded: number; participants: number; access_code: string | null };
export type EditableQuestion = { id?: string; position?: number; question_text: string; options: string[]; correct_index: number; explanation?: string | null; stage_no?: number; source_chunk_id?: string | null; source_quote?: string | null };
export type StartedAttempt = { stage_no?: number; stage_title?: string; stage_count?: number; attempt_id: string; expires_at: string; time_limit_seconds: number; title: string; questions: { id: string; question_text: string; options: string[] }[] };
export type AttemptResult = { ok: boolean; expired?: boolean; score: number; max_score: number; duration_ms?: number; already_submitted?: boolean; review?: { question_id: string; chosen_index: number | null; is_correct: boolean; correct_index: number; explanation: string | null }[] };

export const formatDuration = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export type StageProgress = { stage_no: number; title: string; question_count: number; time_limit_seconds: number; pass_percent: number; advance_top_n?: number | null; ends_at?: string | null; state: "OPEN" | "LOCKED" | "NOT_OPEN" | "CLOSED" | "USED" | "WAITING" | "NOT_THROUGH"; attempts_used: number; attempts_allowed: number; best_score: number | null; best_max: number | null };
export type SectionInfo = { id: string; no: number; title: string; words: number; visible?: boolean };
export type ContentAsset = { asset_id: string; title: string; kind: string; content_type: string; current_version: number; sections: SectionInfo[]; versions: { version_id: string; version: number; source_name: string | null; chunk_count: number; char_count: number; word_count?: number; created_at: string }[] };
export type ReaderState = "OPEN" | "NOT_ENABLED" | "NOT_JOINED" | "NOT_IN_AUDIENCE" | "CLOSED_ROUND" | "CLOSED_ENDED" | "CLOSED_STARTED";
export type Material = { state: ReaderState; title: string; format?: Format; closes?: "START" | "END"; ends_at?: string | null; documents?: { asset_id: string; title: string; content_type: string; sections: SectionInfo[] }[] };
export type SectionRead = { document: string; content_type: string; section_id: string; no: number; title: string; words: number; prev: string | null; next: string | null; reader: string; ends_at: string | null; passages: { position: number; heading: string | null; body: string }[] };
export type FeaturedQuiz = { slug: string; title: string; summary: string; format: Format; category: string; brand: Brand; stage_count: number; question_count: number; has_material: boolean; participants: number };
export type LibraryStats = { documents: number; by_type: Record<string, number> };
export type Passage = { id: string; position: number; heading: string | null; body: string };
export type Award = { award_id: string; rank: number; prize: string; kind: string; name: string; email: string | null; status: "PENDING" | "CONTACTED" | "FULFILLED" | "FORFEITED"; note: string | null; updated_at: string };
export type Analytics = { views: number; started: number; players: number; completed: number; expired: number; avg_score_percent: number | null; avg_duration_ms: number | null; distribution: { band: number; count: number }[]; stages: { stage_no: number; started: number; completed: number; players: number }[]; questions: { position: number; stage_no: number; text: string; answered: number; percent_correct: number | null }[]; daily: { day: string; starts: number }[] };
export const readableText = (hex: string | undefined) => { if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined; const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? "#111111" : "#ffffff"; };
