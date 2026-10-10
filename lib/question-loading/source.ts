import type { Issue } from "./check";
import type { LoadRow } from "./template";

// Checks a question file's evidence against the text of the source document it claims to come from.
// Pure code: the caller extracts the text (one entry per physical page) and passes it in.
export type SourcePage = { n: number; text: string };
export type SourceSummary = { rows: number; exact: number; near: number; missing: number; noQuote: number; pageOffset: number | null; pageMismatch: number; indicatorsChecked: number; indicatorsMissing: string[] };

export const normaliseText = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[‘’‛′`´]/g, "'").replace(/[“”„]/g, '"').replace(/-\s*\n\s*/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// PDF text often loses or adds spaces ("activitiesthat"), so exact matching ignores spaces entirely.
const compact = (s: string) => normaliseText(s).replace(/ /g, "");
const FUZZY = 0.85;

export function verifySource(input: LoadRow[], pages: SourcePage[], scope: "CURRICULUM" | "SPONSOR", fileRows: number[] = input.map((_, i) => i + 2)): { issues: Issue[]; summary: SourceSummary } {
  const issues: Issue[] = [], add = (i: number, code: string, severity: "error" | "warning", field?: string) => issues.push({ row: fileRows[i], code, severity, field });
  const normalised = pages.map((p) => normaliseText(p.text));
  const starts: number[] = []; let whole = "";
  normalised.forEach((t) => { starts.push(whole.length); whole += t.replace(/ /g, ""); });
  const pageAt = (offset: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; } return pages[lo].n; };
  const pageSets = normalised.map((t) => new Set(t.split(" ")));
  const found: Array<{ row: number; page: number; claimed: number | null }> = [];
  const s = { rows: input.length, exact: 0, near: 0, missing: 0, noQuote: 0 };

  input.forEach((r, i) => {
    const quote = r.source_quote.trim();
    if (!quote) { s.noQuote++; return; }
    const parts = quote.split(/\.{3}|…/).map((f) => ({ words: normaliseText(f), flat: compact(f) })).filter((f) => f.flat.length >= 8);
    if (!parts.length) { s.noQuote++; return; }
    const positions = parts.map((f) => whole.indexOf(f.flat));
    if (positions.every((p) => p >= 0)) {
      s.exact++;
      const claimed = /\d+/.exec(r.source_reference)?.[0];
      found.push({ row: i, page: pageAt(positions[0]), claimed: claimed ? Number(claimed) : null });
      return;
    }
    const words = [...new Set(parts.map((f) => f.words).join(" ").split(" ").filter((t) => t.length > 1))];
    const best = Math.max(0, ...pageSets.map((set) => words.filter((w) => set.has(w)).length / Math.max(1, words.length)));
    if (best >= FUZZY) { s.near++; add(i, "QL_QUOTE_NOT_VERBATIM", "warning", "source_quote"); } else { s.missing++; add(i, "QL_QUOTE_NOT_IN_SOURCE", "error", "source_quote"); }
  });

  // Printed page numbers usually sit a fixed distance from the physical page: judge each row against the common distance.
  const offsets = found.filter((f) => f.claimed != null).map((f) => f.page - (f.claimed as number));
  const tally = offsets.reduce<Record<number, number>>((acc, o) => { acc[o] = (acc[o] ?? 0) + 1; return acc; }, {});
  const common = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const pageOffset = common && Number(common[1]) >= 5 ? Number(common[0]) : null;
  let pageMismatch = 0;
  if (pageOffset != null) for (const f of found) if (f.claimed != null && f.page - f.claimed !== pageOffset) { pageMismatch++; add(f.row, "QL_PAGE_MISMATCH", "warning", "source_reference"); }

  const missing: string[] = []; let checked = 0;
  if (scope === "CURRICULUM") {
    const raw = pages.map((p) => p.text).join("\n").toLowerCase();
    for (const code of new Set(input.map((r) => r.indicator_code.trim()).filter(Boolean))) {
      checked++;
      if (!raw.includes(code.toLowerCase())) { missing.push(code); input.forEach((r, i) => { if (r.indicator_code.trim() === code) add(i, "QL_INDICATOR_NOT_IN_SOURCE", "warning", "indicator_code"); }); }
    }
  }
  return { issues, summary: { ...s, pageOffset, pageMismatch, indicatorsChecked: checked, indicatorsMissing: missing } };
}
