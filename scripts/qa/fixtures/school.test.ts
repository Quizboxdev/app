import { describe, expect, it } from "vitest";
import { buildSchoolFixture } from "./school";
import { performanceAttention, schoolAttention, summarizeSchool, teacherLoad } from "../../../lib/school/insights";
import { sessionCookie } from "../fixture-server";

// Guards the QA fixture: it must keep exercising every School state the visual QA is meant to cover.
describe("school QA fixture", () => {
  const f = buildSchoolFixture();

  it("covers the structural attention scenarios", () => {
    expect(schoolAttention(f.overview).map((i) => i.key)).toEqual(["no-teacher", "empty-class", "idle-teacher"]);
    expect(teacherLoad(f.overview).some((t) => t.role === "teacher" && t.classes.length === 0)).toBe(true);
    expect(f.overview.classes.some((c) => c.status === "archived")).toBe(true);
  });

  it("covers low, thin, zero-data and weak-indicator results", () => {
    expect(performanceAttention(f.performance).map((i) => i.key)).toEqual(["low-average", "low-completion", "no-results", "weak-indicators"]);
    expect(f.performance.by_class.some((c) => c.learner_count === 0)).toBe(true);
    expect(f.performance.weak_indicators.some((w) => w.low_evidence)).toBe(true);
    expect(f.performance.by_subject.some((s) => s.assessed_count < 3)).toBe(true);
  });

  it("keeps summary counts consistent with the class rows", () => {
    const s = summarizeSchool(f.overview, f.history, Date.parse("2026-10-05T09:00:00Z"));
    expect(s.enrolments).toBe(f.performance.by_class.reduce((n, c) => n + c.learner_count, 0));
    expect(f.performance.summary.assessed_learner_count).toBe(f.performance.by_class.reduce((n, c) => n + c.assessed_count, 0));
    expect(s.uniqueLearners).toBe(f.performance.summary.learner_count);
  });

  it("builds a session cookie the SSR client can read", () => {
    const cookie = sessionCookie(f);
    expect(cookie.name).toBe("sb-127-auth-token");
    const session = JSON.parse(Buffer.from(cookie.value.replace("base64-", ""), "base64url").toString());
    expect(session.user.id).toBe(f.user.id);
    expect(session.expires_at).toBeGreaterThan(Date.now() / 1000);
  });
});
