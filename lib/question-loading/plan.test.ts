import { describe, expect, it } from "vitest";
import { buildIndex, gradeKey, parseVerifiedCsv, resolveIndicator, standardCode, subjectMatches } from "../curriculum/verified";
import { buildPlan, describePlan, sha256 } from "./plan";
import type { LoadRow } from "./template";

const HEADER = "subject,grade,strand_no,strand,sub_strand,content_standard_code,content_standard,indicator_code,indicator,exemplars,page,wording_verified,flags";
const CSV = [HEADER,
  '"Science","B7","4","FORCES AND ENERGY","ENERGY","B7.4.1.1","Forms of energy","B7.4.1.1.1","Identify the various forms of energy","1) list || 2) classify","26","YES",""',
  '"Science","B7","4","FORCES AND ENERGY","ENERGY","B7.4.1.1","Forms of energy","B7.4.1.1.2","Explain daily applications of forms of energy","","27","YES",""',
  '"Creative Arts and Design","B7","1","DESIGN","Design in nature","B7 1.1.1","Design as a concept","B7 1.1.1.1","Demonstrate understanding of design","","2","YES","printed_code_nonstandard"',
  '"Biology","SHS 1","1","Diversity of living things","Classification","1.1.1","Classification","1.1.1.LI.1","Classify living things","","5","YES",""',
  '"Biology","SHS 1","2","Cells","Cell structure","1.1.1","Cell structure","1.1.1.LI.1","Describe the cell","","12","YES",""',
].join("\r\n");
const index = buildIndex(parseVerifiedCsv(CSV));

const row = (over: Partial<LoadRow> = {}): LoadRow => ({
  level: "JHS", grade: "B7", subject: "Science", strand: "FORCES AND ENERGY", sub_strand: "ENERGY", indicator_code: "B7.4.1.1.1", topic: "Forms of energy",
  concept: "energy forms", difficulty: "easy", cognitive_level: "Remember", answer_type: "SINGLE_CHOICE", question_text: "Which form of energy is stored in a battery?",
  option_a: "Chemical energy", option_b: "Sound energy", option_c: "Kinetic energy", option_d: "Light energy", correct_answer: "A",
  explanation: "A battery keeps its energy in chemical form until a circuit lets it flow, so the stored form is chemical energy.", source_reference: "NaCCA Science B7 p.26", source_quote: "", ...over });

describe("verified curriculum lookup", () => {
  it("reads the dataset and normalises levels", () => {
    expect(index.all).toHaveLength(5);
    expect(index.all.map((r) => r.level)).toEqual(["JHS", "JHS", "JHS", "SHS", "SHS"]);
    expect(index.subjects).toContain("Creative Arts and Design");
  });
  it("matches subjects, grades and printed codes the way teachers and NaCCA write them", () => {
    expect(subjectMatches("Creative Arts", "Creative Arts and Design")).toBe(true);
    expect(subjectMatches("RME", "Religious and Moral Education")).toBe(true);
    expect(subjectMatches("Science", "Social Studies")).toBe(false);
    expect([gradeKey("SHS1"), gradeKey("SHS 1"), gradeKey("Year One"), gradeKey("B10")]).toEqual(["shs1", "shs1", "shs1", "shs1"]);
    expect(standardCode("B7 1.1.1.1")).toBe("B7.1.1.1.1");
    expect(standardCode("B7. 2.1.1.1.")).toBe("B7.2.1.1.1");
    expect(standardCode("B 7.1.1.1.3")).toBe("B7.1.1.1.3");
    expect(standardCode("9.1.2.1.2")).toBe("B9.1.2.1.2");
  });
  it("resolves a question to one indicator, or says exactly why not", () => {
    expect(resolveIndicator(index, { subject: "Science", grade: "B7", indicator_code: "B7.4.1.1.1" })).toMatchObject({ status: "RESOLVED" });
    expect(resolveIndicator(index, { subject: "Creative Arts", grade: "B7", indicator_code: "B7.1.1.1.1" })).toMatchObject({ status: "RESOLVED" });
    expect(resolveIndicator(index, { subject: "Art", grade: "B7", indicator_code: "B7.1.1.1.1" }).status).toBe("UNKNOWN_SUBJECT");
    expect(resolveIndicator(index, { subject: "Science", grade: "B9", indicator_code: "B9.1.1.1.1" }).status).toBe("UNKNOWN_GRADE");
    expect(resolveIndicator(index, { subject: "Science", grade: "B7", indicator_code: "B7.9.9.9.9" }).status).toBe("UNKNOWN_INDICATOR");
  });
  it("uses strand and sub-strand when a code repeats", () => {
    expect(resolveIndicator(index, { subject: "Biology", grade: "SHS1", indicator_code: "1.1.1.LI.1" }).status).toBe("AMBIGUOUS_INDICATOR");
    const r = resolveIndicator(index, { subject: "Biology", grade: "SHS1", indicator_code: "1.1.1.LI.1", strand: "Cells", sub_strand: "Cell structure" });
    expect(r).toMatchObject({ status: "RESOLVED", indicator: { indicator: "Describe the cell" } });
  });
});

describe("loading plan", () => {
  const block = (topic: string, indicator_code: string, concepts: string[], n = 50) => Array.from({ length: n }, (_, i) => row({
    topic, indicator_code, concept: concepts[i % concepts.length], difficulty: i < 15 ? "easy" : i < 35 ? "medium" : "hard",
    question_text: `${topic} question ${i} asks learners about ${concepts[i % concepts.length]} in a different everyday situation number ${i}`,
    explanation: `Explanation ${i} for ${topic}: the idea of ${concepts[i % concepts.length]} applies here because it is the property this situation shows.` }));

  it("places every question, registers each topic with its concepts and difficulty, and is ready to load", () => {
    const rows = [...block("Forms of energy", "B7.4.1.1.1", ["energy forms", "energy sources", "energy chains"]), ...block("Daily uses of energy", "B7.4.1.1.2", ["home uses", "school uses", "farm uses"])];
    const plan = buildPlan({ rows, fileBytes: "file-1", scope: "CURRICULUM", index });
    expect(plan.unresolved).toEqual([]);
    expect(plan.topics).toHaveLength(2);
    expect(plan.topics[0]).toMatchObject({ title: "Forms of energy", rows: 50, easy: 15, medium: 20, hard: 15, concepts: ["energy forms", "energy sources", "energy chains"],
      indicator: { subject: "Science", grade: "B7", indicator_code: "B7.4.1.1.1", strand: "FORCES AND ENERGY" } });
    expect(plan.importRows).toHaveLength(100);
    expect(plan.fileSha256).toBe(sha256("file-1"));
    expect(plan.report.batchFlags.filter((f) => f.code.startsWith("QL_TOPIC"))).toEqual([]);
    expect(describePlan(plan).at(-1)).toBe(plan.canLoad ? "Ready to load." : `Blocked: ${plan.blockers.join(", ")}`);
  });

  it("blocks questions that cannot be placed on the curriculum and says why", () => {
    const rows = [...block("Forms of energy", "B7.4.1.1.1", ["energy forms", "energy sources", "energy chains"], 20), row({ subject: "Social Studies", indicator_code: "B7.1.1.1.1", topic: "Sanitation", question_text: "What is sanitation in a community setting today?" })];
    const plan = buildPlan({ rows, fileBytes: "file-2", scope: "CURRICULUM", index });
    expect(plan.canLoad).toBe(false);
    expect(plan.unresolved).toEqual([expect.objectContaining({ fileRow: 22, status: "UNKNOWN_SUBJECT", subject: "Social Studies" })]);
    expect(plan.blockers).toContain("QL_UNRESOLVED_INDICATORS:1");
    expect(describePlan(plan).join(" ")).toContain("1 unknown subject");
  });

  it("uses one consistent topic title when a batch drifted in spelling, and keeps concepts in first-seen order", () => {
    const rows = block("Forms of energy", "B7.4.1.1.1", ["energy forms", "energy sources", "energy chains"], 12).map((r, i) => (i === 0 ? { ...r, topic: "forms of energy " } : r));
    const plan = buildPlan({ rows, fileBytes: "file-3", scope: "CURRICULUM", index });
    expect(plan.topics).toHaveLength(1);
    expect(plan.topics[0].title).toBe("Forms of energy");
    expect(plan.topics[0].concepts).toEqual(["energy forms", "energy sources", "energy chains"]);
  });

  it("blocks a topic whose questions have no concept tags", () => {
    const rows = block("Forms of energy", "B7.4.1.1.1", ["x"], 10).map((r) => ({ ...r, concept: "" }));
    expect(buildPlan({ rows, fileBytes: "file-4", scope: "CURRICULUM", index }).blockers).toContain("QL_TOPIC_WITHOUT_CONCEPTS:1");
  });

  it("plans a sponsor document without a curriculum, grouping topics by chapter and section", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row({ level: "SPONSOR", grade: "", subject: "", indicator_code: "", strand: "Chapter 2", sub_strand: "Crossings", topic: "Zebra crossings",
      concept: ["right of way", "signs"][i % 2], source_quote: "drivers must give way to pedestrians", question_text: `Sponsor question ${i} about behaviour at a marked crossing in situation ${i}`,
      explanation: `Explanation ${i}: the guide says drivers give way to people on a marked crossing, so this behaviour is the safe one.` }));
    const plan = buildPlan({ rows, fileBytes: "file-5", scope: "SPONSOR", topicBlock: 30 });
    expect(plan.unresolved).toEqual([]);
    expect(plan.topics).toHaveLength(1);
    expect(plan.topics[0]).toMatchObject({ title: "Zebra crossings", rows: 30, concepts: ["right of way", "signs"] });
  });
});
