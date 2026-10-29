import { describe, expect, it } from "vitest";
import { clampText } from "./og-text";

describe("clampText", () => {
  it("keeps short text and collapses stray whitespace", () => {
    expect(clampText("  Maths   Challenge \n B7 ", 40)).toBe("Maths Challenge B7");
  });
  it("cuts long text at a word boundary and adds an ellipsis, within the limit", () => {
    const out = clampText("The big Ghana national science and mathematics challenge for junior high school learners", 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
  it("cuts a single very long word without crashing", () => {
    expect(clampText("x".repeat(100), 20)).toBe("x".repeat(19) + "…");
  });
});
