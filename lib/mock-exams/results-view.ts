// How the teacher's results screen lists and filters participants and words their state. Pure; the database has already decided who may be listed.
export type ParticipantLike = { participant: string; group: string; state: string; percent: number | null; attempt_no: number };
export type ParticipantFilter = { query: string; state: string; group: string };
export const EMPTY_FILTER: ParticipantFilter = { query: "", state: "", group: "" };

export const STATE_LABEL: Record<string, string> = { not_started: "Not started", in_progress: "In progress", submitted: "Submitted", expired: "Time ran out" };
export const stateLabel = (s: string): string => STATE_LABEL[s] ?? s;
export const percentLabel = (p: number | null | undefined): string => (p === null || p === undefined || Number.isNaN(p) ? "-" : `${Math.round(p * 10) / 10}%`);

export function filterParticipants<T extends ParticipantLike>(rows: T[], f: ParticipantFilter): T[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => (!q || r.participant.toLowerCase().includes(q)) && (!f.state || r.state === f.state) && (!f.group || r.group === f.group));
}
export const isFiltered = (f: ParticipantFilter): boolean => Boolean(f.query.trim() || f.state || f.group);
export const groupsOf = (rows: Array<{ group: string }>): string[] => [...new Set(rows.map((r) => r.group))].sort((a, b) => a.localeCompare(b));

// Questions that most learners got wrong come first, so the teacher sees what to reteach.
export function hardestFirst<T extends { correct_percent: number | null; position: number }>(qs: T[]): T[] {
  return [...qs].sort((a, b) => (a.correct_percent ?? 101) - (b.correct_percent ?? 101) || a.position - b.position);
}
export type Band = "hard" | "medium" | "easy" | "none";
export const bandOf = (p: number | null): Band => (p === null ? "none" : p < 40 ? "hard" : p < 70 ? "medium" : "easy");
export const bandLabel: Record<Band, string> = { hard: "Most got it wrong", medium: "Mixed", easy: "Most got it right", none: "No answers yet" };
