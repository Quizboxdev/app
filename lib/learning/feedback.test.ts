import { describe, expect, it } from "vitest";
import { canRevealPracticeFeedback, type PracticeFeedback } from "./feedback";

const response: PracticeFeedback = { question_id: "q1", is_correct: false, selected_answer: "A", selected_value: null, correct_answer: "B", explanation: "Review the objective.", hint: "Read carefully.", marks_awarded: 0 };
describe("practice feedback reveal", () => {
  it("reveals only a confirmed practice response", () => expect(canRevealPracticeFeedback("PRACTICE", "q1", response)).toBe(true));
  it("withholds an unanswered practice question", () => expect(canRevealPracticeFeedback("PRACTICE", "q1")).toBe(false));
  it("withholds another question's answer and explanation", () => expect(canRevealPracticeFeedback("PRACTICE", "q2", response)).toBe(false));
  it("withholds assessment correctness and explanation even if feedback is present", () => expect(canRevealPracticeFeedback("ASSESSMENT", "q1", response)).toBe(false));
  it("fails closed for an unknown mode", () => expect(canRevealPracticeFeedback("UNKNOWN", "q1", response)).toBe(false));
});
