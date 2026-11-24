import { describe, expect, it } from "vitest";
import { isBaseRoute } from "./role-routes";

describe("pages open to a role before extra duties are read", () => {
  it("lets a teacher open teaching pages at once but not /admin or /sponsor", () => {
    expect(isBaseRoute("TEACHER", "/teacher/classes", false)).toBe(true);
    expect(isBaseRoute("TEACHER", "/admin", false)).toBe(false);
    expect(isBaseRoute("TEACHER", "/sponsor", false)).toBe(false);
  });
  it("lets an administrator open /admin, and a student not", () => {
    expect(isBaseRoute("OWNER", "/admin/content", false)).toBe(true);
    expect(isBaseRoute("STUDENT", "/admin", false)).toBe(false);
  });
  it("opens /family only when the Family workspace is on and the person is not a student", () => {
    expect(isBaseRoute("STUDENT", "/mock-exams/join/abc123def0", false)).toBe(true);      // a learner opens a sponsor's shared exam link
    expect(isBaseRoute("STUDENT", "/mock-exams", false)).toBe(false);                      // but the exam builder is not theirs
    expect(isBaseRoute("SPONSOR", "/seller", false)).toBe(true);
    expect(isBaseRoute("SPONSOR", "/family", true)).toBe(true);
    expect(isBaseRoute("SPONSOR", "/family", false)).toBe(false);
    expect(isBaseRoute("STUDENT", "/family", true)).toBe(false);
  });
  it("does not treat a longer name as the same page", () => { expect(isBaseRoute("TEACHER", "/teacherx", false)).toBe(false); });
});
