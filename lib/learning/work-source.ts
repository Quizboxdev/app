// Where a piece of work came from. A child has one workspace; each item says who gave it. Work from before the family workspace (or from a database that has not had it applied) has no source and is school work.
export type WorkSource = "school" | "family";
export type SourceFilter = "all" | WorkSource;

export const sourceOf = (row: { source_type?: unknown; assignments?: { source_type?: unknown } | null } | null | undefined): WorkSource =>
  (row?.source_type ?? row?.assignments?.source_type) === "family" ? "family" : "school";

export const SOURCE_LABEL: Record<WorkSource, string> = { school: "School", family: "Family" };

export function countBySource<T extends { source_type?: unknown; assignments?: { source_type?: unknown } | null }>(rows: T[]): Record<SourceFilter, number> {
  const out: Record<SourceFilter, number> = { all: rows.length, school: 0, family: 0 };
  for (const r of rows) out[sourceOf(r)] += 1;
  return out;
}
export const filterBySource = <T extends { source_type?: unknown; assignments?: { source_type?: unknown } | null }>(rows: T[], filter: SourceFilter): T[] => (filter === "all" ? rows : rows.filter((r) => sourceOf(r) === filter));
