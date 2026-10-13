import { describe, expect, it } from "vitest";
import { gradeVariants, studentGrade } from "./student-scope";

describe("learner scope", () => {
  it("maps every stored spelling of a grade to its variants, with B10 meaning SHS 1", () => {
    expect(gradeVariants("SHS1")).toEqual(expect.arrayContaining(["SHS1", "SHS 1"]));
    expect(gradeVariants("shs 1")).toEqual(expect.arrayContaining(["SHS1"]));
    expect(gradeVariants("B10")).toEqual(expect.arrayContaining(["SHS1"]));
    expect(gradeVariants("B7")).toEqual(expect.arrayContaining(["B7"]));
    expect(gradeVariants("B7")).not.toContain("SHS1");
  });
  it("returns nothing for a missing grade, so a learner never falls back to every level", () => {
    expect(gradeVariants("")).toEqual([]);
    expect(gradeVariants(null)).toEqual([]);
  });
  it("prefers the market grade code over the legacy grade column", () => {
    expect(studentGrade({ grade: "B7", grade_code: "SHS1" })).toBe("SHS1");
    expect(studentGrade({ grade: "B4" })).toBe("B4");
    expect(studentGrade(null)).toBe("");
  });
});
