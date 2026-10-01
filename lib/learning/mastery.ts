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

