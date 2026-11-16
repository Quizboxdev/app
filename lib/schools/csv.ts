// Reads a school list in the QuizBox school format (see Content/Schools/FIRECRAWL_SCHOOL_DATA_SPEC.md) and turns it into rows for qb_school_admin_import.
// Runs in the browser. The database checks every row again (regions, levels, duplicates); this only reads the file, drops what can never load, and counts it.

export type SchoolRow = {
  name: string; ownership?: string; region: string; district: string; town?: string; levels: string; gender?: string; boarding?: string; category?: string;
  programs?: string; school_code?: string; curriculum?: string; source_ref?: string; needs_review?: string;
};
export type ParsedSchools = { rows: SchoolRow[]; total: number; dropped: { noLevel: number; missing: number }; missingColumns: string[] };

// RFC 4180 style: commas, quoted fields, doubled quotes, CRLF or LF, an optional byte-order mark.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const out: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) out.push(row); row = []; }
    else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  return out;
}

const ALIASES: Record<string, keyof SchoolRow> = {
  school_name: "name", name: "name", ownership: "ownership", region: "region", district: "district", town: "town", levels: "levels", gender: "gender", boarding: "boarding", category: "category",
  programs: "programs", school_code: "school_code", emis_code: "school_code", curriculum: "curriculum", source_url: "source_ref", source_id: "source_ref", needs_review: "needs_review",
};
const LEVEL_WORDS = /\b(primary|jhs|shs)\b/i;

export function readSchoolCsv(text: string): ParsedSchools {
  const table = parseCsv(text);
  const head = (table[0] ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = new Map<keyof SchoolRow, number>();
  head.forEach((h, i) => { const k = ALIASES[h]; if (k && !col.has(k)) col.set(k, i); });
  const missingColumns = (["name", "region", "district", "levels"] as const).filter((k) => !col.has(k));
  const rows: SchoolRow[] = [];
  const dropped = { noLevel: 0, missing: 0 };
  if (missingColumns.length) return { rows, total: Math.max(table.length - 1, 0), dropped, missingColumns };
  for (const cells of table.slice(1)) {
    const get = (k: keyof SchoolRow) => (col.has(k) ? (cells[col.get(k)!] ?? "").trim() : "");
    const r: SchoolRow = { name: get("name"), region: get("region"), district: get("district"), levels: get("levels") };
    if (!r.name || !r.region || !r.district) { dropped.missing++; continue; }
    if (!LEVEL_WORDS.test(r.levels)) { dropped.noLevel++; continue; }   // kindergarten-only or no level: not a QuizBox level
    for (const k of ["ownership", "town", "gender", "boarding", "category", "programs", "school_code", "curriculum", "source_ref", "needs_review"] as const) { const v = get(k); if (v) r[k] = v; }
    rows.push(r);
  }
  return { rows, total: table.length - 1, dropped, missingColumns };
}

export const chunkRows = <T,>(rows: T[], size = 400): T[][] => { const out: T[][] = []; for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size)); return out; };
