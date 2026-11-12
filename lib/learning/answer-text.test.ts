import { describe, expect, it } from "vitest";
import { describeAnswer } from "./answer-text";

const question = { options: [
  { option_key: "A", content: { blocks: [{ text: "Roots" }] } },
  { option_key: "B", content: { blocks: [{ text: "Leaves" }, { text: "and stems" }] } },
  { option_key: "C", content: { blocks: [{ text: "Seeds" }] } },
] };

describe("describeAnswer", () => {
  it("shows the option letter with its text", () => {
    expect(describeAnswer(question, "B")).toBe("B. Leaves and stems");
  });
  it("handles several chosen options, as a list or as JSON text", () => {
    expect(describeAnswer(question, ["A", "C"])).toBe("A. Roots, C. Seeds");
    expect(describeAnswer(question, '["A","C"]')).toBe("A. Roots, C. Seeds");
  });
  it("falls back to option_a to option_d, and to the bare letter when there is no text", () => {
    expect(describeAnswer({ option_a: "Water", option_b: "Air" }, "B")).toBe("B. Air");
    expect(describeAnswer({}, "D")).toBe("D");
    expect(describeAnswer(question, "Z")).toBe("Z");
  });
  it("says so when nothing was chosen", () => {
    expect(describeAnswer(question, null, "Unanswered")).toBe("Unanswered");
    expect(describeAnswer(question, "")).toBe("No answer");
  });
});
