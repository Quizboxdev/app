// Client-safe structured import parsing. Rows are only pre-checked here; the server re-validates market,
// curriculum, indicator, provenance and answer format, and every accepted row enters review (never published).
export const IMPORT_COLUMNS = ["indicator_code", "subject", "grade", "question_text", "answer_type", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation", "difficulty", "cognitive_level", "source_reference"] as const;
export type ImportRow = Partial<Record<typeof IMPORT_COLUMNS[number], string>>;
export type RowIssue = { row: number; code: string };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch; continue; }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(field); field = ""; if (row.some((v) => v.trim())) rows.push(row); row = []; }
    else field += ch;
  }
  row.push(field); if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

export function parseImport(text: string, format: "csv" | "json"): ImportRow[] {
  if (format === "json") {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("IMPORT_JSON_ARRAY_REQUIRED");
    return parsed.map((r) => Object.fromEntries(IMPORT_COLUMNS.map((k) => [k, r?.[k] == null ? undefined : String(r[k])])) as ImportRow);
  }
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  if (!["indicator_code", "question_text", "correct_answer", "source_reference"].every((k) => keys.includes(k))) throw new Error("IMPORT_HEADER_INVALID");
  return body.map((cells) => Object.fromEntries(keys.filter((k) => (IMPORT_COLUMNS as readonly string[]).includes(k)).map((k) => [k, cells[keys.indexOf(k)]?.trim() ?? ""])) as ImportRow);
}

export function precheckRows(rows: ImportRow[]): RowIssue[] {
  const issues: RowIssue[] = [];
  if (rows.length > 500) issues.push({ row: 0, code: "IMPORT_TOO_MANY_ROWS" });
  rows.forEach((r, i) => {
    const row = i + 1, type = r.answer_type || "SINGLE_CHOICE";
    if (!r.indicator_code?.trim()) issues.push({ row, code: "IMPORT_INDICATOR_REQUIRED" });
    if (!r.question_text?.trim()) issues.push({ row, code: "IMPORT_QUESTION_REQUIRED" });
    if (!r.source_reference || r.source_reference.trim().length < 3) issues.push({ row, code: "IMPORT_PROVENANCE_REQUIRED" });
    if (!["SINGLE_CHOICE", "TRUE_FALSE"].includes(type)) issues.push({ row, code: "IMPORT_ANSWER_TYPE" });
    if (type === "TRUE_FALSE" ? !["A", "B"].includes(r.correct_answer ?? "") : !["A", "B", "C", "D"].includes(r.correct_answer ?? "")) issues.push({ row, code: "IMPORT_ANSWER_FORMAT" });
    if (type === "SINGLE_CHOICE" && [r.option_a, r.option_b, r.option_c, r.option_d].some((o) => !o?.trim())) issues.push({ row, code: "IMPORT_OPTIONS_REQUIRED" });
    if (!r.explanation?.trim()) issues.push({ row, code: "IMPORT_EXPLANATION_REQUIRED" });
    if (r.difficulty && !["easy", "medium", "hard"].includes(r.difficulty)) issues.push({ row, code: "IMPORT_DIFFICULTY" });
  });
  return issues;
}

// Mirrors the server apportionment for previews and tests: integer shares that always total `total`.
export function apportion(total: number, weights: Record<string, number>): Record<string, number> {
  const entries = Object.entries(weights).map(([k, w]) => [k, Math.max(0, w)] as const), sum = entries.reduce((s, [, w]) => s + w, 0);
  if (!sum) return Object.fromEntries(entries.map(([k]) => [k, 0]));
  const base = entries.map(([k, w]) => { const raw = total * w / sum; return { k, n: Math.floor(raw), frac: raw - Math.floor(raw) }; });
  let left = total - base.reduce((s, b) => s + b.n, 0);
  for (const b of [...base].sort((x, y) => y.frac - x.frac || (x.k < y.k ? -1 : 1))) { if (left <= 0) break; b.n++; left--; }
  return Object.fromEntries(base.map((b) => [b.k, b.n]));
}

export function campaignEstimate(target: number, batchSize: number, maxJobsPerExecution: number, seniorReview: boolean) {
  const jobs = Math.ceil(target / batchSize);
  return { jobs, executions: Math.ceil(jobs / maxJobsPerExecution), primaryReviews: target, seniorReviews: seniorReview ? target : 0 };
}
