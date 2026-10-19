import { describe, expect, it } from "vitest";
import { dayStreak, todayGoal, upNext } from "./home";

const NOW = new Date(2026, 9, 19, 15, 0, 0);                                     // 19 October 2026, mid-afternoon
const at = (daysAgo: number, hour = 10) => new Date(2026, 9, 19 - daysAgo, hour, 0, 0).toISOString();
const r = (daysAgo: number, hour?: number) => ({ submitted_at: at(daysAgo, hour), percentage: 70 });

describe("today's goal", () => {
  it("counts only sessions finished today", () => {
    expect(todayGoal([r(0), r(0, 9), r(1)], NOW)).toEqual({ done: 2, goal: 1, pct: 100, met: true });
    expect(todayGoal([r(1), r(2)], NOW)).toEqual({ done: 0, goal: 1, pct: 0, met: false });
    expect(todayGoal([], NOW, 3)).toEqual({ done: 0, goal: 3, pct: 0, met: false });
    expect(todayGoal([r(0)], NOW, 4).pct).toBe(25);
  });
  it("ignores results with no date", () => { expect(todayGoal([{ submitted_at: null }, {}], NOW).done).toBe(0); });
});

describe("day streak", () => {
  it("counts consecutive days ending today", () => { expect(dayStreak([r(0), r(1), r(2)], NOW).days).toBe(3); });
  it("keeps yesterday's streak alive until today is over", () => { expect(dayStreak([r(1), r(2)], NOW).days).toBe(2); });
  it("breaks on a missed day", () => { expect(dayStreak([r(0), r(1), r(3)], NOW).days).toBe(2); });
  it("is zero when the last session was two or more days ago, or there are none", () => {
    expect(dayStreak([r(2), r(3)], NOW).days).toBe(0);
    expect(dayStreak([], NOW).days).toBe(0);
  });
  it("counts several sessions on one day once, and flags a streak that runs to the edge of what is known", () => {
    expect(dayStreak([r(0), r(0, 8), r(1)], NOW, 10).days).toBe(2);
    const ten = Array.from({ length: 10 }, (_, i) => r(i));
    expect(dayStreak(ten, NOW, 10)).toEqual({ days: 10, capped: true });
    expect(dayStreak([r(0), r(1), r(3)], NOW, 10).capped).toBe(false);
  });
});

describe("up next", () => {
  const assignment = (title: string, daysFromNow: number | null) => ({ assignments: { title, due_at: daysFromNow === null ? null : new Date(NOW.getTime() + daysFromNow * 86_400_000).toISOString() } });
  it("puts the assignment due soonest first, and flags an overdue one", () => {
    const n = upNext([assignment("Later", 5), assignment("Soon", 1), assignment("No date", null)], [], NOW);
    expect(n).toMatchObject({ kind: "assignment", title: "Soon", overdue: false });
    expect(upNext([assignment("Late", -2), assignment("Soon", 1)], [], NOW)).toMatchObject({ title: "Late", overdue: true });
  });
  it("without assignments, points to the weakest subject under 68 percent", () => {
    expect(upNext([], [{ code: "MATH", name: "Mathematics", percentage: 90 }, { code: "SCI", name: "Science", percentage: 52 }], NOW)).toEqual({ kind: "weak", subjectCode: "SCI", subjectName: "Science", percentage: 52 });
  });
  it("otherwise just says start", () => {
    expect(upNext([], [{ code: "MATH", name: "Mathematics", percentage: 80 }], NOW)).toEqual({ kind: "start" });
    expect(upNext([], [], NOW)).toEqual({ kind: "start" });
  });
});
