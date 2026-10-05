import type { MasteryInputs, MasteryResult } from "@/lib/learning/mastery";
import { calculateMastery } from "@/lib/learning/mastery";

// Typed view over public.platform_settings. Keys mirror the migration seed; unknown keys are rejected client-side.
export const FEATURE_FLAGS = [
  "student_self_pay", "paid_challenges", "offline_learning", "guardian_consent_required", "sponsor_consent_required", "buy_coins_enabled",
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];
export type FlagMap = Record<FeatureFlag, boolean>;

// Failing closed: until settings load, nothing optional is on.
export const DEFAULT_FLAGS: FlagMap = {
  student_self_pay: false, paid_challenges: false, offline_learning: false, guardian_consent_required: false, sponsor_consent_required: true, buy_coins_enabled: false,
};

export function flagsFromSettings(rows: Array<{ key: string; value: unknown }>): FlagMap {
  const flags = { ...DEFAULT_FLAGS };
  for (const row of rows) {
    const name = row.key.startsWith("flags.") ? row.key.slice(6) : "";
    if ((FEATURE_FLAGS as readonly string[]).includes(name) && typeof row.value === "boolean") flags[name as FeatureFlag] = row.value;
  }
  return flags;
}

// ---- Proficiency: bands are data (curriculum settings), not code. -------------------------------------------------
export type ProficiencyBand = { code: string; label: string; min: number };
export const GHANA_CCP_BANDS: readonly ProficiencyBand[] = Object.freeze([
  { code: "highly_proficient", label: "Highly Proficient", min: 80 },
  { code: "proficient", label: "Proficient", min: 68 },
  { code: "approaching_proficiency", label: "Approaching Proficiency", min: 54 },
  { code: "developing", label: "Developing", min: 40 },
  { code: "emerging", label: "Emerging", min: 0 },
]);

export function parseBands(value: unknown): readonly ProficiencyBand[] {
  const bands = (value as { bands?: ProficiencyBand[] } | null)?.bands;
  const valid = Array.isArray(bands) && bands.length > 0 && bands.every((b) => b && typeof b.label === "string" && typeof b.code === "string" && Number.isFinite(b.min));
  if (!valid || !bands!.some((b) => b.min <= 0)) return GHANA_CCP_BANDS; // a config without a floor band would leave scores unclassified
  return [...bands!].sort((a, b) => b.min - a.min);
}

export function classifyByBands(percentage: number, bands: readonly ProficiencyBand[] = GHANA_CCP_BANDS): ProficiencyBand {
  const score = Number.isFinite(percentage) ? percentage : 0;
  return bands.find((band) => score >= band.min) ?? bands[bands.length - 1];
}

// ---- Mastery: QuizBox states behind a replaceable strategy. The algorithm is intentionally not fixed here. ---------
export type QuizBoxMasteryState = "not_started" | "introduced" | "developing" | "secure" | "strong";
export interface MasteryStrategy { readonly id: string; evaluate(input: MasteryInputs): { score: number; state: QuizBoxMasteryState } }

// Adapter over the existing calculator so current behaviour is preserved while the vocabulary becomes the QuizBox one.
const LEGACY_TO_STATE: Record<MasteryResult["state"], QuizBoxMasteryState> = {
  "Not Started": "not_started", Learning: "introduced", Developing: "developing", "Needs Review": "developing", Proficient: "secure", Mastered: "strong",
};
export const legacyMasteryStrategy: MasteryStrategy = {
  id: "legacy-weighted-v1",
  evaluate(input) { const result = calculateMastery(input); return { score: result.score, state: LEGACY_TO_STATE[result.state] }; },
};
