import { describe, expect, it } from "vitest";
import { cedis, parseQuestions, questionsToText, sourceLine } from "./marketplace";

describe("question paste format", () => {
  const SAMPLE = `1. What is the chemical symbol for sodium?
A. So
B. Na
C. Sd
D. N
Answer: B
Why: From the Latin natrium.

Which gas do plants take in for photosynthesis?
a) Oxygen
b) Nitrogen
c) Carbon dioxide
Ans C`;
  it("reads questions, options, the answer letter and the explanation", () => {
    const { questions, errors } = parseQuestions(SAMPLE);
    expect(errors).toEqual([]);
    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({ question_text: "What is the chemical symbol for sodium?", options: ["So", "Na", "Sd", "N"], correct_index: 1, explanation: "From the Latin natrium." });
    expect(questions[1]).toMatchObject({ question_text: "Which gas do plants take in for photosynthesis?", options: ["Oxygen", "Nitrogen", "Carbon dioxide"], correct_index: 2 });
  });
  it("accepts a number as the answer and Windows line endings", () => {
    const { questions } = parseQuestions("Which is the largest planet?\r\n1. Earth\r\n2. Jupiter\r\n3. Mars\r\nAnswer: 2");
    expect(questions[0].correct_index).toBe(1);
  });
  it("says exactly what is wrong, per question", () => {
    const { questions, errors } = parseQuestions("Short?\nA. a\nB. b\nAnswer: A\n\nA proper question here?\nA. only one\nAnswer: A\n\nAnother proper question?\nA. yes\nB. no\n\nThird proper question?\nA. yes\nB. no\nAnswer: E");
    expect(questions).toEqual([]);
    expect(errors).toEqual([
      "Question 1: the question text is too short.", "Question 2: it needs 2 to 5 answers (found 1).",
      'Question 3: add a line like "Answer: B" that points to one of the answers.', 'Question 4: add a line like "Answer: B" that points to one of the answers.',
    ]);
  });
  it("round-trips a saved set back into editable text", () => {
    const first = parseQuestions(SAMPLE).questions;
    expect(parseQuestions(questionsToText(first)).questions).toEqual(first);
  });
});

describe("display helpers", () => {
  it("names the source of a set: subject, school, class, term", () => {
    expect(sourceLine({ subject: "Chemistry", school: "Opoku Ware School", grade: "SHS1", term: "Term 2" })).toBe("Chemistry · Opoku Ware School · SHS1 · Term 2");
    expect(sourceLine({ subject: "English", school_name: "VPCS", grade: "B9", term: null })).toBe("English · VPCS · B9");
  });
  it("shows cedis from pesewas", () => {
    expect(cedis(2000)).toBe("GHS 20"); expect(cedis(1250)).toBe("GHS 12.50"); expect(cedis(500)).toBe("GHS 5");
  });
});
