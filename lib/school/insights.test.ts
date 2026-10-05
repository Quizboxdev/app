import { describe, expect, it } from "vitest";
import { currentLearners, gradeBreakdown, HISTORY_LIMIT, performanceAttention, schoolAttention, summarizeSchool, teacherLoad, weakest } from "./insights";
import type { SchoolHistoryRow, SchoolOverview, SchoolPerformance } from "@/lib/api/school";

const NOW = Date.parse("2026-10-05T00:00:00Z");
const overview: SchoolOverview = {
  institution: "Fixture School",
  teachers: [{ user_id: "t1", name: "Ama", role: "teacher" }, { user_id: "t2", name: "Kofi", role: "teacher" }, { user_id: "a1", name: "Head", role: "owner" }],
  classes: [
    { id: "c1", name: "JHS 1A", grade: "JHS 1", status: "active", teacher: "Ama", students: 30 },
    { id: "c2", name: "JHS 1B", grade: "JHS 1", status: "active", teacher: null, students: 0 },
    { id: "c3", name: "JHS 2A", grade: "JHS 2", status: "active", teacher: "Ama", students: 20 },
    { id: "c4", name: "Old", grade: "JHS 3", status: "archived", teacher: "Kofi", students: 40 },
  ],
};
const day = (n: number) => new Date(NOW - n * 864e5).toISOString();
const history: SchoolHistoryRow[] = [
  { class: "JHS 1A", student: "Esi", status: "active", joined_at: day(2) },
  { class: "JHS 1A", student: "Yaw", status: "active", joined_at: day(60) },
  { class: "JHS 2A", student: "Yaw", status: "inactive", joined_at: day(90), left_at: day(60) },
];

describe("school insights", () => {
  it("counts only active classes toward learners and averages", () => {
    const s = summarizeSchool(overview, history, NOW);
    expect(s).toMatchObject({ activeClasses: 3, archivedClasses: 1, enrolments: 50, avgClassSize: 16.7, teachingStaff: 2, joinedLast30Days: 1, historyComplete: true });
  });

  it("withholds the 30-day count when capped history cannot cover the window", () => {
    const capped = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ class: "JHS 1A", student: `S${i}`, status: "active", joined_at: day(1) }));
    expect(summarizeSchool(overview, capped, NOW).joinedLast30Days).toBeNull();
  });

  it("raises only real structural signals", () => {
    expect(schoolAttention(overview).map((i) => [i.key, i.tone])).toEqual([["no-teacher", "danger"], ["empty-class", "warning"], ["idle-teacher", "info"]]);
    expect(schoolAttention({ ...overview, classes: [overview.classes[0]], teachers: [overview.teachers[0]] })).toEqual([]);
  });

  it("ignores archived classes in teacher load and grade breakdown", () => {
    expect(teacherLoad(overview).find((t) => t.name === "Kofi")).toMatchObject({ classes: [], learners: 0 });
    expect(gradeBreakdown(overview.classes)).toEqual([{ grade: "JHS 1", classes: 2, learners: 30, avgClassSize: 15 }, { grade: "JHS 2", classes: 1, learners: 20, avgClassSize: 20 }]);
  });

  it("lists current learners once with the class grade", () => {
    expect(currentLearners(history, overview.classes)).toEqual([{ student: "Esi", class: "JHS 1A", grade: "JHS 1", joinedAt: day(2) }, { student: "Yaw", class: "JHS 1A", grade: "JHS 1", joinedAt: day(60) }]);
  });

  it("prefers server counts and stable teacher ids over client inference", () => {
    const capped = Array.from({ length: HISTORY_LIMIT }, (_, i) => ({ class: "JHS 1A", student: `S${i}`, status: "active", joined_at: day(1) }));
    expect(summarizeSchool({ ...overview, summary: { unique_learners: 44, joined_last_30d: 0 } }, capped, NOW)).toMatchObject({ uniqueLearners: 44, joinedLast30Days: 0, enrolments: 50 });
    expect(summarizeSchool(overview, history, NOW).uniqueLearners).toBeNull();
    // Two teachers share a display name: ids keep the load apart.
    const twins: SchoolOverview = { ...overview, teachers: [{ user_id: "x1", name: "Ama", role: "teacher" }, { user_id: "x2", name: "Ama", role: "teacher" }], classes: [{ ...overview.classes[0], teacher: "Ama", teacher_user_id: "x2" }] };
    expect(teacherLoad(twins).map((t) => [t.userId, t.classes.length])).toEqual([["x2", 1], ["x1", 0]]);
  });
});

const perf = (by_class: SchoolPerformance["by_class"], weak_indicators: SchoolPerformance["weak_indicators"] = []): SchoolPerformance => ({
  summary: { learner_count: 0, assessed_learner_count: 0, average_score: null, assignment_completion_rate: null, due_target_count: 0, active_assignment_count: 0 }, by_grade: [], by_subject: [], by_class, weak_indicators,
});
const row = (class_name: string, learner_count: number, assessed_count: number, average_score: number | null, completion_rate: number | null) => ({ class_id: class_name, class_name, grade: "B7", learner_count, assessed_count, average_score, completion_rate });

describe("school academic signals", () => {
  it("alerts only on classes with enough evidence", () => {
    const items = performanceAttention(perf([row("Low", 20, 10, 31, 50), row("Thin", 20, 2, 10, 10), row("Sparse", 10, 4, 70, 40), row("Empty", 12, 0, null, null), row("Fine", 10, 9, 80, 90)],
      [{ node_id: "n", code: "B7.1", label: "Fractions", assessed_count: 9, response_count: 40, average_score: 52, low_evidence: false }, { node_id: "m", code: "B7.2", label: "Thin", assessed_count: 1, response_count: 6, average_score: 10, low_evidence: true }]));
    expect(items.map((i) => i.key)).toEqual(["low-average", "low-completion", "no-results", "weak-indicators"]);
    expect(items[0].detail).toBe("Low 31%");
    expect(items[3].detail).toBe("Fractions (52%)");
    expect(performanceAttention(null)).toEqual([]);
  });

  it("names a weakest group only when at least two comparable groups exist", () => {
    expect(weakest([{ assessed_count: 8, average_score: 70 }, { assessed_count: 9, average_score: 55 }, { assessed_count: 1, average_score: 5 }])).toEqual({ assessed_count: 9, average_score: 55 });
    expect(weakest([{ assessed_count: 8, average_score: 70 }, { assessed_count: 2, average_score: 5 }])).toBeNull();
  });
});
