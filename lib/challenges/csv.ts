import type { EditableQuestion } from "./types";

// Pasted questions: question, option A, option B, option C, option D, correct letter, explanation (optional), source quote (optional, for questions written from an uploaded book).
// Commas or tabs separate the fields; a field containing a comma, tab or line break goes in double quotes (a quote inside is written twice).
// Options C and D may be left empty for two- or three-option questions. A header line starting with "question" is skipped.
export type ParsedQuestions = { questions: EditableQuestion[]; errors: string[] };

function rows(text: string, delimiter: string): string[][] {
  const out: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some((c) => c.trim() !== "")) out.push(row); row = []; }
    else field += ch;
  }
  row.push(field); if (row.some((c) => c.trim() !== "")) out.push(row);
  return out;
}

export function parseQuestionCsv(text: string): ParsedQuestions {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const all = rows(clean, delimiter);
  if (all.length && /^question/i.test(all[0][0]?.trim() ?? "")) all.shift();
  const questions: EditableQuestion[] = [], errors: string[] = [];
  all.forEach((cells, n) => {
    const line = n + 1, [question = "", ...rest] = cells.map((c) => c.trim());
    const options = rest.slice(0, 4), letter = (rest[4] ?? "").toUpperCase(), explanation = rest[5] ?? "", quote = rest[6] ?? "";
    const present = options.reduce((last, o, i) => (o ? i + 1 : last), 0);
    const given = options.slice(0, present);
    if (question.length < 5) return void errors.push(`Line ${line}: the question is too short.`);
    if (question.length > 600) return void errors.push(`Line ${line}: the question is too long.`);
    if (present < 2 || given.some((o) => !o)) return void errors.push(`Line ${line}: give at least two options with no gaps.`);
    if (!/^[A-D]$/.test(letter) || letter.charCodeAt(0) - 65 >= present) return void errors.push(`Line ${line}: the correct letter must be A to ${String.fromCharCode(64 + present)}.`);
    if (new Set(given.map((o) => o.toLowerCase())).size !== given.length) return void errors.push(`Line ${line}: two options are the same.`);
    if (quote.length > 300) return void errors.push(`Line ${line}: the source quote is too long.`);
    questions.push({ question_text: question, options: given, correct_index: letter.charCodeAt(0) - 65, explanation: explanation || null, ...(quote ? { source_quote: quote } : {}) });
  });
  if (!all.length) errors.push("Nothing to add: paste at least one question.");
  return { questions, errors };
}
