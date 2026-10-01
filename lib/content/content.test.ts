import { describe, expect, it } from "vitest";
import { auditQuestion, normalizeGrade, normalizeSubject } from "./normalize";
import type { NormalizedQuestion } from "./types";

const base: NormalizedQuestion = { externalSourceId: "q1", sourceFile: "test.csv", sourceHash: "hash", grade: "B7", subject: "Computing", learningIndicator: "B7.1.1.1.1", questionType: "multiple_choice", questionText: "Which device stores data?", options: ["A", "B", "C", "D"].map((key) => ({ key, text: `Option ${key}` })), correctAnswer: "A", source: "fixture", reviewStatus: "review" };

describe("content normalization", () => {
  it("normalizes grade aliases", () => expect(normalizeGrade("JHS 2")).toBe("B8"));
  it("normalizes subject aliases", () => expect(normalizeSubject("ICT")).toBe("Computing"));
  it("accepts structurally complete MCQs", () => expect(auditQuestion(base)).toEqual([]));
  it("rejects duplicate options and missing answers", () => expect(auditQuestion({ ...base, correctAnswer: undefined, options: base.options.map((option) => ({ ...option, text: "same" })) }).map((issue) => issue.code)).toEqual(expect.arrayContaining(["DUPLICATE_OPTIONS", "MISSING_ANSWER"])));
});
