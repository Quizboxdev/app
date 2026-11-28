import type { EditableQuestion } from "./types";

// Pasted questions: question, option A, option B, option C, option D, correct letter, explanation (optional), source quote (optional, for questions written from an uploaded book).
// Commas or tabs separate the fields; a field containing a comma, tab or line break goes in double quotes (a quote inside is written twice).
// Options C and D may be left empty for two- or three-option questions. A header line starting with "question" is skipped.
// Chat assistants wrap their answer in a code block, number the lines or add a sentence before and after: those are ignored, so their answer can be pasted as it is.
// `lines` gives, for each question, the line of the box it came from.
export type ParsedQuestions = { questions: EditableQuestion[]; lines: number[]; errors: string[] };

function rows(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const out: { cells: string[]; line: number }[] = []; let row: string[] = [], field = "", quoted = false, line = 1, start = 1;
  const end = () => { row.push(field); field = ""; if (row.some((c) => c.trim() !== "")) out.push({ cells: row, line: start }); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else { if (ch === "\n") line++; field += ch; }
    } else if (ch === '"' && field.trim() === "") { quoted = true; field = ""; }
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; end(); line++; start = line; }
    else field += ch;
  }
  end();
  return out;
}

// Code fences become blank lines (keeping line numbers), and "1. " or "- " before a quoted line is removed.
const tidy = (text: string) => text.replace(/^﻿/, "").split(/\r?\n/).map((l) => (/^\s*```/.test(l) ? "" : l.replace(/^\s*(?:\d{1,3}[.)]|[-*•])\s+(?=")/, ""))).join("\n");

export function parseQuestionCsv(text: string): ParsedQuestions {
  const clean = tidy(text);
  const firstLine = clean.split("\n").find((l) => l.trim()) ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  // A line with no separator at all is a sentence from the assistant ("Here are five questions:"), not a question.
  const all = rows(clean, delimiter).filter((r) => r.cells.length > 1);
  if (all.length && /^question/i.test(all[0].cells[0]?.trim() ?? "")) all.shift();
  const questions: EditableQuestion[] = [], lines: number[] = [], errors: string[] = [];
  all.forEach(({ cells, line }) => {
    const [question = "", ...rest] = cells.map((c) => c.trim());
    const options = rest.slice(0, 4), letter = (rest[4] ?? "").replace(/[^A-Za-z]/g, "").toUpperCase(), explanation = rest[5] ?? "", quote = rest[6] ?? "";
    const present = options.reduce((last, o, i) => (o ? i + 1 : last), 0);
    const given = options.slice(0, present);
    if (question.length < 5) return void errors.push(`Line ${line}: the question is too short.`);
    if (question.length > 600) return void errors.push(`Line ${line}: the question is too long.`);
    if (present < 2 || given.some((o) => !o)) return void errors.push(`Line ${line}: give at least two options with no gaps.`);
    if (!/^[A-D]$/.test(letter) || letter.charCodeAt(0) - 65 >= present) return void errors.push(`Line ${line}: the correct letter must be A to ${String.fromCharCode(64 + present)}.`);
    if (new Set(given.map((o) => o.toLowerCase())).size !== given.length) return void errors.push(`Line ${line}: two options are the same.`);
    if (quote.length > 300) return void errors.push(`Line ${line}: the source quote is too long.`);
    questions.push({ question_text: question, options: given, correct_index: letter.charCodeAt(0) - 65, explanation: explanation || null, ...(quote ? { source_quote: quote } : {}) });
    lines.push(line);
  });
  if (!all.length) errors.push("Nothing to add: paste at least one question.");
  return { questions, lines, errors };
}
