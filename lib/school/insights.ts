import type { AttentionItem } from "@/lib/learning/analytics";
import type { SchoolClass, SchoolHistoryRow, SchoolOverview, SchoolPerformance, SchoolTeacher } from "@/lib/api/school";
import { MIN_PROFICIENT_EVIDENCE } from "@/lib/learning/mastery";

// Pure school-level aggregates derived ONLY from qb_school('overview') and qb_school('history').
// No scores, assignments or completion data exist at school level yet (see docs/design/SCHOOL_BACKEND_CONTRACTS.md).
export const HISTORY_LIMIT = 200; // qb_school('history') returns the latest 200 membership rows.
const DAY = 864e5;

export const isActiveClass = (cls: SchoolClass) => cls.status === "active";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function noGradeLabel(grade: string | null) { return grade?.trim() || "No grade"; }

export function gradeCompare(a: string, b: string) {
  const na = Number(a.match(/\d+/)?.[0]), nb = Number(b.match(/\d+/)?.[0]);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

export type TeacherLoad = { userId: string; name: string; role: string; classes: SchoolClass[]; learners: number };

// Matched by teacher_user_id when the overview provides it; the display-name join is only a fallback for an older server.
export function teacherLoad(overview: SchoolOverview): TeacherLoad[] {
  const active = overview.classes.filter(isActiveClass);
  return overview.teachers.map((t: SchoolTeacher) => {
    const classes = active.filter((c) => c.teacher_user_id !== undefined ? c.teacher_user_id === t.user_id : c.teacher != null && c.teacher === t.name);
    return { userId: t.user_id, name: t.name ?? "Unnamed", role: t.role, classes, learners: classes.reduce((sum, c) => sum + c.students, 0) };
  }).sort((a, b) => b.classes.length - a.classes.length || a.name.localeCompare(b.name));
}

export const isTeachingStaff = (row: TeacherLoad) => row.role === "teacher" || row.classes.length > 0;

export function summarizeSchool(overview: SchoolOverview, history: SchoolHistoryRow[], now = Date.now()) {
  const active = overview.classes.filter(isActiveClass);
  const enrolments = active.reduce((sum, c) => sum + c.students, 0);
  const historyComplete = history.length < HISTORY_LIMIT;
  const oldest = history.length ? Date.parse(history[history.length - 1].joined_at) : NaN;
  const windowStart = now - 30 * DAY;
  // The 30-day count is only trustworthy when the capped history reaches back past the window.
  const reliable = historyComplete || (Number.isFinite(oldest) && oldest < windowStart);
  const server = overview.summary;
  return {
    activeClasses: active.length,
    archivedClasses: overview.classes.length - active.length,
    enrolments,
    avgClassSize: active.length ? Math.round((enrolments / active.length) * 10) / 10 : null,
    teachingStaff: teacherLoad(overview).filter(isTeachingStaff).length,
    // Enrolments count a learner once per class; uniqueLearners (server-side) counts each learner once. null = not provided.
    uniqueLearners: server?.unique_learners ?? null,
    joinedLast30Days: server ? server.joined_last_30d : reliable ? history.filter((h) => Date.parse(h.joined_at) >= windowStart).length : null,
    historyComplete,
  };
}

export function schoolAttention(overview: SchoolOverview): AttentionItem[] {
  const active = overview.classes.filter(isActiveClass);
  const names = (rows: Array<{ name: string }>) => rows.slice(0, 3).map((r) => r.name).join(", ") + (rows.length > 3 ? ` +${rows.length - 3} more` : "");
  const items: AttentionItem[] = [];
  const noTeacher = active.filter((c) => !c.teacher);
  if (noTeacher.length) items.push({ key: "no-teacher", tone: "danger", title: `${plural(noTeacher.length, "active class", "active classes")} without a teacher`, detail: names(noTeacher), href: "/school/classes" });
  const empty = active.filter((c) => c.students === 0);
  if (empty.length) items.push({ key: "empty-class", tone: "warning", title: `${plural(empty.length, "active class", "active classes")} with no learners`, detail: names(empty), href: "/school/classes" });
  const idle = teacherLoad(overview).filter((t) => t.role === "teacher" && t.classes.length === 0);
  if (idle.length) items.push({ key: "idle-teacher", tone: "info", title: `${plural(idle.length, "teacher")} with no active class`, detail: names(idle), href: "/school/teachers" });
  return items;
}

export type GradeRow = { grade: string; classes: number; learners: number; avgClassSize: number };
export function gradeBreakdown(classes: SchoolClass[]): GradeRow[] {
  const map = new Map<string, { classes: number; learners: number }>();
  for (const c of classes.filter(isActiveClass)) {
    const key = noGradeLabel(c.grade), row = map.get(key) ?? { classes: 0, learners: 0 };
    row.classes += 1; row.learners += c.students; map.set(key, row);
  }
  return [...map.entries()].map(([grade, r]) => ({ grade, ...r, avgClassSize: Math.round((r.learners / r.classes) * 10) / 10 })).sort((a, b) => gradeCompare(a.grade, b.grade));
}

export type LearnerRow = { student: string; class: string; grade: string; joinedAt: string };
// Current learners = open memberships in the (capped) history feed; grade comes from the class when its name is unique.
export function currentLearners(history: SchoolHistoryRow[], classes: SchoolClass[]): LearnerRow[] {
  const byName = new Map<string, SchoolClass[]>();
  classes.forEach((c) => byName.set(c.name, [...(byName.get(c.name) ?? []), c]));
  const seen = new Set<string>();
  const rows: LearnerRow[] = [];
  for (const h of history) {
    if (h.status !== "active") continue;
    const key = `${h.student}|${h.class}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const match = byName.get(h.class);
    rows.push({ student: h.student, class: h.class, grade: match?.length === 1 ? noGradeLabel(match[0].grade) : "—", joinedAt: h.joined_at });
  }
  return rows.sort((a, b) => a.student.localeCompare(b.student));
}

// ---- Academic signals from qb_school('performance'). Thin samples (< MIN_PROFICIENT_EVIDENCE assessed learners) never raise alerts. ----
const LOW_AVERAGE = 40, LOW_COMPLETION = 50, WEAK_INDICATOR = 68;

export function performanceAttention(perf: SchoolPerformance | null): AttentionItem[] {
  if (!perf) return [];
  const items: AttentionItem[] = [];
  const solid = perf.by_class.filter((c) => c.assessed_count >= MIN_PROFICIENT_EVIDENCE && c.average_score != null);
  const low = solid.filter((c) => c.average_score! < LOW_AVERAGE).sort((a, b) => a.average_score! - b.average_score!);
  if (low.length) items.push({ key: "low-average", tone: "danger", title: `${plural(low.length, "class", "classes")} averaging below ${LOW_AVERAGE}%`, detail: low.slice(0, 3).map((c) => `${c.class_name} ${Math.round(c.average_score!)}%`).join(", "), href: "/school/performance" });
  const lowCompletion = perf.by_class.filter((c) => c.learner_count >= MIN_PROFICIENT_EVIDENCE && c.assessed_count > 0 && c.completion_rate != null && c.completion_rate < LOW_COMPLETION);
  if (lowCompletion.length) items.push({ key: "low-completion", tone: "warning", title: `Low assessment coverage in ${plural(lowCompletion.length, "class", "classes")}`, detail: lowCompletion.slice(0, 3).map((c) => `${c.class_name} ${Math.round(c.completion_rate!)}% assessed`).join(", "), href: "/school/performance" });
  const none = perf.by_class.filter((c) => c.learner_count > 0 && c.assessed_count === 0);
  if (none.length) items.push({ key: "no-results", tone: "info", title: `${plural(none.length, "class", "classes")} with no results yet`, detail: none.slice(0, 3).map((c) => c.class_name).join(", "), href: "/school/performance" });
  const weak = perf.weak_indicators.filter((w) => !w.low_evidence && w.average_score < WEAK_INDICATOR);
  if (weak.length) items.push({ key: "weak-indicators", tone: "warning", title: `${plural(weak.length, "indicator")} below ${WEAK_INDICATOR}% accuracy`, detail: weak.slice(0, 2).map((w) => `${w.label} (${Math.round(w.average_score)}%)`).join(", "), href: "/school/performance" });
  return items;
}

// Lowest average among groups with enough assessed learners to be a fair comparison; null when none qualify.
export function weakest<T extends { assessed_count: number; average_score: number | null }>(rows: T[]): T | null {
  const fair = rows.filter((r) => r.assessed_count >= MIN_PROFICIENT_EVIDENCE && r.average_score != null);
  return fair.length > 1 ? fair.reduce((a, b) => (b.average_score! < a.average_score! ? b : a)) : null;
}

export type ScoreRow = { key: string; name: string; average: number | null; assessed: number; learners: number; completion: number | null; teacher?: string | null };
const byWeakest = (a: ScoreRow, b: ScoreRow) => (a.average == null ? 1 : 0) - (b.average == null ? 1 : 0) || (a.average ?? 0) - (b.average ?? 0) || a.name.localeCompare(b.name);

// Active classes with their results, weakest first; classes without results are kept (explicit zero-data rows), never dropped or shown as 0%.
export function classScoreRows(overview: SchoolOverview, perf: SchoolPerformance): ScoreRow[] {
  const byId = new Map(perf.by_class.map((c) => [c.class_id, c]));
  return overview.classes.filter(isActiveClass).map((c) => {
    const p = byId.get(c.id);
    return { key: c.id, name: c.name, average: p?.average_score ?? null, assessed: p?.assessed_count ?? 0, learners: p?.learner_count ?? c.students, completion: p?.completion_rate ?? null, teacher: c.teacher ?? null };
  }).sort(byWeakest);
}

export function gradeScoreRows(perf: SchoolPerformance): ScoreRow[] {
  return perf.by_grade.map((g) => ({ key: g.grade, name: noGradeLabel(g.grade), average: g.average_score, assessed: g.assessed_count, learners: g.learner_count, completion: g.completion_rate })).sort((a, b) => gradeCompare(a.name, b.name));
}
