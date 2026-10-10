import { describe, expect, it } from "vitest";
import { checkRows } from "./check";
import { balanceAnswerKey, targetLetters } from "./balance";
import { normaliseText, verifySource, type SourcePage } from "./source";
import type { LoadRow } from "./template";

const row = (over: Partial<LoadRow> = {}): LoadRow => ({
  level: "JHS", grade: "B7", subject: "Social Studies", strand: "Strand 1", sub_strand: "Mapping", indicator_code: "B7.1.2.1.1", topic: "maps", concept: "map components",
  difficulty: "easy", cognitive_level: "Remember", answer_type: "SINGLE_CHOICE", question_text: "Which map component shows direction and orientation?",
  option_a: "Map key", option_b: "North arrow", option_c: "Linear scale", option_d: "Cartographic grid", correct_answer: "B",
  explanation: "The North arrow shows orientation. A map key decodes symbols and the scale measures distance, so neither points to direction.", source_reference: "Page 24",
  source_quote: "Identify components of maps, including North arrow, scale, map key", ...over });
const rowsOf = (n: number, make: (i: number) => Partial<LoadRow>) => Array.from({ length: n }, (_, i) => row({ question_text: `Question ${i} about the use of maps for finding places in a district?`, ...make(i) }));

describe("meta references to the curriculum", () => {
  it("warns when a curriculum question asks what the curriculum lists", () => {
    for (const stem of ["Which of the following is listed in the curriculum as a source of energy?", "According to the syllabus, which river is in Ghana?", "Which type of map is named in the Social Studies curriculum?"])
      expect(checkRows([row({ question_text: stem })], "CURRICULUM").issues.map((i) => i.code)).toContain("QL_META_REFERENCE");
    expect(checkRows([row({ question_text: "Which map component shows direction?" })], "CURRICULUM").issues.map((i) => i.code)).not.toContain("QL_META_REFERENCE");
  });
  it("raises a batch flag when a fifth or more of the questions do it", () => {
    const flagged = checkRows(rowsOf(10, (i) => ({ question_text: i < 3 ? `Which feature in set ${i} is listed in the curriculum as a landform?` : `Question ${i} about the use of maps for finding places in a district?` })), "CURRICULUM");
    expect(flagged.batchFlags.map((f) => f.code)).toContain("QL_MANY_META_REFERENCES");
  });
});

describe("answer-key balancing", () => {
  const letters = (rows: LoadRow[]) => rows.map((r) => r.correct_answer);
  it("builds equal letter counts with no run of three", () => {
    for (const n of [8, 25, 100, 101]) {
      const t = targetLetters(n, 7), c = (l: string) => t.filter((x) => x === l).length;
      expect(Math.max(c("A"), c("B"), c("C"), c("D")) - Math.min(c("A"), c("B"), c("C"), c("D"))).toBeLessThanOrEqual(1);
      expect(t.some((x, i) => i >= 2 && x === t[i - 1] && x === t[i - 2])).toBe(false);
    }
  });
  it("moves the whole correct option text and keeps every other option", () => {
    const input = rowsOf(40, (i) => ({ option_a: `Right ${i}`, option_b: `Wrong b ${i}`, option_c: `Wrong c ${i}`, option_d: `Wrong d ${i}`, correct_answer: "A", explanation: `Reasoning for question ${i}: the right option fits because of the stated principle.` }));
    const { rows, report } = balanceAnswerKey(input, 3);
    expect(report.before).toEqual({ A: 40, B: 0, C: 0, D: 0 });
    expect(report.after).toEqual({ A: 10, B: 10, C: 10, D: 10 });
    rows.forEach((r, i) => {
      const options = [r.option_a, r.option_b, r.option_c, r.option_d];
      expect(options["ABCD".indexOf(r.correct_answer)]).toBe(`Right ${i}`);
      expect([...options].sort()).toEqual([`Right ${i}`, `Wrong b ${i}`, `Wrong c ${i}`, `Wrong d ${i}`].sort());
    });
    expect(balanceAnswerKey(input, 3).rows).toEqual(rows);
    expect(checkRows(rows, "CURRICULUM").batchFlags.map((f) => f.code)).not.toContain("QL_ANSWER_KEY_SKEW");
  });
  it("leaves TRUE_FALSE rows, malformed rows and rows that point at option positions alone", () => {
    const input = [row({ answer_type: "TRUE_FALSE", option_a: "True", option_b: "False", option_c: "", option_d: "", correct_answer: "B" }),
      row({ question_text: "Which option is wrong?", option_a: "Both A and B", correct_answer: "C" }),
      row({ explanation: "Option B is right because it names the North arrow, which the other options do not." })];
    const { rows, report } = balanceAnswerKey(input, 1);
    expect(letters(rows)).toEqual(letters(input.map((r) => ({ ...r }))));
    expect(report.skipped).toEqual([2, 3]);
    expect(report.eligible).toBe(0);
  });
});

describe("source verification", () => {
  const pages: SourcePage[] = [
    { n: 1, text: "Contents and preface." },
    { n: 25, text: "B7.1.2.1 Demonstrate skills in mapping\nB7.1.2.1.1 Identify components of maps,\u00a0including North arrow, scale, map key allowing representation of physical features" },
    { n: 26, text: "Discuss human activitiesthat affect the following features and ways of protecting them: (i) mountains (ii) rivers" },
    { n: 27, text: "Show documentaries or listen to personal accounts on the 28 th February riots in Accra / visit the spot where the ex- servicemen were killed." },
  ];
  it("normalises quotes, spaces and punctuation", () => expect(normaliseText("“Hot”  desert—Sahara,\nKalahari")).toBe("hot desert sahara kalahari"));
  it("finds verbatim quotes, including across extraction spacing, and fragments split by an ellipsis", () => {
    const { issues, summary } = verifySource([row(), row({ source_quote: "human activities that affect the following features and ways of protecting them... rivers", source_reference: "Page 24" })], pages, "CURRICULUM");
    expect(issues.filter((i) => i.code.startsWith("QL_QUOTE"))).toEqual([]);
    expect(summary).toMatchObject({ exact: 2, near: 0, missing: 0 });
  });
  it("flags light paraphrases as warnings and invented or stitched quotes as errors", () => {
    const { issues } = verifySource([row({ source_quote: "Identify components of maps, including the North arrow, scale and map key allowing representation of physical features" }),
      row({ source_quote: "The government must plant ten million trees every single year" }),
      row({ source_quote: "personal accounts on the 28th February riots in which ex-servicemen were killed in Accra" })], pages, "CURRICULUM");
    expect(issues.map((i) => [i.row, i.code, i.severity])).toEqual([[2, "QL_QUOTE_NOT_VERBATIM", "warning"], [3, "QL_QUOTE_NOT_IN_SOURCE", "error"], [4, "QL_QUOTE_NOT_VERBATIM", "warning"]]);
  });
  it("learns the printed-page offset and flags rows that depart from it", () => {
    const many = Array.from({ length: 6 }, () => row({ source_reference: "Page 23" }));
    const { issues, summary } = verifySource([...many, row({ source_reference: "Page 30" })], pages, "CURRICULUM");
    expect(summary.pageOffset).toBe(2);
    expect(issues.filter((i) => i.code === "QL_PAGE_MISMATCH").map((i) => i.row)).toEqual([8]);
  });
  it("checks indicator codes exist in a curriculum source, and ignores them for sponsor documents", () => {
    const withUnknown = [row(), row({ indicator_code: "B7.9.9.9.9" })];
    const checked = verifySource(withUnknown, pages, "CURRICULUM");
    expect(checked.summary).toMatchObject({ indicatorsChecked: 2, indicatorsMissing: ["B7.9.9.9.9"] });
    expect(checked.issues.map((i) => [i.row, i.code])).toContainEqual([3, "QL_INDICATOR_NOT_IN_SOURCE"]);
    expect(verifySource(withUnknown, pages, "SPONSOR").summary.indicatorsChecked).toBe(0);
  });
});

describe("topic blocks (teachers assign by topic)", () => {
  // A full block: 50 questions, 15 easy / 20 medium / 15 hard, four concepts.
  const block = (topic: string, over: (i: number) => Partial<LoadRow> = () => ({})) => Array.from({ length: 50 }, (_, i) => row({
    topic, concept: ["components", "scale", "direction", "symbols"][i % 4], difficulty: i < 15 ? "easy" : i < 35 ? "medium" : "hard",
    question_text: `${topic} question number ${i} about how learners use maps to find places`, ...over(i) }));
  it("requires a topic for curriculum questions as well", () => {
    expect(checkRows([row({ topic: "" })], "CURRICULUM").issues.map((i) => i.code)).toContain("QL_TOPIC_REQUIRED");
  });
  it("accepts complete blocks and summarises each topic", () => {
    const report = checkRows([...block("Components of maps"), ...block("Types of maps")], "CURRICULUM");
    expect(report.batchFlags.filter((f) => f.code.startsWith("QL_TOPIC"))).toEqual([]);
    expect(report.topics).toEqual([
      { indicator: "B7.1.2.1.1", topic: "Components of maps", rows: 50, easy: 15, medium: 20, hard: 15, concepts: 4, withoutConcept: 0 },
      { indicator: "B7.1.2.1.1", topic: "Types of maps", rows: 50, easy: 15, medium: 20, hard: 15, concepts: 4, withoutConcept: 0 }]);
  });
  it("flags a topic that is not 50 questions, and honours a different target", () => {
    const short = checkRows([...block("Components of maps"), ...block("Types of maps").slice(0, 30)], "CURRICULUM");
    expect(short.batchFlags.find((f) => f.code === "QL_TOPIC_BLOCK_SIZE")?.detail).toContain("Types of maps (30)");
    expect(checkRows(block("Components of maps").slice(0, 30), "CURRICULUM", undefined, { topicBlock: 30 }).batchFlags.map((f) => f.code)).not.toContain("QL_TOPIC_BLOCK_SIZE");
  });
  it("flags lopsided difficulty and thin concept coverage inside a topic", () => {
    const lopsided = checkRows(block("Components of maps", (i) => ({ difficulty: i < 40 ? "easy" : "medium" })), "CURRICULUM");
    expect(lopsided.batchFlags.map((f) => f.code)).toContain("QL_TOPIC_DIFFICULTY_SPREAD");
    const thin = checkRows(block("Components of maps", () => ({ concept: "components" })), "CURRICULUM");
    expect(thin.batchFlags.map((f) => f.code)).toContain("QL_TOPIC_FEW_CONCEPTS");
    expect(checkRows(block("Components of maps", () => ({ concept: "" })), "CURRICULUM").topics[0].withoutConcept).toBe(50);
  });
  it("spots the same topic written two ways under one indicator", () => {
    const rows = [...block("Components of maps").slice(0, 25), ...block("Map components").slice(0, 25).map((r) => ({ ...r, question_text: r.question_text + " today" }))];
    expect(checkRows(rows, "CURRICULUM").batchFlags.map((f) => f.code)).toContain("QL_TOPIC_NAME_VARIANTS");
  });
});
