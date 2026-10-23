import * as XLSX from "xlsx";

// Turns an export result (column names and rows) into a CSV or an Excel file. Pure functions, no database.
// CSV: UTF-8 with a byte-order mark so Excel opens accents correctly, CRLF line ends, and a guard against "formula injection" (a text cell that starts with = + - @ would run as a formula in Excel).
// Excel: real dates and numbers (so filters, sorting and pivot tables work), a header filter, sensible column widths, and an About sheet that records the filters and when the file was made.
export type ExportData = { columns: string[]; rows: unknown[][]; total: number; truncated: boolean; dataset: string; label: string };
export type ExportFilters = { from?: string | null; to?: string | null; category?: string | null; generatedAt?: Date };

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const NUMBERISH = /^[-+]?\d+(\.\d+)?$/;

export const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  let s = typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s) && !NUMBERISH.test(s)) s = `'${s}`;                    // a text cell must never be read as a formula
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(d: Pick<ExportData, "columns" | "rows">): string {
  const lines = [d.columns.map(csvCell).join(","), ...d.rows.map((r) => r.map(csvCell).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// An Excel date/time serial, from a UTC "YYYY-MM-DD HH:MM:SS" text, without any time-zone shift.
export const excelSerial = (s: string): number | null => {
  const m = DATE_TIME.exec(s);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 86400000 + 25569;
};

export function toXlsx(d: ExportData, f: ExportFilters = {}): Buffer {
  const ws: XLSX.WorkSheet = {};
  const width = d.columns.map((c) => c.length);
  d.columns.forEach((c, x) => { ws[XLSX.utils.encode_cell({ r: 0, c: x })] = { t: "s", v: c }; });
  d.rows.forEach((row, y) => row.forEach((v, x) => {
    const addr = XLSX.utils.encode_cell({ r: y + 1, c: x });
    if (v === null || v === undefined || v === "") return;
    if (typeof v === "number") { ws[addr] = { t: "n", v }; width[x] = Math.max(width[x], String(v).length); return; }
    if (typeof v === "boolean") { ws[addr] = { t: "b", v }; return; }
    const s = typeof v === "string" ? v : JSON.stringify(v), serial = excelSerial(s);
    if (serial !== null) { ws[addr] = { t: "n", v: serial, z: "yyyy-mm-dd hh:mm:ss" }; width[x] = Math.max(width[x], 19); return; }
    ws[addr] = { t: "s", v: s }; width[x] = Math.max(width[x], Math.min(s.length, 60));
  }));
  const lastRow = Math.max(d.rows.length, 0), lastCol = Math.max(d.columns.length - 1, 0);
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } });
  ws["!cols"] = width.map((w) => ({ wch: Math.min(w + 2, 62) }));
  ws["!autofilter"] = { ref: ws["!ref"] };
  const when = (f.generatedAt ?? new Date()).toISOString().replace("T", " ").slice(0, 19);
  const about = [
    ["QuizBox data export"], ["Dataset", d.label], ["From (UTC, included)", f.from || "the beginning"], ["To (UTC, included)", f.to || "today"], ["Category", f.category || "all"],
    ["Generated (UTC)", when], ["Rows in this file", d.rows.length], ["Rows matching", d.total],
    ...(d.truncated ? [["Warning", "There are more matching rows than this file holds. Narrow the dates or the category and export again."]] : []),
    ["Notes", "All times are UTC. Money is in the currency shown, in whole units (for example 40 means GHS 40). Contains personal data: keep it safe and delete it when you no longer need it."],
  ];
  const wsAbout = XLSX.utils.aoa_to_sheet(about);
  wsAbout["!cols"] = [{ wch: 24 }, { wch: 90 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  XLSX.utils.book_append_sheet(wb, wsAbout, "About");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// "quizbox-payments-2026-10-01_to_2026-10-23.xlsx"
export const exportFileName = (dataset: string, from: string | null | undefined, to: string | null | undefined, ext: "csv" | "xlsx", today = new Date()) =>
  `quizbox-${dataset.replace(/[^a-z0-9_]/gi, "")}-${from || "start"}_to_${to || today.toISOString().slice(0, 10)}.${ext}`;
