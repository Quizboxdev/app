import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { checkRows, normaliseRow, toImportRows } from "./check";
import { readCsv, readQuestionFile, readXlsx } from "./read";
import { LOAD_COLUMNS, type LoadRow } from "./template";

const row = (over: Partial<LoadRow> = {}): LoadRow => ({
  level: "JHS", grade: "B7", subject: "Science", strand: "Forces and Energy", sub_strand: "Conservation of Energy", indicator_code: "B7.4.3.1.2", topic: "energy conversion",
  difficulty: "medium", cognitive_level: "Apply", answer_type: "SINGLE_CHOICE",
  question_text: "A torch converts the chemical energy in its battery mainly into which two forms of energy?", option_a: "Light and heat", option_b: "Sound and light", option_c: "Kinetic and sound", option_d: "Chemical and heat",
  correct_answer: "A", explanation: "A battery stores chemical energy; in a torch it becomes light from the bulb and heat from the filament, not sound or motion.", source_reference: "NaCCA Science B7 p.34", source_quote: "conversion of energy into useable forms", ...over });
const sponsor = (over: Partial<LoadRow> = {}) => row({ level: "SPONSOR", grade: "", subject: "", indicator_code: "", strand: "Chapter 2", sub_strand: "Crossings", topic: "Zebra crossings", ...over });
const codes = (rows: LoadRow[], scope: "CURRICULUM" | "SPONSOR" = "CURRICULUM") => checkRows(rows, scope).issues.map((i) => i.code);
const csv = (rows: Array<Record<string, string>>) => [LOAD_COLUMNS.join(","), ...rows.map((r) => LOAD_COLUMNS.map((c) => `"${(r[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\r\n");
const bytes = (text: string) => new TextEncoder().encode(text);

describe("reading files", () => {
  it("reads CSV with quotes, commas, BOM and CRLF, and ignores unknown columns", () => {
    const text = "﻿" + LOAD_COLUMNS.join(",") + ",notes\r\n" + LOAD_COLUMNS.map((c) => c === "question_text" ? '"What is 2, or ""two""?"' : c === "level" ? "JHS" : "x").join(",") + ",extra\r\n";
    const parsed = readCsv(bytes(text));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].question_text).toBe('What is 2, or "two"?');
    expect(parsed.unknownColumns).toEqual(["notes"]);
    expect(parsed.fileRows).toEqual([2]);
  });
  it("rejects a header missing required columns, and empty files", () => {
    expect(() => readCsv(bytes("level,question_text\r\nJHS,x"))).toThrow(/QL_HEADER_INVALID: missing .*difficulty/);
    expect(() => readCsv(bytes(LOAD_COLUMNS.join(",") + "\r\n"))).toThrow("QL_FILE_EMPTY");
    return expect(readQuestionFile("notes.txt", bytes("x"))).rejects.toThrow("QL_FILE_TYPE_UNSUPPORTED");
  });
  it("reads .xlsx (shared and inline strings, sparse cells, QUESTIONS sheet chosen by name)", async () => {
    const shared = [...LOAD_COLUMNS, "JHS", "Which?", "B", "C"].map((t) => `<si><t>${t}</t></si>`).join("");
    const idx = (t: string) => [...LOAD_COLUMNS, "JHS", "Which?", "B", "C"].indexOf(t);
    const col = (i: number) => String.fromCharCode(65 + i);
    const head = LOAD_COLUMNS.map((c, i) => `<c r="${col(i)}1" t="s"><v>${idx(c)}</v></c>`).join("");
    const cells = [["level", `<c r="A2" t="s"><v>${idx("JHS")}</v></c>`], ["question_text", `<c r="K2" t="inlineStr"><is><t>Fish &amp; chips &lt;3?</t></is></c>`],
      ["correct_answer", `<c r="P2" t="s"><v>${idx("B")}</v></c>`], ["marks", `<c r="Z2"><v>1</v></c>`]].map(([, c]) => c).join("");
    const zip = new JSZip();
    zip.file("xl/workbook.xml", `<workbook><sheets><sheet name="README" sheetId="1" r:id="rId1"/><sheet name="QUESTIONS" sheetId="2" r:id="rId2"/></sheets></workbook>`);
    zip.file("xl/_rels/workbook.xml.rels", `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`);
    zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ignore me</t></is></c></row></sheetData></worksheet>`);
    zip.file("xl/worksheets/sheet2.xml", `<worksheet><sheetData><row r="1">${head}</row><row r="2">${cells}</row><row r="3"/></sheetData></worksheet>`);
    zip.file("xl/sharedStrings.xml", `<sst>${shared}</sst>`);
    const parsed = await readXlsx(await zip.generateAsync({ type: "uint8array" }));
    expect(parsed.sheet).toBe("QUESTIONS");
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ level: "JHS", question_text: "Fish & chips <3?", correct_answer: "B", option_a: "" });
  });
  it("reads the shipped Excel template: a valid header and no rows", async () => {
    const file = new Uint8Array(readFileSync("docs/question-loading/QuizBox_Question_Load_Template.xlsx"));
    await expect(readXlsx(file)).rejects.toThrow("QL_FILE_EMPTY");
  });
  it("refuses a file that is not a spreadsheet", () => expect(readXlsx(bytes("not a zip"))).rejects.toThrow("QL_FILE_UNREADABLE"));
});

describe("row rules (mirroring the database)", () => {
  it("accepts a well-formed curriculum row and a well-formed sponsor row", () => {
    expect(checkRows([row()], "CURRICULUM").canLoad).toBe(true);
    expect(checkRows([sponsor()], "SPONSOR").canLoad).toBe(true);
  });
  it("normalises case and spelling instead of rejecting it", () => {
    const fixed = normaliseRow(row({ level: "jhs", difficulty: "MEDIUM", cognitive_level: "analyze", answer_type: "single-choice", correct_answer: "a" }));
    expect(fixed).toMatchObject({ level: "JHS", difficulty: "medium", cognitive_level: "Analyse", answer_type: "SINGLE_CHOICE", correct_answer: "A" });
    expect(checkRows([row({ difficulty: "Easy", cognitive_level: "Analyze", correct_answer: "b" })], "CURRICULUM").canLoad).toBe(true);
  });
  it.each([
    ["QL_LEVEL", row({ level: "COLLEGE" })], ["QL_LEVEL_SCOPE_MISMATCH", row({ level: "SPONSOR" })], ["QL_INDICATOR_REQUIRED", row({ indicator_code: "" })], ["QL_GRADE_REQUIRED", row({ grade: "" })], ["QL_SUBJECT_REQUIRED", row({ subject: "" })],
    ["QL_DIFFICULTY", row({ difficulty: "expert" })], ["QL_COGNITIVE_LEVEL", row({ cognitive_level: "Memorise" })], ["QL_ANSWER_TYPE", row({ answer_type: "ESSAY" })], ["QL_QUESTION_REQUIRED", row({ question_text: "" })],
    ["QL_ANSWER_LEAKAGE", row({ question_text: "The answer is light. Which is it?" })], ["QL_UNSAFE_CONTENT", row({ question_text: "Is <b>this</b> allowed?" })], ["QL_UNSAFE_CONTENT", row({ option_a: "x < 5 and y > 3" })],
    ["QL_EXPLANATION_REQUIRED", row({ explanation: "" })], ["QL_PROVENANCE_REQUIRED", row({ source_reference: "p" })], ["QL_OPTIONS_REQUIRED", row({ option_d: "" })], ["QL_DUPLICATE_OPTIONS", row({ option_b: "light and heat!" })],
    ["QL_ANSWER_FORMAT", row({ correct_answer: "E" })], ["QL_SOURCE_QUOTE_LENGTH", row({ source_quote: "x".repeat(201) })],
  ])("flags %s", (code, bad) => expect(codes([bad])).toContain(code));
  it("checks TRUE_FALSE rules and double negatives", () => {
    const tf = (over: Partial<LoadRow>) => row({ answer_type: "TRUE_FALSE", option_a: "True", option_b: "False", option_c: "", option_d: "", correct_answer: "A", question_text: "Water boils at 100 degrees Celsius at sea level.", ...over });
    expect(checkRows([tf({})], "CURRICULUM").canLoad).toBe(true);
    expect(codes([tf({ option_a: "Yes" })])).toContain("QL_TRUE_FALSE_OPTIONS");
    expect(codes([tf({ correct_answer: "C" })])).toContain("QL_ANSWER_FORMAT");
    expect(codes([tf({ question_text: "It is not true that water never boils without heat." })])).toContain("QL_DOUBLE_NEGATIVE");
    expect(codes([tf({ option_c: "Maybe" })])).toContain("QL_TRUE_FALSE_EXTRA_OPTIONS");
  });
  it("requires topic and a source quote for sponsor pools, and warns about stray curriculum fields", () => {
    expect(codes([sponsor({ topic: "", source_quote: "" })], "SPONSOR")).toEqual(expect.arrayContaining(["QL_TOPIC_REQUIRED", "QL_SOURCE_QUOTE_REQUIRED"]));
    expect(codes([sponsor({ indicator_code: "B7.1.1.1" })], "SPONSOR")).toContain("QL_CURRICULUM_FIELDS_IGNORED");
    expect(codes([sponsor()], "CURRICULUM")).toContain("QL_LEVEL_SCOPE_MISMATCH");
  });
  it("flags all-of-the-above options and off-topic wrong options as warnings (not errors)", () => {
    const r = checkRows([row({ option_d: "All of the above" })], "CURRICULUM");
    expect(r.issues.find((i) => i.code === "QL_ALL_NONE_OF_THE_ABOVE")?.severity).toBe("warning");
    const off = checkRows([row({ question_text: "Which habitat feature helps animals living on a plateau?", strand: "Diversity", sub_strand: "Habitats", topic: "landforms",
      option_a: "Landforms provide different habitats because altitude, slope and soil vary", option_b: "Lever class depends on the positions of fulcrum, load and effort", option_c: "The water cycle involves evaporation, condensation and rainfall", option_d: "Digestion begins in the mouth and continues in the stomach", correct_answer: "A" })], "CURRICULUM");
    expect(off.issues.map((i) => i.code)).toContain("QL_OFF_TOPIC_OPTIONS");
    expect(off.canLoad).toBe(true);
  });
});

describe("duplicates and batch quality flags", () => {
  const many = (n: number, make: (i: number) => Partial<LoadRow>) => Array.from({ length: n }, (_, i) => row({ question_text: `Question number ${i} about energy sources and everyday uses in a village setting?`, ...make(i) }));
  it("rejects exact duplicates and warns on near-duplicates in the same indicator", () => {
    const dup = checkRows([row(), row()], "CURRICULUM");
    expect(dup.issues.filter((i) => i.code === "QL_DUPLICATE_QUESTION")).toEqual([{ row: 3, code: "QL_DUPLICATE_QUESTION", severity: "error", field: "question_text" }]);
    const near = checkRows([row({ question_text: "Which two forms of energy does a small torch battery mainly produce when it is switched on today?" }), row({ question_text: "Which two forms of energy does a small torch battery mainly produce when it is switched on now?" })], "CURRICULUM");
    expect(near.issues.map((i) => i.code)).toContain("QL_NEAR_DUPLICATE");
  });
  it("blocks a batch whose explanations are one template (the real Science sample pattern)", () => {
    const rows = many(30, (i) => ({ explanation: `The correct response states the accepted scientific idea required by B7.4.1.${i}. It directly addresses the item.` }));
    const r = checkRows(rows, "CURRICULUM");
    expect(r.batchFlags.find((f) => f.code === "QL_TEMPLATED_EXPLANATIONS")).toMatchObject({ severity: "error" });
    expect(r.canLoad).toBe(false);
  });
  it("only warns when a minority share one opening, and passes varied explanations", () => {
    const subjects = ["Batteries", "Bulbs", "Panels", "Turbines", "Candles", "Boilers", "Dams", "Engines", "Kilns", "Stoves"], verbs = ["store", "release", "convert"];
    const varied = many(30, (i) => ({ explanation: `${subjects[i % 10]} ${verbs[Math.floor(i / 10)]} energy in a way that fits this particular question number ${i}.` }));
    expect(checkRows(varied, "CURRICULUM").batchFlags.filter((f) => f.code === "QL_TEMPLATED_EXPLANATIONS")).toEqual([]);
    const mixed = many(30, (i) => ({ explanation: i < 8 ? `The correct response states the idea number ${i} clearly and fully.` : `Specific reason ${i} about ${["wind", "water", "coal", "oil", "sun"][i % 5]} energy and its use in homes.` }));
    expect(checkRows(mixed, "CURRICULUM").batchFlags.find((f) => f.code === "QL_TEMPLATED_EXPLANATIONS")?.severity).toBe("warning");
  });
  it("flags repeated question frames, answer-key skew and the longest-option cue", () => {
    const frames = many(30, (i) => ({ question_text: `A B7 learner is answering a question about topic ${i} in a classroom.`, correct_answer: "A", option_a: "The long and fully detailed correct statement about the topic here", option_b: "Short b", option_c: "Short c", option_d: "Short d" }));
    const codesOf = checkRows(frames, "CURRICULUM").batchFlags.map((f) => f.code);
    expect(codesOf).toEqual(expect.arrayContaining(["QL_REPEATED_STEM_PATTERN", "QL_ANSWER_KEY_SKEW", "QL_LONGEST_OPTION_CORRECT"]));
  });
  it("counts rows by level, grade, subject, indicator, difficulty and answer letter", () => {
    const r = checkRows([row(), row({ question_text: "Another question on forms of energy in everyday life?", difficulty: "hard", correct_answer: "B" })], "CURRICULUM");
    expect(r.counts.difficulty).toEqual({ medium: 1, hard: 1 });
    expect(r.counts.correct).toEqual({ A: 1, B: 1 });
    expect(r.counts.indicator).toEqual({ "B7.4.3.1.2": 2 });
  });
});

describe("hand-off to the existing import", () => {
  it("maps a template row to the admin import shape, keeping the source quote inside the 300-character provenance", () => {
    const [mapped] = toImportRows([row({ difficulty: "Medium" })]);
    expect(mapped).toMatchObject({ indicator_code: "B7.4.3.1.2", subject: "Science", grade: "B7", difficulty: "medium", correct_answer: "A" });
    expect(mapped.source_reference).toBe('NaCCA Science B7 p.34 | "conversion of energy into useable forms"');
    expect(toImportRows([row({ source_reference: "y".repeat(280), source_quote: "z".repeat(150) })])[0].source_reference).toHaveLength(300);
  });
  it("reports file row numbers (header = row 1) and survives a CSV round trip", async () => {
    const parsed = await readQuestionFile("batch.csv", bytes(csv([row() as never, { ...row({ question_text: "Another question on forms of energy used in everyday life at home?" }), correct_answer: "Z" } as never])));
    const report = checkRows(parsed.rows, "CURRICULUM", parsed.fileRows);
    expect(report.issues).toEqual([{ row: 3, code: "QL_ANSWER_FORMAT", severity: "error", field: "correct_answer" }]);
    expect(report).toMatchObject({ rows: 2, errorRows: 1, cleanRows: 1, canLoad: false });
  });
});
