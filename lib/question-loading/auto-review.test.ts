import { describe, expect, it } from "vitest";
import { questionFlags, reviewFile, reviewSample } from "./auto-review";
import type { SampleQuestion } from "@/lib/api/owner";

const q = (i: number, over: Partial<SampleQuestion> = {}): SampleQuestion => ({
  id: `id${i}`, question: `Which of these best describes item number ${i} in the lesson?`,
  a: `A short answer ${i}`, b: `Another option about ${i} here`, c: `Third plausible choice ${i}`, d: `Fourth different idea ${i}`, correct: "ABCD"[i % 4], difficulty: "easy", ...over,
});
const sample = (n = 20, over: (i: number) => Partial<SampleQuestion> = () => ({})) => Array.from({ length: n }, (_, i) => q(i, over(i)));
const preview = (s: SampleQuestion[], over: Record<string, unknown> = {}) => ({ file: "B4_Mathematics.delta-01.csv", questions_found: 1000, would_approve: 1000, already_available_to_learners: 0, min_sample_required: 20, sample: s, ...over });

describe("auto review of a batch sample", () => {
  it("passes a clean, balanced sample and writes a note that says no person read it", () => {
    const v = reviewSample(preview(sample()));
    expect(v).toMatchObject({ pass: true, checked: 20, flags: [] });
    expect(v.note).toMatch(/no human read/i);
    expect(v.note).toMatch(/20 of 1000/);
    expect(v.note.length).toBeLessThanOrEqual(1000);
  });

  it("flags a question with a missing or unmatched answer, empty options or duplicate options", () => {
    expect(questionFlags(q(1, { correct: "E" }))).toContain("marked answer does not point at an option");
    expect(questionFlags(q(1, { b: null, c: null, d: null }))).toContain("fewer than two options");
    expect(questionFlags(q(1, { b: "A short answer 1." }))).toContain("two options say the same thing");
    expect(questionFlags(q(1, { question: "Too short" }))).toContain("question text missing or too short");
    expect(questionFlags(q(1, { correct: "C", c: null }))).toContain("marked answer does not point at an option");
  });

  it("flags a filler ending stuck on the wrong options only, but not an ending every option shares", () => {
    const filler = (x: Partial<SampleQuestion>) => questionFlags(q(0, { correct: "A", a: "The sun rises in the east", b: "Cows fly south in winter and as a result of this", c: "Fish walk on land and as a result of this", d: "Rain is dry and as a result of this", ...x }));
    expect(filler({}).join()).toMatch(/share an ending/);
    expect(filler({ a: "The sun rises in the east and as a result of this" })).toEqual([]);
  });

  it("flags a question that already contains its right answer", () => {
    expect(questionFlags(q(2, { question: "Photosynthesis happens in the chloroplast of a leaf cell, so where does it happen?", correct: "A", a: "the chloroplast of a leaf cell" })).join()).toMatch(/already contains/);
  });

  it("fails the batch on one flagged question, naming it", () => {
    const v = reviewSample(preview(sample(20, (i) => (i === 7 ? { b: "A short answer 7" } : {}))));
    expect(v.pass).toBe(false);
    expect(v.flags[0]).toMatch(/^sample 8:/);
    expect(v.note).toMatch(/Script check failed/);
  });

  it("fails when the right answer is nearly always the longest option, or one letter nearly always right", () => {
    const longest = reviewSample(preview(sample(20, (i) => ({ correct: "ABCD"[i % 4], [["a", "b", "c", "d"][i % 4]]: `The correct answer written much longer than any other option ${i}` }))));
    expect(longest.flags.join()).toMatch(/longest option in 20 of 20/);
    const letter = reviewSample(preview(sample(20, () => ({ correct: "B" }))));
    expect(letter.flags.join()).toMatch(/answer B is correct in 20 of 20/);
  });

  it("does not apply the length and letter rules to true or false questions", () => {
    const tf = sample(20, () => ({ a: "True", b: "False", c: null, d: null, correct: "A" }));
    expect(reviewSample(preview(tf)).pass).toBe(true);
  });

  it("fails on batch facts: a small sample, nothing to approve, questions already live, too many invalid, a repeated question", () => {
    expect(reviewSample(preview(sample(12), { questions_found: 12, would_approve: 12 })).flags.join()).toMatch(/sample has 12 questions, 20 are required/);
    expect(reviewSample(preview(sample(), { would_approve: 0 })).flags.join()).toMatch(/nothing in this batch/);
    expect(reviewSample(preview(sample(), { already_available_to_learners: 3 })).flags.join()).toMatch(/already live/);
    expect(reviewSample(preview(sample(), { would_approve: 900 })).flags.join()).toMatch(/only 900 of 1000 pass/);
    expect(reviewSample(preview(sample(20, (i) => (i === 3 ? { question: q(2).question } : {})))).flags.join()).toMatch(/appears twice/);
  });
});

describe("full-file check", () => {
  const row = (i: number, over: Record<string, string> = {}) => ({ question_text: `Which of these best describes item number ${i} in the lesson?`, option_a: `A short answer ${i}`, option_b: `Another option about ${i} here`, option_c: `Third plausible choice ${i}`, option_d: `Fourth different idea ${i}`, correct_answer: "ABCD"[i % 4], ...over });
  const rows = (n: number, bad: (i: number) => Record<string, string> = () => ({})) => Array.from({ length: n }, (_, i) => row(i, bad(i)));

  it("passes a clean file and lists nothing", () => {
    const v = reviewFile(rows(200), Array.from({ length: 200 }, (_, i) => i + 2));
    expect(v).toMatchObject({ rows: 200, hold: false, share: 0 });
    expect(v.flagged).toEqual([]);
    expect(v.summary).toMatch(/all 200 rows passed/);
  });

  it("lists the bad rows with their file row, and still lets a file with 1% or fewer through", () => {
    const w = reviewFile(rows(200, (i) => ((i === 10 || i === 50 ? { correct_answer: "E" } : {}) as Record<string, string>)), Array.from({ length: 200 }, (_, i) => i + 2));
    expect(w.flagged.map((f) => f.fileRow)).toEqual([12, 52]);
    expect(w.hold).toBe(false);       // exactly 1% is allowed
  });

  it("holds a file when more than 1% of its rows break a rule", () => {
    const v = reviewFile(rows(200, (i) => ((i < 3 ? { correct_answer: "E" } : {}) as Record<string, string>)), Array.from({ length: 200 }, (_, i) => i + 2));
    expect(v.hold).toBe(true);
    expect(v.summary).toMatch(/3 of 200 rows \(1\.5%\)/);
  });

  it("flags an option that stops in the middle of a sentence", () => {
    const cut = questionFlags(q(1, { a: "It establishes an active purpose for reading, motivating the learner to seek confirmation of" }));
    expect(cut.join()).toMatch(/stops in the middle of a sentence/);
    expect(questionFlags(q(1, { a: "It establishes an active purpose for reading and motivates the learner." }))).toEqual([]);
    expect(questionFlags(q(1, { a: "The sum of" }))).toEqual([]);      // a short option is not judged
  });
});

describe("full-file check: fixed-length options", () => {
  const mk = (i: number, len: number) => ({ question_text: `Which of these best describes item number ${i} in the lesson?`, ...Object.fromEntries(["option_a", "option_b", "option_c", "option_d"].map((k, j) => [k, Array.from({ length: len + (j % 3) }, (_, w) => `word${i}x${w}`).join(" ")])), correct_answer: "ABCD"[i % 4] }) as Parameters<typeof reviewFile>[0][number];
  it("holds a file whose options are almost all 14 to 16 words long", () => {
    const v = reviewFile(Array.from({ length: 100 }, (_, i) => mk(i, 14)), Array.from({ length: 100 }, (_, i) => i + 2));
    expect(v.hold).toBe(true);
    expect(v.summary).toMatch(/14 to 16 words long/);
  });
  it("does not hold a file whose options have many different lengths", () => {
    const v = reviewFile(Array.from({ length: 100 }, (_, i) => mk(i, 3 + (i % 20))), Array.from({ length: 100 }, (_, i) => i + 2));
    expect(v.summary).not.toMatch(/fixed length/);
  });
});
