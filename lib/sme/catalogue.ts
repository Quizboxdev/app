// The curriculum pool for admin forms: every level, grade and subject that exists in an active curriculum of a market.
// Forms offer these as cascading dropdowns (level, then grades, then subjects) instead of free text. Pure code; the data comes from
// public.qb_curriculum_catalogue() (20261012180000).
export type CatalogueItem = { market_id: string; level: string; grade: string; subject: string };
export type Catalogue = { markets: Array<{ id: string; name: string }>; items: CatalogueItem[] };

const GRADE_ORDER = /^(B|SHS)\s?0*(\d+)$/i;
// B4 < B5 < ... < B10, then SHS1 < SHS2 < SHS3; anything else after, alphabetically.
export function gradeSort(a: string, b: string): number {
  const rank = (g: string) => { const m = GRADE_ORDER.exec(g.trim()); return m ? (m[1].toUpperCase() === "SHS" ? 1000 : 0) + Number(m[2]) : 5000; };
  return rank(a) - rank(b) || a.localeCompare(b);
}
const LEVEL_ORDER = ["primary", "jhs", "shs"];
export const levelSort = (a: string, b: string) => {
  const ia = LEVEL_ORDER.indexOf(a.toLowerCase()), ib = LEVEL_ORDER.indexOf(b.toLowerCase());
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

export type Selection = { market?: string; level?: string; grades?: string[] };
// What each dropdown offers given the choices made above it. A market of "" means every market.
export function cascadeOptions(catalogue: Catalogue, selection: Selection) {
  const inMarket = catalogue.items.filter((i) => !selection.market || i.market_id === selection.market);
  const levels = [...new Set(inMarket.map((i) => i.level))].sort(levelSort);
  const inLevel = inMarket.filter((i) => !selection.level || i.level === selection.level);
  const grades = [...new Set(inLevel.map((i) => i.grade))].sort(gradeSort);
  const chosen = (selection.grades ?? []).filter((g) => grades.includes(g));
  const inGrades = chosen.length ? inLevel.filter((i) => chosen.includes(i.grade)) : inLevel;
  const subjects = [...new Set(inGrades.map((i) => i.subject))].sort((a, b) => a.localeCompare(b));
  return { levels, grades, subjects };
}
