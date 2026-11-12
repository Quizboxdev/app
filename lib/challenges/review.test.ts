import { describe, expect, it } from "vitest";
import { buildReview } from "./review";

const questions = [
  { id: "q1", question_text: "Which part takes in water?", options: ["Roots", "Leaves", "Seeds", "Fruit"] },
  { id: "q2", question_text: "What is 7 x 8?", options: ["54", "56", "58"] },
  { id: "q3", question_text: "Name a planet", options: ["Mars", "Moon"] },
];

describe("challenge review", () => {
  it("writes the chosen and correct options out, with the explanation", () => {
    const rows = buildReview(questions, [
      { question_id: "q1", chosen_index: 1, is_correct: false, correct_index: 0, explanation: " Roots take in water. " },
      { question_id: "q2", chosen_index: 1, is_correct: true, correct_index: 1, explanation: null },
      { question_id: "q3", chosen_index: null, is_correct: false, correct_index: 0, explanation: "" },
    ]);
    expect(rows[0]).toEqual({ id: "q1", number: 1, text: "Which part takes in water?", state: "incorrect", chosen: "B. Leaves", correct: "A. Roots", explanation: "Roots take in water." });
    expect(rows[1]).toMatchObject({ state: "correct", chosen: "B. 56", correct: "B. 56", explanation: null });
    expect(rows[2]).toMatchObject({ state: "unanswered", chosen: null, correct: "A. Mars", explanation: null });
  });

  it("still gives the letter when a question is missing from what was played", () => {
    const [row] = buildReview([], [{ question_id: "gone", chosen_index: 2, is_correct: false, correct_index: 3, explanation: null }]);
    expect(row).toMatchObject({ number: 1, text: "Question 1", chosen: null, correct: "D" });
  });
});
