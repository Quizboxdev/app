import { describe, expect, it } from "vitest";
import { parseQuestionCsv } from "./csv";

describe("parseQuestionCsv", () => {
  it("reads comma separated questions, quoted fields and an optional header", () => {
    const r = parseQuestionCsv('Question,A,B,C,D,Correct,Explanation\nWhat is 7 x 8?,54,56,58,64,B,"7 x 8 = 56, not 54"\n"Which is a ""fruit""?",Yam,Mango,Cassava,Maize,b');
    expect(r.errors).toEqual([]);
    expect(r.questions).toEqual([
      { question_text: "What is 7 x 8?", options: ["54", "56", "58", "64"], correct_index: 1, explanation: "7 x 8 = 56, not 54" },
      { question_text: 'Which is a "fruit"?', options: ["Yam", "Mango", "Cassava", "Maize"], correct_index: 1, explanation: null },
    ]);
  });
  it("reads tab separated text such as a spreadsheet paste, and two or three option questions", () => {
    const r = parseQuestionCsv("Is the sun a star?\tYes\tNo\t\t\tA\nPick the odd one out\tDog\tCat\tTable\t\tC\tNot an animal");
    expect(r.errors).toEqual([]);
    expect(r.questions.map((q) => q.options.length)).toEqual([2, 3]);
    expect(r.questions[1].correct_index).toBe(2);
  });
  it("reports each bad line in plain words and keeps the good ones", () => {
    const r = parseQuestionCsv("Why?,a,b,c,d,A\nWhat is the capital of Ghana?,Accra,Kumasi,Tamale,Cape Coast,E\nWhat is the capital of Togo?,Lome,,Kara,,A\nA valid question here?,One,Two,,,B\nSame options here?,Yes,yes,,,A\nPick the right answer?,x,y,,,C");
    expect(r.questions).toHaveLength(1);
    expect(r.errors).toHaveLength(5);
    expect(r.errors[0]).toMatch(/Line 1.*too short/);
    expect(r.errors[1]).toMatch(/Line 2.*correct letter/);
    expect(r.errors[2]).toMatch(/Line 3.*no gaps/);
    expect(r.errors[3]).toMatch(/Line 5.*same/);
    expect(r.errors[4]).toMatch(/Line 6.*A to B/);
  });
  it("asks for something to add when empty", () => { expect(parseQuestionCsv("  \n ").errors[0]).toMatch(/Nothing to add/); });
});
