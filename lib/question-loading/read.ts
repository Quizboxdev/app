import JSZip from "jszip";
import { parseCsv } from "../content/factory/import";
import { LOAD_COLUMNS, MAX_FILE_BYTES, MAX_FILE_ROWS, REQUIRED_COLUMNS, type LoadColumn, type LoadRow } from "./template";

// Reads the question-loading template from .csv or .xlsx. Pure code: no database, no network.
export type ParsedFile = { rows: LoadRow[]; fileRows: number[]; unknownColumns: string[]; sheet?: string };

const xml = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  const k = e.toLowerCase();
  if (k === "amp") return "&"; if (k === "lt") return "<"; if (k === "gt") return ">"; if (k === "quot") return '"'; if (k === "apos") return "'";
  return String.fromCodePoint(k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
});
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
const textOf = (fragment: string) => xml([...fragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));
const columnIndex = (ref: string) => [...ref.replace(/[0-9]/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function toRows(table: string[][]): ParsedFile {
  const [header, ...body] = table;
  if (!header) throw new Error("QL_FILE_EMPTY");
  const keys = header.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !keys.includes(c));
  if (missing.length) throw new Error(`QL_HEADER_INVALID: missing ${missing.join(", ")}`);
  const unknownColumns = keys.filter((k) => k && !(LOAD_COLUMNS as readonly string[]).includes(k));
  const rows: LoadRow[] = [], fileRows: number[] = [];
  body.forEach((cells, i) => {
    if (!cells.some((c) => c?.trim())) return;
    rows.push(Object.fromEntries(LOAD_COLUMNS.map((c) => [c, (cells[keys.indexOf(c)] ?? "").replace(/\s+/g, " ").trim()])) as LoadRow);
    fileRows.push(i + 2);
  });
  if (rows.length > MAX_FILE_ROWS) throw new Error("QL_TOO_MANY_ROWS");
  if (!rows.length) throw new Error("QL_FILE_EMPTY");
  return { rows, fileRows, unknownColumns };
}

export function readCsv(bytes: Uint8Array): ParsedFile {
  return toRows(parseCsv(new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "")));
}

export async function readXlsx(bytes: Uint8Array): Promise<ParsedFile> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error("QL_FILE_UNREADABLE"); }
  const read = async (path: string) => zip.file(path)?.async("string");
  const workbook = await read("xl/workbook.xml"), rels = await read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("QL_FILE_UNREADABLE");
  const sheets = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => ({ name: xml(attr(m[0], "name") ?? ""), rid: attr(m[0], "r:id") }));
  const chosen = sheets.find((s) => s.name.toUpperCase() === "QUESTIONS") ?? (sheets.length === 1 ? sheets[0] : undefined);
  if (!chosen) throw new Error("QL_SHEET_QUESTIONS_MISSING");
  const target = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, "Id") === chosen.rid);
  const path = target && attr(target, "Target");
  const sheetXml = path && await read(path.startsWith("/") ? path.slice(1) : `xl/${path.replace(/^\.?\//, "")}`);
  if (!sheetXml) throw new Error("QL_FILE_UNREADABLE");
  const sharedXml = await read("xl/sharedStrings.xml");
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const table: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const line: string[] = [];
    for (const cell of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cell[1], "r"), type = attr(cell[1], "t"), inner = cell[2] ?? "";
      if (!ref) continue;
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      line[columnIndex(ref)] = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? textOf(inner) : type === "b" ? (v === "1" ? "TRUE" : "FALSE") : xml(v ?? "");
    }
    const rowNumber = Number(attr(rowMatch[1], "r") ?? table.length + 1);
    table[rowNumber - 1] = Array.from(line, (c) => c ?? "");
  }
  const dense = Array.from(table, (r) => r ?? []);
  return { ...toRows(dense), sheet: chosen.name };
}

export async function readQuestionFile(name: string, bytes: Uint8Array): Promise<ParsedFile> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error("QL_FILE_TOO_LARGE");
  if (/\.xlsx$/i.test(name)) return readXlsx(bytes);
  if (/\.csv$/i.test(name)) return readCsv(bytes);
  throw new Error("QL_FILE_TYPE_UNSUPPORTED");
}

export type { LoadColumn };
