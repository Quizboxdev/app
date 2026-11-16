import { describe, expect, it } from "vitest";
import type { Application } from "@/lib/api/reviewer-applications";
import { daysText, reviewerStats, weekStart } from "./reviewer-stats";

const app = (o: Partial<Application>): Application => ({ user_id: Math.random().toString(36), name: "T", email: "t@x.test", school: null, status: "pending", qualifications: "", years_experience: 1, requested: [], applied_at: "2026-11-10T09:00:00Z", decision_note: null, decided_at: null, domains: 0, ...o });
const NOW = new Date("2026-11-15T12:00:00Z");   // a Sunday: its week started Monday 9 November

describe("reviewer application figures", () => {
  it("finds the Monday of a week (UTC)", () => {
    expect(weekStart("2026-11-15T23:00:00Z")).toBe("2026-11-09");
    expect(weekStart("2026-11-09T00:00:00Z")).toBe("2026-11-09");
    expect(weekStart("2026-11-08T23:59:00Z")).toBe("2026-11-02");
  });
  it("counts statuses, waiting time, decision time and this week against last", () => {
    const apps = [
      app({ applied_at: "2026-11-02T09:00:00Z", requested: [{ subject_code: "MATHS" }, { subject_code: "SCI" }] }),                                           // waiting 13 days
      app({ applied_at: "2026-11-11T09:00:00Z", requested: [{ subject_code: "MATHS" }] }),                                                                    // waiting 4 days, this week
      app({ status: "verified", applied_at: "2026-11-03T09:00:00Z", decided_at: "2026-11-05T09:00:00Z", requested: [{ subject_code: "ENG" }] }),             // decided in 2 days
      app({ status: "suspended", applied_at: "2026-10-30T09:00:00Z", decided_at: "2026-11-03T09:00:00Z" }),                                                  // decided in 4 days
    ];
    const s = reviewerStats(apps, NOW);
    expect([s.waiting, s.approved, s.declined, s.total]).toEqual([2, 1, 1, 4]);
    expect(s.oldestWaitingDays).toBe(13);
    expect(s.medianDecisionDays).toBe(3);
    expect([s.thisWeek, s.lastWeek]).toEqual([1, 2]);
    expect(s.weekly).toHaveLength(12);
    expect(s.weekly[11]).toEqual({ week: "2026-11-09", applied: 1, decided: 0 });
    expect(s.weekly[10]).toEqual({ week: "2026-11-02", applied: 2, decided: 2 });
    expect(s.subjects).toEqual([{ subject: "MATHS", n: 2 }, { subject: "ENG", n: 1 }, { subject: "SCI", n: 1 }]);
  });
  it("copes with no applications", () => {
    const s = reviewerStats([], NOW);
    expect(s).toMatchObject({ waiting: 0, total: 0, oldestWaitingDays: null, medianDecisionDays: null, thisWeek: 0 });
    expect(s.weekly.every((w) => w.applied === 0 && w.decided === 0)).toBe(true);
  });
  it("words durations", () => {
    expect(daysText(null)).toBe("—"); expect(daysText(0.4)).toBe("under a day"); expect(daysText(3)).toBe("3 days"); expect(daysText(2.5)).toBe("2.5 days"); expect(daysText(13.2)).toBe("13 days");
  });
});
