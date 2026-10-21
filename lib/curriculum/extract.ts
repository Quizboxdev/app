// Deterministic extraction of the learning structure from an official NaCCA curriculum PDF (text per page).
// No AI: it reads strands, sub-strands, content standards, indicators and exemplars exactly as printed, records the page of
// every indicator, and checks itself by comparing the codes it parsed with every code that appears in the text.
export type CurriculumPage = { n: number; text: string };
export type CurriculumRow = {
  grade: string; strandNo: number; strand: string; subStrandNo: number; subStrand: string;
  contentStandardCode: string; contentStandard: string; indicatorCode: string; indicator: string;
  exemplars: string[]; pagePhysical: number; pagePrinted: string;
};
export type Extraction = { rows: CurriculumRow[]; anomalies: string[]; codesInText: string[] };

const STRAND = /^STRAND\s+(\d+)\s*[:.\-]?\s*(.*)$/i;
const SUB_STRAND = /^SUB-?\s?STRAND\s+(\d+)\s*[:.\-]?\s*(.*)$/i;
const CODE = /^(B\d+(?:\.\d+){3,4})\.?\s*(.*)$/;
const EXEMPLARS = /^Exemplars?\b\s*:?\s*(.*)$/i;
const PAGE_HEADER = /NaCCA,?\s+Ministry of Education/i;
const TABLE_HEADER = /^(content standard\b.*(indicators?|exemplars?).*)$/i;
// The third table column lists core competencies; it flows into the text after the exemplars.
const COMPETENCY = /(Creativity and Innovation|Critical Thinking and Problem[ -]?solving|Critical thinking and Problem[ -]?solving|Communication and Collaboration|Personal Development and Leadership|Digital Literacy|Cultural Identity and Global Citizenship)\s*(\(|[-–]\s*Ability|:)|\b[A-Z]{2}\s?\d+\.\d+\s*:/;

const clean = (line: string) => line.replace(/(?<=\p{L})�(?=\p{L})/gu, "’").replace(/[­​]/g, "").replace(/\s+/g, " ").trim();
const parts = (code: string) => code.split(".").length;
// The documents sometimes print a space inside a code ("B8. 3.1.1").
// Another typo: "B7 1.1.2.1." (a space where the first dot belongs).
const tidyCode = (line: string) => line.replace(/^(B\d+)\s+(?=\d+\.\d+\.\d+)/, "$1.").replace(/^(B\d+(?:\.\s?\d+){2,4})/, (m) => m.replace(/\s+/g, ""));

// Exemplars are numbered "1." or, in Mathematics, "E.g.,1." / "E.g.2.".
// Written "E.g.1:", "E.g.2", "E.g. 1", "E.g.,1." in Mathematics (punctuation varies; a stray backtick sometimes precedes it).
const EG_PREFIX = /^[`´]?\s*E\.?\s?g\.?/i;
const NUMBERED = { exec(line: string): [string, string, string] | null {
  const eg = /^[`´]?\s*E\.?\s?g\.?\s*,?\s*(\d+)\s*[.):]?\s*(.*)$/i.exec(line);
  if (eg) return [line, eg[1], eg[2]];
  const plain = /^(\d+)\s*[.)]\s*(.*)$/.exec(line);
  return plain ? [line, plain[1], plain[2]] : null;
}, test(line: string) { return NUMBERED.exec(line) !== null; } };
const COMPETENCY_NAME = /^(Creativity and Innovation|Critical [Tt]hinking(?: and Problem[ -]?[Ss]olving)?|Communication and Collaboration|Personal Development and Leadership|Digital Literacy|Cultural Identity(?: and Global Citizenship)?|Problem solving|Environmental awareness)\b/;
// A line that starts a core-competencies block: a competency name followed by "(CP)" or by "-Ability ..." / "CP 5.1:" lines.
const competencyAt = (lines: string[], i: number) => COMPETENCY_NAME.test(lines[i]) &&
  (/\(\s*[A-Z]{2}\s*\)/.test(lines[i]) || lines.slice(i + 1, i + 4).some((l) => /^[-–]\s*\S|^Ability\b|^[A-Z]{2}\s?\d+\.\d+|\(\s*[A-Z]{2}\s*\)/.test(l)));

// A code that starts mid-line (a table flattened into one line) starts a new line, unless it is a cross-reference ("from B7.4.4.2.1").
const PREPOSITION = /(?:^|\s)(?:from|see|in|and|to|with|of|at|on|the|between|after|before|also|compare|recap|revisit|indicators?|standards?|exemplars?|code|codes|unit|topic|lesson)[,;]?$/i;
function splitAtCodes(line: string): string[] {
  const out: string[] = []; let start = 0;
  for (const m of line.matchAll(/\s(B\d+(?:\.\d+){3,4})\b/g)) {
    const at = (m.index ?? 0) + 1;
    if (at > start && !PREPOSITION.test(line.slice(start, at).trimEnd())) { out.push(line.slice(start, at).trim()); start = at; }
  }
  out.push(line.slice(start).trim());
  return out.filter(Boolean);
}

export function extractCurriculum(pages: CurriculumPage[]): Extraction {
  const rows: CurriculumRow[] = [], anomalies: string[] = [], codesInText = new Set<string>();
  let strandNo = 0, strand = "", subNo = 0, sub = "";
  let cs = { code: "", text: "" };
  let current: (CurriculumRow & { mode: "indicator" | "exemplars" | "done" }) | null = null;
  let expected = 1, ctxGrade = "";

  const finish = () => { if (current) { const { mode: _mode, ...row } = current; void _mode; rows.push({ ...row, indicator: row.indicator.trim(), exemplars: row.exemplars.map((e) => e.trim()).filter(Boolean) }); current = null; } };
  const addExemplarLine = (line: string) => {
    if (!current) return;
    const numbered = NUMBERED.exec(line);
    // An "E.g." marker always starts a new exemplar, whatever its number; a plain number must be the next in sequence.
    if (numbered && (EG_PREFIX.test(line) || Number(numbered[1]) === expected)) { current.exemplars.push(numbered[2]); expected = Number(numbered[1]) + 1; return; }
    if (current.exemplars.length) current.exemplars[current.exemplars.length - 1] += ` ${line}`; else current.exemplars.push(line);
  };

  for (const page of pages) {
    const raw = page.text.split(/\r?\n/).map(clean).filter(Boolean);
    const printed = (page.text.split(/\r?\n/)[0] ?? "").match(/^\s*(\S+)\s+\S?\s*NaCCA/)?.[1] ?? "";
    // A code that starts mid-line (the table flattened into one line) starts a new line.
    const lines = raw.map(tidyCode).flatMap(splitAtCodes);
    for (const [li, original] of lines.entries()) {
      let line = original;
      if (PAGE_HEADER.test(line) || TABLE_HEADER.test(line) || /^\d{1,3}$/.test(line) || /\.{4,}/.test(line)) continue;
      const strandMatch = STRAND.exec(line), subMatch = SUB_STRAND.exec(line);
      if (strandMatch && !/^sub/i.test(line)) { finish(); if (Number(strandMatch[1]) === 1) ctxGrade = ""; strandNo = Number(strandMatch[1]); strand = strandMatch[2]; subNo = 0; sub = ""; cs = { code: "", text: "" }; continue; }
      if (subMatch) { finish(); subNo = Number(subMatch[1]); sub = subMatch[2]; cs = { code: "", text: "" }; continue; }
      let code = CODE.exec(line);
      // Completeness check: every code that starts a line of a table section must end up as an indicator.
      if (code && parts(code[1]) === 5 && strandNo > 0) codesInText.add(code[1]);
      // Only the table sections carry real indicators: ignore codes quoted in the introduction, and cross-references to another grade.
      if (code && (strandNo === 0 || (ctxGrade && code[1].split(".")[0] !== ctxGrade) || (current && code[1] === current.indicatorCode))) code = null;
      if (code) ctxGrade = code[1].split(".")[0];
      if (code && parts(code[1]) === 4) { finish(); cs = { code: code[1], text: code[2] }; continue; }
      if (code && parts(code[1]) === 5) {
        finish(); expected = 1;
        current = { grade: code[1].split(".")[0], strandNo, strand, subStrandNo: subNo, subStrand: sub, contentStandardCode: cs.code, contentStandard: cs.text.trim(), indicatorCode: code[1], indicator: code[2], exemplars: [], pagePhysical: page.n, pagePrinted: printed, mode: "indicator" };
        line = "";
        const ex = EXEMPLARS.exec(current.indicator);
        if (ex) { current.indicator = current.indicator.slice(0, current.indicator.search(EXEMPLARS)).trim(); current.mode = "exemplars"; line = ex[1]; } else continue;
      }
      if (!current) { if (cs.code && line && !EXEMPLARS.test(line)) cs.text += ` ${line}`; continue; }
      // The core-competencies column is interleaved with the exemplars: a numbered exemplar that follows it resumes the list.
      if (current.mode === "done") { const n = NUMBERED.exec(line); if (n && Number(n[1]) === expected) current.mode = "exemplars"; }
      if (current.mode === "indicator") {
        const ex = EXEMPLARS.exec(line);
        if (ex) { current.mode = "exemplars"; line = ex[1]; }
        else if (EG_PREFIX.test(line) && NUMBERED.test(line)) current.mode = "exemplars";
        else if (COMPETENCY.test(line) || competencyAt(lines, li)) { current.mode = "done"; continue; }
        else { current.indicator += ` ${line}`; continue; }
      }
      if (current.mode === "exemplars" && line) {
        // Competency bullets are written "-Ability to ..." with no space after the dash.
        if (/^[-–][A-Za-z]/.test(line)) { current.mode = "done"; continue; }
        const stop = COMPETENCY.exec(line);
        if (stop || competencyAt(lines, li)) { const before = stop ? line.slice(0, stop.index).trim() : ""; if (before) addExemplarLine(before); current.mode = "done"; continue; }
        addExemplarLine(line);
      }
    }
  }
  finish();

  // The same indicator printed twice with the same wording (a table continued onto the next page) is merged; the same code used
  // for two different indicators is a defect in the source document and is reported, not hidden.
  const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byCode = new Map<string, CurriculumRow>(), merged: CurriculumRow[] = [];
  for (const r of rows) {
    const prior = byCode.get(r.indicatorCode);
    if (prior && same(prior.indicator, r.indicator)) { for (const e of r.exemplars) if (!prior.exemplars.includes(e)) prior.exemplars.push(e); anomalies.push(`REPEATED_INDICATOR_MERGED ${r.indicatorCode}`); continue; }
    if (prior) anomalies.push(`SOURCE_DUPLICATE_CODE ${r.indicatorCode} (pages ${prior.pagePhysical} and ${r.pagePhysical}, different wording)`); else byCode.set(r.indicatorCode, r);
    merged.push(r);
  }
  rows.length = 0; rows.push(...merged);
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.indicatorCode);
    if (!r.exemplars.length) anomalies.push(`NO_EXEMPLARS ${r.indicatorCode}`);
    if (!r.contentStandardCode) anomalies.push(`NO_CONTENT_STANDARD ${r.indicatorCode}`);
    if (!r.strand) anomalies.push(`NO_STRAND ${r.indicatorCode}`);
    if (!r.indicator) anomalies.push(`NO_INDICATOR_TEXT ${r.indicatorCode}`);
  }
  for (const code of codesInText) if (!seen.has(code)) anomalies.push(`CODE_IN_TEXT_NOT_PARSED ${code}`);
  return { rows, anomalies, codesInText: [...codesInText].sort() };
}
