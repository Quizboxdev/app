import { describe, expect, it } from "vitest";
import { gradeDisplay } from "./grade-label";

describe("gradeDisplay", () => {
  it("joins the friendly name and the code", () => { expect(gradeDisplay("Class 5", "B5")).toBe("Class 5 (B5)"); });
  it("does not repeat a name that is the code", () => { expect(gradeDisplay("B5", "b5")).toBe("B5"); });
  it("falls back to whichever exists, then a dash", () => {
    expect(gradeDisplay(undefined, "B5")).toBe("B5");
    expect(gradeDisplay("Class 5", null)).toBe("Class 5");
    expect(gradeDisplay(null, null)).toBe("-");
  });
});
