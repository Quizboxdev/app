// The organiser's form logic, free of React so it can be tested.
import type { Division, RoundConfig, Section, Settings } from "./types";

// Competition times are typed and shown in Ghana time, which is GMT: the device's own time zone never changes them.
export const toInput = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");
export const fromInput = (value: string) => (value ? new Date(`${value}:00Z`).toISOString() : null);
export const wholeOrNull = (value: string) => (value.trim() === "" ? null : Math.max(0, Math.floor(Number(value) || 0)));

const KEYS: Array<keyof Settings> = ["title", "description", "sponsor_name", "sponsor_logo_url", "flyer_url", "scale", "region", "district", "participation", "entry_mode", "registration_mode", "funding", "max_schools", "max_per_school",
  "max_per_level_per_school", "expected_participants", "capacity", "waitlist", "registration_opens_at", "registration_closes_at", "opens_at", "ends_at", "rules", "prizes", "school_scoring", "scoring_top_n", "min_candidates", "score_carry"];
export const PUBLISHED_EDITABLE: Array<keyof Settings> = ["title", "description", "sponsor_name", "sponsor_logo_url", "flyer_url", "prizes", "capacity", "max_schools", "waitlist", "registration_closes_at", "ends_at"];
// Only what changed is sent, so a published competition is never refused for a field that was not touched.
export function changes(before: Settings, after: Settings): Partial<Settings> {
  const out: Record<string, unknown> = {};
  for (const k of KEYS) {
    const a = before[k], b = after[k];
    const same = k.endsWith("_at") ? (a ? new Date(a as string).getTime() : 0) === (b ? new Date(b as string).getTime() : 0) : (a ?? "") === (b ?? "");
    if (!same) out[k] = b === "" && !["description", "rules", "prizes", "title"].includes(k) ? null : b;
  }
  return out as Partial<Settings>;
}

export function blankRound(n: number, previousClose: string | null, start: string | null): RoundConfig {
  const base = new Date(previousClose ?? start ?? Date.now() + 7 * 86_400_000);
  const opens = new Date(previousClose ? base.getTime() + 86_400_000 : base.getTime());
  return { title: `Round ${n}`, format: "FIELD", stage: "ROUND", opens_at: opens.toISOString(), closes_at: new Date(opens.getTime() + 2 * 86_400_000).toISOString(), duration_seconds: 1800, sections: [], rule: "ALL", pass_percent: null, top_n: null };
}
export const questionTotal = (sections: Section[]) => sections.reduce((n, s) => n + (Number(s.count) || 0), 0);
// An equal split of a total across the chosen subjects; the first subjects take any remainder.
export function splitEqually(total: number, subjects: string[]): Section[] {
  if (!subjects.length) return [];
  const each = Math.floor(total / subjects.length), extra = total % subjects.length;
  return subjects.map((subject_id, i) => ({ subject_id, count: each + (i < extra ? 1 : 0) })).filter((s) => s.count > 0);
}
// Only the fields the database reads are sent.
export const cleanRound = (r: RoundConfig): RoundConfig => ({
  title: r.title, format: r.format, stage: r.stage, opens_at: r.opens_at, closes_at: r.closes_at, duration_seconds: r.duration_seconds, rule: r.rule,
  pass_percent: ["PASS", "PASS_AND_TOP_LEARNERS", "TOP_LEARNERS", "TOP_SCHOOLS", "FIXTURE_WINNERS"].includes(r.rule) ? r.pass_percent ?? null : null,
  top_n: ["TOP_LEARNERS", "TOP_SCHOOLS", "PASS_AND_TOP_LEARNERS"].includes(r.rule) ? r.top_n ?? null : null,
  sections: r.sections.map((s) => ({ subject_id: s.subject_id, count: Number(s.count), ...(s.node_ids?.length ? { node_ids: s.node_ids } : {}), ...(s.difficulty ? { difficulty: s.difficulty } : {}) })),
});
// Copies one division's rounds to another level: the same subjects by name. Topic choices belong to a level and are not copied. Returns the subjects that have no match.
export function copyRounds(source: Division, subjects: Array<{ id: string; title: string; level: string }>, target: Division): { rounds: RoundConfig[]; missing: string[] } {
  const title = new Map(subjects.map((s) => [s.id, s.title]));
  const missing = new Set<string>();
  const rounds = source.rounds.map((r) => cleanRound({ ...r, sections: r.sections.flatMap((s) => {
    const name = title.get(s.subject_id);
    const match = subjects.find((x) => x.title === name && target.level_codes.includes(x.level));
    if (!match) { missing.add(name ?? "a subject"); return []; }
    return [{ subject_id: match.id, count: s.count, difficulty: s.difficulty }];
  }) }));
  return { rounds, missing: [...missing] };
}
export const LEVELS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "SHS1", "SHS2", "SHS3"] as const;
