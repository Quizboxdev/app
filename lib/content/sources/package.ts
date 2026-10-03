import JSZip from "jszip";
import { parseCsv } from "../factory/import";

// Client-safe curriculum source-pack parser. It only structures the package; country isolation, curriculum/authority
// resolution, official-host checks and duplicates are enforced server-side by qb_curriculum_sources.
export type PackageType = "COUNTRY_PACK" | "MULTI_COUNTRY_PACK" | "GLOBAL_SOURCE_PACK";
export type SourceRow = { level: string; subject: string; title: string; url: string; source_type: string; status: string; version?: string; effective_date?: string };
export type CountryGroup = { country: string; rows: SourceRow[]; manifests: string[] };
export type ParsedPackage = { name: string; package_type: PackageType; file_name: string; sha256: string; research_date: string | null; notes: string[]; attachments: Array<{ name: string; bytes: number; sha256: string }>; groups: CountryGroup[] };

const ROW_KEYS = ["level", "subject", "title", "url", "source_type", "status", "version", "effective_date"] as const;
const MAX_ROWS = 5000;

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", view.slice().buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (value: unknown) => (value == null ? "" : String(value).trim());
function normalizeRow(raw: Record<string, unknown>): SourceRow {
  const row = Object.fromEntries(ROW_KEYS.map((k) => [k, clean(raw[k])])) as SourceRow;
  if (!row.version) delete row.version; if (!row.effective_date) delete row.effective_date;
  return row;
}

type Manifest = { path: string; country: string | null; research_date: string | null; notes: string[]; declaredType: PackageType | null; rows: Array<{ country: string | null; row: SourceRow }> };

// A manifest is either {country, sources:[...]} (rows may override country), {countries:[{country, sources}]}, or a CSV
// with an explicit country column. A country is never inferred from a folder or file name.
function readJsonManifest(path: string, json: any): Manifest | null {
  if (!json || typeof json !== "object") return null;
  const declaredType = ["COUNTRY_PACK", "MULTI_COUNTRY_PACK", "GLOBAL_SOURCE_PACK"].includes(json.package_type) ? json.package_type as PackageType : null;
  const base = { path, research_date: clean(json.research_date) || null, notes: Array.isArray(json.notes) ? json.notes.map(clean).filter(Boolean) : [], declaredType };
  if (Array.isArray(json.countries)) {
    return { ...base, country: null, rows: json.countries.flatMap((c: any) => (Array.isArray(c?.sources) ? c.sources : []).map((r: any) => ({ country: clean(r?.country) || clean(c?.country) || null, row: normalizeRow(r ?? {}) }))) };
  }
  if (!Array.isArray(json.sources)) return null;
  const country = clean(json.country) || null;
  return { ...base, country, rows: json.sources.map((r: any) => ({ country: clean(r?.country) || country, row: normalizeRow(r ?? {}) })) };
}
function readCsvManifest(path: string, text: string): Manifest | null {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return null;
  const keys = header.map((h) => h.trim().toLowerCase());
  if (!["level", "subject", "title", "url"].every((k) => keys.includes(k))) return null;
  return { path, country: null, research_date: null, notes: [], declaredType: null,
    rows: body.map((cells) => { const raw = Object.fromEntries(keys.map((k, i) => [k, cells[i]])); return { country: clean(raw.country) || null, row: normalizeRow(raw) }; }) };
}

export async function parsePackage(fileName: string, bytes: ArrayBuffer | Uint8Array, name?: string): Promise<ParsedPackage> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sha256 = await sha256Hex(data);
  const manifests: Manifest[] = []; const attachments: ParsedPackage["attachments"] = [];
  if (/\.zip$/i.test(fileName)) {
    const zip = await JSZip.loadAsync(data);
    const files = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.)/.test(f.name));
    const jsonFolders = new Set<string>();
    for (const f of files.filter((f) => /\.json$/i.test(f.name))) {
      let json: unknown; try { json = JSON.parse(await f.async("string")); } catch { throw new Error(`PACKAGE_JSON_INVALID: ${f.name}`); }
      const m = readJsonManifest(f.name, json); if (m) { manifests.push(m); jsonFolders.add(f.name.replace(/[^/]*$/, "")); }
    }
    // A CSV is only used where its folder has no JSON manifest (packs ship the same list in both formats).
    for (const f of files.filter((f) => /\.csv$/i.test(f.name) && !jsonFolders.has(f.name.replace(/[^/]*$/, "")))) { const m = readCsvManifest(f.name, await f.async("string")); if (m) manifests.push(m); }
    for (const f of files.filter((f) => !/\.(json|csv|md|txt|py)$/i.test(f.name))) { const b = await f.async("uint8array"); attachments.push({ name: f.name, bytes: b.length, sha256: await sha256Hex(b) }); }
  } else if (/\.json$/i.test(fileName)) {
    let json: unknown; try { json = JSON.parse(new TextDecoder().decode(data)); } catch { throw new Error("PACKAGE_JSON_INVALID"); }
    const m = readJsonManifest(fileName, json); if (m) manifests.push(m);
  } else if (/\.csv$/i.test(fileName)) {
    const m = readCsvManifest(fileName, new TextDecoder().decode(data)); if (m) manifests.push(m);
  } else throw new Error("PACKAGE_FORMAT_UNSUPPORTED");
  if (!manifests.length) throw new Error("PACKAGE_MANIFEST_NOT_FOUND");
  const groups = new Map<string, CountryGroup>(); const seen = new Set<string>();
  for (const m of manifests) for (const { country, row } of m.rows) {
    if (!country) throw new Error(`MANIFEST_COUNTRY_MISSING: ${m.path}`);
    const key = country.toLowerCase(); const g = groups.get(key) ?? { country, rows: [], manifests: [] };
    const id = `${key}|${row.url}|${row.level}|${row.subject}`; if (seen.has(id)) continue; seen.add(id);
    g.rows.push(row); if (!g.manifests.includes(m.path)) g.manifests.push(m.path); groups.set(key, g);
  }
  const total = [...groups.values()].reduce((s, g) => s + g.rows.length, 0);
  if (!total) throw new Error("PACKAGE_EMPTY"); if (total > MAX_ROWS) throw new Error("PACKAGE_TOO_LARGE");
  const declared = manifests.find((m) => m.declaredType)?.declaredType ?? null;
  return { name: name?.trim() || fileName.replace(/\.(zip|json|csv)$/i, "").replace(/[_-]+/g, " "), file_name: fileName, sha256,
    package_type: declared ?? (groups.size > 1 ? "MULTI_COUNTRY_PACK" : "COUNTRY_PACK"),
    research_date: manifests.map((m) => m.research_date).find(Boolean) ?? null, notes: [...new Set(manifests.flatMap((m) => m.notes))].slice(0, 50),
    attachments, groups: [...groups.values()] };
}
