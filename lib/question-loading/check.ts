import { normalize } from "../content/factory/contract";
import { similarity } from "../content/factory/duplicates";
import { ANSWER_TYPES, COGNITIVE_LEVELS, DIFFICULTIES, LEVELS, type LoadRow, type LoadScope } from "./template";

// Checks a parsed question file before anything touches the database. Rules mirror validateCandidate (lib/content/factory/contract.ts)
// and qb_content_factory_import; the quality flags exist because a file's own audit sheets are not evidence of quality
// (docs/uat/sample-delivery-audit-2026-10-10.md). Pure code.
export type Severity = "error" | "warning";
export type Issue = { row: number; code: string; severity: Severity; field?: string };
export type BatchFlag = { code: string; severity: Severity; share?: number; detail: string };
export type Counts = Record<string, number>;
export type Report = {
  rows: number; errorRows: number; warningRows: number; cleanRows: number; issues: Issue[]; batchFlags: BatchFlag[];
  counts: { level: Counts; grade: Counts; subject: Counts; indicator: Counts; difficulty: Counts; cognitive: Counts; answerType: Counts; correct: Counts };
  canLoad: boolean;
};

const HTML = /<[^>]*>|javascript:|data:|\bon\w+\s*=/i;
const LEAK = /\b(correct answer|answer key|the answer is)\b/i;
const DOUBLE_NEGATIVE = /\bnot\b.*\b(not|never|no)\b|\bnever\b.*\bnot\b/i;
const BAD_OPTION = /\b(all of the above|none of the above|both [a-d] and [a-d]|a and b|b and c)\b/i;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;
const words = (text: string) => new Set((text.toLowerCase().match(/\p{L}{4,}/gu) ?? []));
const opening = (text: string, n = 6) => normalize(text.replace(/[A-Z]+\d+(\.\d+)*/g, "").replace(/\d+/g, "")).split(" ").slice(0, n).join(" ");

const tally = (values: string[]): Counts => values.reduce<Counts>((acc, v) => { const k = v || "(blank)"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

// Fixes harmless case and spelling differences so a file is judged on content, not capitalisation.
export function normaliseRow(row: LoadRow): LoadRow {
  const cognitive = row.cognitive_level.trim().toLowerCase().replace(/^analyze$/, "analyse");
  return { ...row,
    level: row.level.trim().toUpperCase(), difficulty: row.difficulty.trim().toLowerCase(), answer_type: row.answer_type.trim().toUpperCase().replace(/[ -]/g, "_"),
    correct_answer: row.correct_answer.trim().toUpperCase(), cognitive_level: COGNITIVE_LEVELS.find((c) => c.toLowerCase() === cognitive) ?? row.cognitive_level.trim() };
}

export function checkRows(input: LoadRow[], scope: LoadScope, fileRows: number[] = input.map((_, i) => i + 2)): Report {
  const rows = input.map(normaliseRow), issues: Issue[] = [];
  const add = (i: number, code: string, severity: Severity, field?: string) => issues.push({ row: fileRows[i], code, severity, field });

  rows.forEach((r, i) => {
    const err = (code: string, field?: string) => add(i, code, "error", field), warn = (code: string, field?: string) => add(i, code, "warning", field);
    if (!(LEVELS as readonly string[]).includes(r.level)) err("QL_LEVEL", "level");
    else if (scope === "CURRICULUM" && r.level === "SPONSOR") err("QL_LEVEL_SCOPE_MISMATCH", "level");
    else if (scope === "SPONSOR" && r.level !== "SPONSOR") err("QL_LEVEL_SCOPE_MISMATCH", "level");
    if (scope === "CURRICULUM") {
      if (!r.indicator_code) err("QL_INDICATOR_REQUIRED", "indicator_code"); else if (!CODE.test(r.indicator_code)) err("QL_INDICATOR_FORMAT", "indicator_code");
      if (!r.grade) err("QL_GRADE_REQUIRED", "grade"); if (!r.subject) err("QL_SUBJECT_REQUIRED", "subject");
    } else {
      if (!r.topic) err("QL_TOPIC_REQUIRED", "topic");
      if (!r.source_quote) err("QL_SOURCE_QUOTE_REQUIRED", "source_quote");
      if (r.grade || r.subject || r.indicator_code) warn("QL_CURRICULUM_FIELDS_IGNORED");
    }
    if (r.source_quote.length > 200) err("QL_SOURCE_QUOTE_LENGTH", "source_quote");
    if (!(DIFFICULTIES as readonly string[]).includes(r.difficulty)) err("QL_DIFFICULTY", "difficulty");
    if (!(COGNITIVE_LEVELS as readonly string[]).includes(r.cognitive_level)) err("QL_COGNITIVE_LEVEL", "cognitive_level");
    if (!(ANSWER_TYPES as readonly string[]).includes(r.answer_type)) err("QL_ANSWER_TYPE", "answer_type");
    if (!r.question_text) err("QL_QUESTION_REQUIRED", "question_text");
    if (LEAK.test(r.question_text)) err("QL_ANSWER_LEAKAGE", "question_text");
    for (const field of ["question_text", "option_a", "option_b", "option_c", "option_d", "explanation"] as const)
      if (HTML.test(r[field])) err("QL_UNSAFE_CONTENT", field); else if (/[<>]/.test(r[field])) warn("QL_ANGLE_BRACKET", field);
    if (!r.explanation) err("QL_EXPLANATION_REQUIRED", "explanation"); else if (r.explanation.length < 40) warn("QL_THIN_EXPLANATION", "explanation");
    if (r.source_reference.length < 3 || r.source_reference.length > 300) err("QL_PROVENANCE_REQUIRED", "source_reference");
    const options = [r.option_a, r.option_b, r.option_c, r.option_d];
    if (r.answer_type === "SINGLE_CHOICE") {
      if (options.some((o) => !o)) err("QL_OPTIONS_REQUIRED");
      else if (new Set(options.map(normalize)).size !== 4) err("QL_DUPLICATE_OPTIONS");
      if (!["A", "B", "C", "D"].includes(r.correct_answer)) err("QL_ANSWER_FORMAT", "correct_answer");
      if (options.some((o) => BAD_OPTION.test(o))) warn("QL_ALL_NONE_OF_THE_ABOVE");
    } else if (r.answer_type === "TRUE_FALSE") {
      if (normalize(r.option_a) !== "true" || normalize(r.option_b) !== "false") err("QL_TRUE_FALSE_OPTIONS");
      if (!["A", "B"].includes(r.correct_answer)) err("QL_ANSWER_FORMAT", "correct_answer");
      if (r.option_c || r.option_d) warn("QL_TRUE_FALSE_EXTRA_OPTIONS");
      if (DOUBLE_NEGATIVE.test(r.question_text)) err("QL_DOUBLE_NEGATIVE", "question_text");
    }
    // Wrong options that share nothing with the question, the right answer or the topic labels are probably borrowed from another topic.
    if (r.answer_type === "SINGLE_CHOICE" && ["A", "B", "C", "D"].includes(r.correct_answer) && options.every(Boolean)) {
      const k = "ABCD".indexOf(r.correct_answer), context = new Set([...words(`${r.question_text} ${r.strand} ${r.sub_strand} ${r.topic}`), ...words(options[k])]);
      const stray = options.filter((_, j) => j !== k).filter((o) => { const w = words(o); return w.size >= 3 && ![...w].some((x) => context.has(x)); });
      if (stray.length >= 2) warn("QL_OFF_TOPIC_OPTIONS");
    }
  });

  // Duplicates: exact normalised stems anywhere in the file; near-duplicates within the same indicator or topic.
  const seen = new Map<string, number>();
  rows.forEach((r, i) => { const key = normalize(r.question_text); if (!key) return; if (seen.has(key)) add(i, "QL_DUPLICATE_QUESTION", "error", "question_text"); else seen.set(key, i); });
  const groups = new Map<string, number[]>();
  rows.forEach((r, i) => { const key = r.indicator_code || r.topic; if (key) groups.set(key, [...(groups.get(key) ?? []), i]); });
  for (const members of groups.values()) for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++)
    if (normalize(rows[members[a]].question_text) !== normalize(rows[members[b]].question_text) && similarity(rows[members[a]].question_text, rows[members[b]].question_text) >= 0.85) add(members[b], "QL_NEAR_DUPLICATE", "warning", "question_text");

  // Batch-level quality flags.
  const batchFlags: BatchFlag[] = [], total = rows.length;
  const dominance = (code: string, label: string, pick: (r: LoadRow) => string) => {
    if (total < 5) return;
    const counts = tally(rows.map(pick)); const [top, n] = Object.entries(counts).filter(([k]) => k && k !== "(blank)").sort((x, y) => y[1] - x[1])[0] ?? ["", 0];
    const share = n / total;
    if (share >= 0.2 && n >= 5) batchFlags.push({ code, severity: share >= 0.5 ? "error" : "warning", share: Math.round(share * 100) / 100, detail: `${n} of ${total} ${label} start "${top}"` });
  };
  dominance("QL_TEMPLATED_EXPLANATIONS", "explanations", (r) => opening(r.explanation));
  dominance("QL_REPEATED_STEM_PATTERN", "questions", (r) => opening(r.question_text));
  const correct = tally(rows.map((r) => r.correct_answer));
  const mcq = rows.filter((r) => r.answer_type === "SINGLE_CHOICE");
  if (mcq.length >= 20) { const top = Math.max(...["A", "B", "C", "D"].map((l) => mcq.filter((r) => r.correct_answer === l).length)) / mcq.length; if (top > 0.4) batchFlags.push({ code: "QL_ANSWER_KEY_SKEW", severity: "warning", share: Math.round(top * 100) / 100, detail: "one letter is correct in over 40% of multiple-choice questions" }); }
  const longest = mcq.filter((r) => { const o = [r.option_a, r.option_b, r.option_c, r.option_d]; const k = "ABCD".indexOf(r.correct_answer); return k >= 0 && o[k].length >= Math.max(...o.map((x) => x.length)); }).length;
  if (mcq.length >= 20 && longest / mcq.length > 0.5) batchFlags.push({ code: "QL_LONGEST_OPTION_CORRECT", severity: "warning", share: Math.round(longest / mcq.length * 100) / 100, detail: "the correct option is the longest in over half of the multiple-choice questions (a guessing cue)" });

  const errorRows = new Set(issues.filter((x) => x.severity === "error").map((x) => x.row)), warningRows = new Set(issues.filter((x) => x.severity === "warning").map((x) => x.row));
  return { rows: total, errorRows: errorRows.size, warningRows: [...warningRows].filter((r) => !errorRows.has(r)).length, cleanRows: total - new Set([...errorRows, ...warningRows]).size, issues, batchFlags,
    counts: { level: tally(rows.map((r) => r.level)), grade: tally(rows.map((r) => r.grade)), subject: tally(rows.map((r) => r.subject)), indicator: tally(rows.map((r) => r.indicator_code || r.topic)),
      difficulty: tally(rows.map((r) => r.difficulty)), cognitive: tally(rows.map((r) => r.cognitive_level)), answerType: tally(rows.map((r) => r.answer_type)), correct },
    canLoad: errorRows.size === 0 && !batchFlags.some((f) => f.severity === "error") };
}

// Shape accepted by the existing admin import (lib/content/factory/import.ts, qb_content_factory_import). Curriculum scope only.
export function toImportRows(rows: LoadRow[]) {
  return rows.map(normaliseRow).map((r) => ({
    indicator_code: r.indicator_code, subject: r.subject, grade: r.grade, question_text: r.question_text, answer_type: r.answer_type, option_a: r.option_a, option_b: r.option_b, option_c: r.option_c, option_d: r.option_d,
    correct_answer: r.correct_answer, explanation: r.explanation, difficulty: r.difficulty, cognitive_level: r.cognitive_level,
    source_reference: (r.source_quote ? `${r.source_reference} | "${r.source_quote}"` : r.source_reference).slice(0, 300) }));
}
