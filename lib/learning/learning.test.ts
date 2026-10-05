import { describe, expect, it } from "vitest";
import { classifyProficiency } from "./proficiency";
import { calculateMastery, evidenceNote, masteryLevel } from "./mastery";
import { calculateAttemptXp, levelFromXp } from "./xp";
import { summarizeClassScores, summarizeClassLearners, summarizeIndicators, assignmentPhase, buildAttentionQueue } from "./analytics";

describe("proficiency bands", () => {
  it.each([[80, "Highly Proficient"], [68, "Proficient"], [54, "Approaching Proficiency"], [40, "Developing"], [39, "Emerging"]] as const)("classifies %s", (score, expected) => expect(classifyProficiency(score)).toBe(expected));
});

describe("mastery", () => {
  it("does not master from one high score", () => expect(calculateMastery({ recentAccuracy: 100, historicalAccuracy: 100, difficultyAdjustedPerformance: 100, consistency: 100, independence: 100, attemptsCount: 1 })).toEqual({ score: 100, state: "Proficient", confidence: "low" }));
  it("uses all weighted inputs", () => expect(calculateMastery({ recentAccuracy: 80, historicalAccuracy: 70, difficultyAdjustedPerformance: 60, consistency: 90, independence: 100, attemptsCount: 5 }).score).toBe(78.5));
});

describe("mastery level vs evidence", () => {
  it("does not call 2/2 Mastered", () => { expect(masteryLevel(100, 2)).toBe("Developing"); expect(evidenceNote(100, 2)).toBe("Strong start · more evidence needed"); });
  it("4/5 is Proficient, not Mastered", () => { expect(masteryLevel(80, 5)).toBe("Proficient"); expect(masteryLevel(85, 5)).toBe("Proficient"); });
  it("8/10 is Proficient; 9/10 earns Mastered", () => { expect(masteryLevel(80, 10)).toBe("Proficient"); expect(masteryLevel(90, 10)).toBe("Mastered"); expect(evidenceNote(90, 10)).toBeNull(); });
  it("larger sample at high score is Mastered", () => { expect(masteryLevel(95, 40)).toBe("Mastered"); expect(evidenceNote(95, 40)).toBeNull(); });
  it("low sample at low score stays Needs Work", () => { expect(masteryLevel(20, 2)).toBe("Needs Work"); expect(masteryLevel(50, 2)).toBe("Developing"); expect(evidenceNote(20, 2)).toBe("Early evidence"); });
  it("boundaries around the evidence minimums", () => { expect(masteryLevel(100, 3)).toBe("Proficient"); expect(masteryLevel(100, 9)).toBe("Proficient"); expect(masteryLevel(100, 10)).toBe("Mastered"); });
  it("keeps the raw band when evidence is not supplied", () => { expect(masteryLevel(90)).toBe("Mastered"); expect(masteryLevel(67.9)).toBe("Developing"); });
});

describe("XP", () => {
  it("centralizes attempt awards", () => expect(calculateAttemptXp(4, true, 85, true)).toBe(65));
  it("calculates deterministic levels", () => expect(levelFromXp(400)).toMatchObject({ level: 3, currentLevelXp: 0 }));
});

describe("learning analytics", () => {
  it("counts each active learner once using their latest grade", () => {
    const result = summarizeClassLearners([
      { student_user_id: "a", percentage: 0, graded_at: "2026-10-01T10:00:00Z" },
      { student_user_id: "a", percentage: 100, graded_at: "2026-10-01T11:00:00Z" },
      { student_user_id: "a", percentage: 50, graded_at: "2026-10-01T09:00:00Z" },
      { student_user_id: "outside", percentage: 0, graded_at: "2026-10-01T12:00:00Z" },
    ], ["a", "b", "a"]);
    expect(result.average).toBe(100); expect(result.completionRate).toBe(50);
    expect(result.bands.map((band) => band.count)).toEqual([1, 0, 0, 0, 0]);
  });
  it("does not count ungraded learners as completed", () => {
    expect(summarizeClassLearners([{ student_user_id: "a", percentage: null, graded_at: null }], ["a"]).completionRate).toBe(0);
  });
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


describe("teacher indicator summary mapping", () => {
  it("matches summarizeIndicators for the same event rows", async () => {
    const { summarizeIndicators, indicatorsFromSummary } = await import("./analytics");
    const rows = [
      { code: "B7.1", title: "Fractions", student_user_id: "a", is_correct: true, mastery_score: 80, proficiency_state: "Proficient" },
      { code: "B7.1", title: "Fractions", student_user_id: "a", is_correct: false, mastery_score: 80, proficiency_state: "Proficient" },
      { code: "B7.1", title: "Fractions", student_user_id: "b", is_correct: true, mastery_score: 50, proficiency_state: undefined },
      { code: "B7.2", title: "Ratio", student_user_id: "b", is_correct: false, mastery_score: undefined, proficiency_state: undefined },
    ];
    const server = [
      { code: "B7.1", title: "Fractions", class_id: "c", curriculum_node_id: "n1", learner_count: 2, attempt_count: 3, average_mastery: "70.00", average_accuracy: "66.67", proficiency_state: "Proficient" },
      { code: "B7.2", title: "Ratio", class_id: "c", curriculum_node_id: "n2", learner_count: 1, attempt_count: 1, average_mastery: "0", average_accuracy: "0", proficiency_state: null },
    ];
    expect(indicatorsFromSummary(server)).toEqual(summarizeIndicators(rows));
  });
});

describe("teacher home helpers", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const day = 864e5;
  it("derives the assignment phase", () => {
    expect(assignmentPhase({ status: "draft" }, now)).toBe("Draft");
    expect(assignmentPhase({ status: "published", start_at: new Date(now + day).toISOString() }, now)).toBe("Scheduled");
    expect(assignmentPhase({ status: "published", due_at: new Date(now + day).toISOString() }, now)).toBe("Active");
    expect(assignmentPhase({ status: "published", due_at: new Date(now - day).toISOString() }, now)).toBe("Closed");
    expect(assignmentPhase({ status: "published" }, now)).toBe("Active");
    expect(assignmentPhase({ status: "closed" }, now)).toBe("Closed");
  });
  it("ranks attention items from real rows only", () => {
    const items = buildAttentionQueue({
      now,
      assignments: [{ id: "a", class_id: "c1", title: "Fractions", status: "published", due_at: new Date(now + day).toISOString() }, { id: "b", class_id: "c2", status: "draft" }],
      classes: [{ id: "c1", class_name: "JHS 1A", completionRate: 20, average: 50 }, { id: "c2", class_name: "JHS 1B", completionRate: 10, average: 40 }],
      needsAttention: [{ code: "B7.1", title: "Fractions", learnerCount: 1, averageMastery: 40, classId: "c1", curriculumNodeId: "n1" }],
    });
    expect(items.map((i) => i.key)).toEqual(["weak-c1-B7.1", "due", "completion-c1"]);
    expect(items[0].detail).toBe("1 learner affected · 40% mastery");
  });
  it("returns nothing when nothing needs attention", () => {
    expect(buildAttentionQueue({ now, assignments: [], classes: [], needsAttention: [] })).toEqual([]);
  });
});
