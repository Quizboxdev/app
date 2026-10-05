import { describe, expect, it } from "vitest";
import { buildStudentFixture } from "./student";
import { buildTeacherFixture } from "./teacher";
import { filterRows } from "../fixture-server";
import { assignmentPhase, buildAttentionQueue, indicatorsFromSummary, summarizeClassLearners } from "../../../lib/learning/analytics";
import { masteryLevel } from "../../../lib/learning/mastery";

// Fixture handlers are typed per-RPC; the tests call them like the server does, by name.
const call = (fx: { rpc: object }, name: string, args: unknown = {}) => (fx.rpc as Record<string, (a: unknown) => unknown>)[name](args);
const labels = (routes: Array<string | { label: string }>) => routes.map((r) => (typeof r === "string" ? r : r.label));

describe("PostgREST filter emulation", () => {
  const rows = [{ id: "1", parent_id: null, kind: "a" }, { id: "2", parent_id: "1", kind: "b" }, { id: "3", parent_id: "1", kind: "a" }];
  it("handles the operators the app uses and ignores the rest", () => {
    const f = (query: string) => filterRows(rows, new URLSearchParams(query)).map((r) => r.id);
    expect(f("parent_id=is.null")).toEqual(["1"]);
    expect(f("parent_id=eq.1&kind=eq.a")).toEqual(["3"]);
    expect(f("id=in.(1,3)")).toEqual(["1", "3"]);
    expect(f("select=*&order=title.asc&kind=ilike.%25a%25")).toEqual(["1", "2", "3"]);
  });
});

describe("student QA fixture", () => {
  const f = buildStudentFixture();
  const insights: any = call(f, "qb_student_insights", {});

  it("covers weak, mastered and thin-evidence subjects", () => {
    const level = (s: { mastery: number; topics: number }) => masteryLevel(s.mastery, s.topics);
    // Mathematics is weak, Science mastered, English scores 88% on 2 topics so the evidence cap holds it at Developing.
    expect(insights.by_subject.map(level)).toEqual(["Developing", "Mastered", "Developing"]);
    expect(insights.by_subject[2].topics).toBeLessThan(3); // high score, thin sample
    expect(insights.weak_topics.length).toBeGreaterThan(0);
  });

  it("has due and later assignments, completed results, rank and achievements", () => {
    const due = (f.tables.assignment_targets as any[]).map((t) => Date.parse(t.assignments.due_at) - Date.now());
    expect(due.some((ms) => ms > 0 && ms < 3 * 864e5)).toBe(true);
    expect(due.some((ms) => ms > 3 * 864e5)).toBe(true);
    expect((call(f, "qb_my_results", {}) as any[]).length).toBeGreaterThan(3);
    expect((call(f, "qb_student_competition_analytics", {}) as any).current_rank).toBeTruthy();
    expect((call(f, "qb_student_achievements", {}) as any[]).length).toBeGreaterThan(0);
  });

  it("grades the practice answer and covers every page state", () => {
    const attempt: any = call(f, "qb_get_attempt", {});
    const q = attempt.questions[0].question_id;
    expect((call(f, "qb_save_practice_response", { p_question_id: q, p_selected_answer: "A" }) as any)).toMatchObject({ is_correct: false, correct_answer: "C" });
    expect((call(f, "qb_save_practice_response", { p_question_id: q, p_selected_answer: "C" }) as any).is_correct).toBe(true);
    expect(labels(f.routes)).toEqual(["home", "learn", "learn-indicator", "practise", "player", "player-feedback", "result", "progress"]);
  });
});

describe("teacher QA fixture", () => {
  const f = buildTeacherFixture();
  const rows = f.tables.assignments as any[];

  it("covers every assignment phase", () => {
    expect(new Set(rows.map((r) => assignmentPhase(r)))).toEqual(new Set(["Active", "Scheduled", "Draft", "Closed"]));
  });

  it("produces the attention queue the shared AttentionList renders", () => {
    const grades = f.tables.gradebook as any[], members = f.tables.class_memberships as any[];
    const classes = (f.tables.classes as any[]).map((c) => ({ ...c, ...summarizeClassLearners(grades.filter((g) => g.class_id === c.id), members.filter((m) => m.class_id === c.id).map((m) => m.student_user_id)) }));
    const needsAttention = indicatorsFromSummary(call(f, "qb_teacher_indicator_summary", {}) as any).filter((r) => r.averageMastery < 68 || r.averageAccuracy < 68);
    const queue = buildAttentionQueue({ assignments: rows, classes, needsAttention });
    expect(queue.map((i) => i.key.split("-")[0])).toEqual(["weak", "weak", "due", "completion"]);
    expect(classes.map((c) => Math.round(c.average))).toEqual([expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(Math.max(...classes.map((c) => c.average))).toBeGreaterThan(68); // one proficient class
    expect(Math.min(...classes.map((c) => c.average))).toBeLessThan(40); // one emerging class
  });

  it("has a two-page question bank with mixed status and every builder step route", () => {
    const bank = f.tables.questions as any[];
    expect(bank.length).toBeGreaterThan(25);
    expect(new Set(bank.map((q) => q.status))).toEqual(new Set(["active", "draft"]));
    expect(labels(f.routes)).toEqual(["home", "question-bank", "question-bank-scoped", "builder-class", "builder-scope", "builder-questions", "builder-review"]);
  });
});
