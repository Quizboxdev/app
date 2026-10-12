import { parseCsv } from "../content/factory/import";

// Reader and lookup for the verified curriculum datasets (QuizBox/curriculum_verified/JHS_indicators_verified.csv, SHS_indicators_verified.csv).
// Pure code: the file is read by the caller. Used by the question loader to place every question on a real learning indicator.
export type VerifiedIndicator = {
  subject: string; grade: string; strand_no: string; strand: string; sub_strand: string; content_standard_code: string; content_standard: string;
  indicator_code: string; indicator: string; exemplars: string; page: string; wording_verified: string; flags: string; level: "Primary" | "JHS" | "SHS" | "OTHER";
  printed_code?: string; // the code exactly as the source document prints it, when the file carries it (JHS, SHS and Primary extracts do)
  node_id?: string; // set when the row is a learning indicator already loaded into the database
};

const COLUMNS = ["subject", "grade", "strand_no", "strand", "sub_strand", "content_standard_code", "content_standard", "indicator_code", "indicator", "exemplars", "page", "wording_verified", "flags"] as const;

export function parseVerifiedCsv(text: string): VerifiedIndicator[] {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  const missing = ["subject", "grade", "indicator_code", "indicator"].filter((k) => !keys.includes(k));
  if (missing.length) throw new Error(`CURRICULUM_FILE_HEADER_INVALID: missing ${missing.join(", ")}`);
  return body.filter((cells) => cells.some((c) => c.trim())).map((cells) => {
    const row = Object.fromEntries(COLUMNS.map((c) => [c, (cells[keys.indexOf(c)] ?? "").trim()])) as Omit<VerifiedIndicator, "level">;
    const printed = keys.includes("printed_code") ? (cells[keys.indexOf("printed_code")] ?? "").trim() : "";
    return { ...row, ...(printed ? { printed_code: printed } : {}), level: gradeKey(row.grade).startsWith("shs") ? "SHS" : /^B([789])$/i.test(row.grade.trim()) ? "JHS" : /^B([456])$/i.test(row.grade.trim()) ? "Primary" : "OTHER" } as VerifiedIndicator;
  });
}

export const keyOf = (s: string) => (s ?? "").normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// "SHS1", "shs 1", "Year One" and the CCP's B10 (the first SHS year in the Common Core Programme) all mean SHS 1.
export function gradeKey(grade: string): string {
  const g = keyOf(grade).replace(/\s+/g, "");
  const words: Record<string, string> = { yearone: "shs1", yeartwo: "shs2", yearthree: "shs3", b10: "shs1" };
  return words[g] ?? g;
}
// A question file may name a subject more briefly than the curriculum title ("Creative Arts" for "Creative Arts and Design").
const SUBJECT_ALIASES: Record<string, string> = { rme: "religious and moral education", ict: "information and communication technology", pe: "physical education and health" };
export function subjectMatches(fileSubject: string, curriculumSubject: string): boolean {
  const a = SUBJECT_ALIASES[keyOf(fileSubject)] ?? keyOf(fileSubject), b = keyOf(curriculumSubject);
  return Boolean(a) && (a === b || b.startsWith(`${a} `) || a.startsWith(`${b} `));
}
// Printed codes are inconsistent ("B7 1.1.1.1", "B7. 2.1.1.1.", "B 7.1.1.1.3"); the standard form drops spaces and trailing dots.
export function standardCode(code: string): string {
  let c = (code ?? "").trim().replace(/\s+/g, "").replace(/\.+$/, "");
  // SHS codes read a.b.c.LI.n; the printed copies have "L1" for "LI" and sometimes lose the dot before it.
  if (/L[I1l]\.?\d+$/i.test(c)) return c.replace(/(\d)(L[I1l])/i, "$1.$2").replace(/\.L[1l]\./i, ".LI.").replace(/\.li\./, ".LI.").replace(/\.{2,}/g, ".");
  c = c.replace(/^B\.?(\d)/i, "B$1").replace(/^([789])\./, "B$1.").replace(/^B(\d)(?=\d\.)/, "B$1.");
  return c.replace(/^B(\d)\.?(?=\d)/, "B$1.").replace(/\.{2,}/g, ".");
}

export type CurriculumIndex = { all: VerifiedIndicator[]; subjects: string[] };
export const buildIndex = (rows: VerifiedIndicator[]): CurriculumIndex => ({ all: rows, subjects: [...new Set(rows.map((r) => r.subject))].sort() });

export type Resolution =
  | { status: "RESOLVED"; indicator: VerifiedIndicator }
  | { status: "UNKNOWN_SUBJECT" | "UNKNOWN_GRADE" | "UNKNOWN_INDICATOR" | "AMBIGUOUS_INDICATOR"; candidates: VerifiedIndicator[] };

// Places one question's (subject, grade, indicator code, strand, sub-strand) on a verified indicator, or says exactly why it cannot.
export function resolveIndicator(index: CurriculumIndex, q: { subject: string; grade: string; indicator_code: string; strand?: string; sub_strand?: string }): Resolution {
  const bySubject = index.all.filter((r) => subjectMatches(q.subject, r.subject));
  if (!bySubject.length) return { status: "UNKNOWN_SUBJECT", candidates: [] };
  const g = gradeKey(q.grade), byGrade = bySubject.filter((r) => gradeKey(r.grade) === g);
  if (!byGrade.length) return { status: "UNKNOWN_GRADE", candidates: [] };
  const code = standardCode(q.indicator_code);
  let byCode = byGrade.filter((r) => standardCode(r.indicator_code) === code);
  // A question may cite the code exactly as the document prints it where the stored code was corrected (the printed typo is kept in printed_code).
  if (!byCode.length) byCode = byGrade.filter((r) => r.printed_code && standardCode(r.printed_code) === code);
  if (!byCode.length) return { status: "UNKNOWN_INDICATOR", candidates: [] };
  const distinct = new Map(byCode.map((r) => [`${keyOf(r.strand)}|${keyOf(r.sub_strand)}|${keyOf(r.indicator)}`, r]));
  if (distinct.size === 1) return { status: "RESOLVED", indicator: [...distinct.values()][0] };
  // The same code can recur in different strands (SHS): the question's own strand and sub-strand decide.
  const narrow = (rows: VerifiedIndicator[]) => rows.filter((r) => (!q.sub_strand || keyOf(r.sub_strand).includes(keyOf(q.sub_strand)) || keyOf(q.sub_strand).includes(keyOf(r.sub_strand)))
    && (!q.strand || keyOf(r.strand).includes(keyOf(q.strand)) || keyOf(q.strand).includes(keyOf(r.strand))));
  const narrowed = [...new Map(narrow([...distinct.values()]).map((r) => [`${keyOf(r.strand)}|${keyOf(r.sub_strand)}|${keyOf(r.indicator)}`, r])).values()];
  return narrowed.length === 1 ? { status: "RESOLVED", indicator: narrowed[0] } : { status: "AMBIGUOUS_INDICATOR", candidates: narrowed.length ? narrowed : [...distinct.values()] };
}
