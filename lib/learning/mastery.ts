export interface MasteryInputs {
  recentAccuracy: number;
  historicalAccuracy: number;
  difficultyAdjustedPerformance: number;
  consistency: number;
  independence: number;
  attemptsCount: number;
  previousScore?: number;
}

export interface MasteryResult {
  score: number;
  state: "Not Started" | "Learning" | "Developing" | "Proficient" | "Mastered" | "Needs Review";
  confidence: "low" | "medium" | "high";
}

const bounded = (value: number) => Math.max(0, Math.min(100, value));

export function calculateMastery(input: MasteryInputs): MasteryResult {
  if (input.attemptsCount <= 0) return { score: 0, state: "Not Started", confidence: "low" };
  const score = Math.round((
    bounded(input.recentAccuracy) * 0.4 +
    bounded(input.historicalAccuracy) * 0.2 +
    bounded(input.difficultyAdjustedPerformance) * 0.15 +
    bounded(input.consistency) * 0.15 +
    bounded(input.independence) * 0.1
  ) * 100) / 100;
  const confidence = input.attemptsCount >= 10 ? "high" : input.attemptsCount >= 4 ? "medium" : "low";
  const declining = input.previousScore != null && input.previousScore - score >= 15;
  const state = declining ? "Needs Review" : score >= 85 && input.attemptsCount >= 4 ? "Mastered" : score >= 68 ? "Proficient" : score >= 40 ? "Developing" : "Learning";
  return { score, state, confidence };
}

// Learner-facing mastery levels. Thresholds match calculateMastery above; this is the display label for a 0-100 score and never
// replaces official proficiency (classifyProficiency, CCP bands).
export type MasteryLevel = "Mastered" | "Proficient" | "Developing" | "Needs Work";
export const MASTERY_LEVELS: readonly MasteryLevel[] = ["Mastered", "Proficient", "Developing", "Needs Work"];
// Evidence = answered questions (or, where only an aggregate exists, the number of independent observations). A high percentage
// from a thin sample is a strong start, not mastery: below MIN_PROFICIENT_EVIDENCE the level is capped at Developing, below
// MIN_MASTERED_EVIDENCE it is capped at Proficient. Low scores are never softened by a small sample. Omit evidence to get the raw band.
export const MIN_PROFICIENT_EVIDENCE = 3;
export const MIN_MASTERED_EVIDENCE = 10;
const rawLevel = (percentage: number): MasteryLevel => percentage >= 85 ? "Mastered" : percentage >= 68 ? "Proficient" : percentage >= 40 ? "Developing" : "Needs Work";

export function masteryLevel(percentage: number, evidence?: number): MasteryLevel {
  const level = rawLevel(percentage);
  if (evidence == null) return level;
  if (evidence < MIN_PROFICIENT_EVIDENCE && (level === "Mastered" || level === "Proficient")) return "Developing";
  if (evidence < MIN_MASTERED_EVIDENCE && level === "Mastered") return "Proficient";
  return level;
}

// Presentation qualifier shown beside the level; null when the evidence supports the raw band.
export function evidenceNote(percentage: number, evidence?: number): string | null {
  if (evidence == null || masteryLevel(percentage, evidence) === rawLevel(percentage)) return evidence != null && evidence < MIN_MASTERED_EVIDENCE && percentage < 68 ? "Early evidence" : null;
  return "Strong start · more evidence needed";
}
