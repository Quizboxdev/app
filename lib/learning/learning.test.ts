import { describe, expect, it } from "vitest";
import { classifyProficiency } from "./proficiency";
import { calculateMastery } from "./mastery";
import { calculateAttemptXp, levelFromXp } from "./xp";
import { summarizeClassScores, summarizeIndicators } from "./analytics";

describe("proficiency bands", () => {
  it.each([[80, "Highly Proficient"], [68, "Proficient"], [54, "Approaching Proficiency"], [40, "Developing"], [39, "Emerging"]] as const)("classifies %s", (score, expected) => expect(classifyProficiency(score)).toBe(expected));
});

describe("mastery", () => {
  it("does not master from one high score", () => expect(calculateMastery({ recentAccuracy: 100, historicalAccuracy: 100, difficultyAdjustedPerformance: 100, consistency: 100, independence: 100, attemptsCount: 1 })).toEqual({ score: 100, state: "Proficient", confidence: "low" }));
  it("uses all weighted inputs", () => expect(calculateMastery({ recentAccuracy: 80, historicalAccuracy: 70, difficultyAdjustedPerformance: 60, consistency: 90, independence: 100, attemptsCount: 5 }).score).toBe(78.5));
});

describe("XP", () => {
  it("centralizes attempt awards", () => expect(calculateAttemptXp(4, true, 85, true)).toBe(65));
  it("calculates deterministic levels", () => expect(levelFromXp(400)).toMatchObject({ level: 3, currentLevelXp: 0 }));
});

describe("learning analytics", () => {
  it("builds canonical class bands and completion", () => {
    const result = summarizeClassScores([90, 70, 55, 42, 30], 10);
    expect(result.average).toBe(57.4);
    expect(result.completionRate).toBe(50);
    expect(result.bands.map((band) => band.count)).toEqual([1, 1, 1, 1, 1]);
  });
  it("groups indicator accuracy and affected learners", () => {
    const result = summarizeIndicators([{ code: "I1", title: "Objective", student_user_id: "a", is_correct: false, mastery_score: 35 }, { code: "I1", title: "Objective", student_user_id: "b", is_correct: true, mastery_score: 45 }]);
    expect(result[0]).toMatchObject({ code: "I1", learnerCount: 2, attemptCount: 2, averageMastery: 40, averageAccuracy: 50 });
  });
});

