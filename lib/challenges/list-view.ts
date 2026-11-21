import type { MyCampaign } from "./types";

// Search, filter and sort for the challenge and competition lists, done on the rows already loaded (a person's own list is short; an administrator's is the same list).
export type ListSort = "recent" | "title" | "played" | "questions" | "status";
export type ListView = { query: string; status: string; sort: ListSort; dir: "asc" | "desc" };
export const DEFAULT_VIEW: ListView = { query: "", status: "", sort: "recent", dir: "desc" };

type Row = Pick<MyCampaign, "title" | "status" | "participants" | "question_count" | "created_at">;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").trim();

export function viewRows<T extends Row>(rows: readonly T[], v: ListView): T[] {
  const q = norm(v.query);
  const out = rows.filter((r) => (!q || norm(r.title ?? "").includes(q)) && (!v.status || String(r.status) === v.status));
  const key = (r: T): number | string => v.sort === "title" ? norm(r.title ?? "") : v.sort === "played" ? Number(r.participants ?? 0) : v.sort === "questions" ? Number(r.question_count ?? 0) : v.sort === "status" ? String(r.status) : Date.parse(r.created_at ?? "") || 0;
  const sign = v.dir === "asc" ? 1 : -1;
  return [...out].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * sign; });
}

export const statusesIn = (rows: readonly Pick<MyCampaign, "status">[]): string[] => [...new Set(rows.map((r) => String(r.status)))].sort();
export const isFiltered = (v: ListView): boolean => !!(v.query.trim() || v.status);
