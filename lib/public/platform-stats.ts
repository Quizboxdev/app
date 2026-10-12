// Live platform figures for the public front page. Source: public.qb_public_platform_stats() (20261012190000), a reviewed anon
// contract that returns counts only. Server-side, cached for five minutes. Any failure or malformed answer returns null and the page
// falls back to its qualitative strip: no figure is ever invented or hard-coded.
export type PublicPlatformStats = {
  learners: { total: number; primary: number; jhs: number; shs: number };
  questions: { total: number; primary: number; jhs: number; shs: number };
  indicators: { total: number; primary: number; jhs: number; shs: number };
  people: { teachers: number; reviewers: number; schools: number; sponsors: number; markets: number };
  asOf: string | null;
};

const count = (value: unknown): number | null => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : null;
};
const group = (raw: unknown) => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const v = { total: count(r.total), primary: count(r.primary), jhs: count(r.jhs), shs: count(r.shs) };
  return v.total === null || v.primary === null || v.jhs === null || v.shs === null ? null : { total: v.total, primary: v.primary, jhs: v.jhs, shs: v.shs };
};

export function toPublicPlatformStats(raw: unknown): PublicPlatformStats | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const learners = group(r.learners), questions = group(r.questions), indicators = group(r.indicators);
  const p = (r.people ?? {}) as Record<string, unknown>;
  const people = { teachers: count(p.teachers), reviewers: count(p.reviewers), schools: count(p.schools), sponsors: count(p.sponsors), markets: count(p.markets) };
  if (!learners || !questions || !indicators || Object.values(people).some((v) => v === null)) return null;
  return { learners, questions, indicators, people: people as PublicPlatformStats["people"], asOf: typeof r.as_of === "string" ? r.as_of : null };
}

export async function getPublicPlatformStats(): Promise<PublicPlatformStats | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/qb_public_platform_stats`, {
      method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" }, body: "{}", next: { revalidate: 300 },
    });
    return response.ok ? toPublicPlatformStats(await response.json()) : null;
  } catch { return null; }
}
