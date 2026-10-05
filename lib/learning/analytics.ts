import { classifyProficiency } from "./proficiency";

export interface ClassAnalytics { average: number; completionRate: number; bands: Array<{ label: string; count: number; percentage: number }>; }
export interface IndicatorAnalytics { code: string; title: string; learnerCount: number; attemptCount: number; averageMastery: number; averageAccuracy: number; proficiencyState: string; }

export function summarizeClassScores(scores: number[], assignedLearners: number): ClassAnalytics {
  const clean = scores.filter(Number.isFinite);
  const labels = ["Highly Proficient", "Proficient", "Approaching Proficiency", "Developing", "Emerging"];
  const counts = new Map(labels.map((label) => [label, 0]));
  clean.forEach((score) => { const label = classifyProficiency(score); counts.set(label, (counts.get(label) ?? 0) + 1); });
  return { average: clean.length ? Math.round(clean.reduce((sum, score) => sum + score, 0) / clean.length * 100) / 100 : 0, completionRate: assignedLearners ? Math.round(clean.length / assignedLearners * 10000) / 100 : 0, bands: labels.map((label) => ({ label, count: counts.get(label) ?? 0, percentage: clean.length ? Math.round((counts.get(label) ?? 0) / clean.length * 10000) / 100 : 0 })) };
}

export function summarizeClassLearners(grades: Array<{ student_user_id: string; percentage: number | null; graded_at: string | null }>, activeStudentIds: string[]): ClassAnalytics {
  const roster = new Set(activeStudentIds);
  const latest = new Map<string, number>();
  const ordered = [...grades].sort((a, b) => Date.parse(b.graded_at ?? "1970-01-01") - Date.parse(a.graded_at ?? "1970-01-01"));
  for (const grade of ordered) {
    if (roster.has(grade.student_user_id) && !latest.has(grade.student_user_id) && grade.percentage != null && Number.isFinite(Number(grade.percentage))) latest.set(grade.student_user_id, Number(grade.percentage));
  }
  return summarizeClassScores([...latest.values()], roster.size);
}

export function summarizeIndicators(rows: Array<{ code?: string; title?: string; student_user_id?: string; is_correct?: boolean; mastery_score?: number; proficiency_state?: string }>): IndicatorAnalytics[] {
  const groups = new Map<string, typeof rows>();
  rows.forEach((row) => { const key = row.code ?? "unknown"; groups.set(key, [...(groups.get(key) ?? []), row]); });
  return [...groups.entries()].map(([code, group]) => { const mastery = group.filter((row) => row.mastery_score != null).map((row) => Number(row.mastery_score)); const accuracy: number[] = group.filter((row) => row.is_correct != null).map((row) => row.is_correct ? 100 : 0); const averageMastery = mastery.length ? mastery.reduce((sum, value) => sum + value, 0) / mastery.length : 0; return { code, title: group.find((row) => row.title)?.title ?? code, learnerCount: new Set(group.map((row) => row.student_user_id).filter(Boolean)).size, attemptCount: group.length, averageMastery: Math.round(averageMastery * 100) / 100, averageAccuracy: accuracy.length ? Math.round(accuracy.reduce((sum, value) => sum + value, 0) / accuracy.length * 100) / 100 : 0, proficiencyState: group.find((row) => row.proficiency_state)?.proficiency_state ?? classifyProficiency(averageMastery) }; }).sort((a, b) => a.averageMastery - b.averageMastery);
}

export type IndicatorSummaryRow = { code: string; title: string; class_id: string; curriculum_node_id: string; learner_count: number; attempt_count: number; average_mastery: number | string; average_accuracy: number | string; proficiency_state: string | null };
// Maps qb_teacher_indicator_summary rows (database aggregation of summarizeIndicators) to the same shape and order.
export function indicatorsFromSummary(rows: IndicatorSummaryRow[]): IndicatorAnalytics[] {
  return rows.map((row) => { const averageMastery = Number(row.average_mastery); return { code: row.code, title: row.title ?? row.code, learnerCount: Number(row.learner_count), attemptCount: Number(row.attempt_count), averageMastery, averageAccuracy: Number(row.average_accuracy), proficiencyState: row.proficiency_state ?? classifyProficiency(averageMastery) }; }).sort((a, b) => a.averageMastery - b.averageMastery);
}

// ---- Teacher home: assignment lifecycle and the "what needs my attention" queue (pure, from rows the dashboard already loads) ----
export type AssignmentPhase = "Draft" | "Scheduled" | "Active" | "Closed";
type AssignmentRow = { id?: string; class_id?: string | null; title?: string | null; status?: string | null; start_at?: string | null; opens_at?: string | null; due_at?: string | null };

export function assignmentPhase(row: AssignmentRow, now = Date.now()): AssignmentPhase {
  const status = String(row.status ?? "").toLowerCase();
  if (status === "draft") return "Draft";
  if (status === "closed" || status === "archived") return "Closed";
  const start = Date.parse(row.start_at ?? row.opens_at ?? "");
  if (Number.isFinite(start) && start > now) return "Scheduled";
  const due = Date.parse(row.due_at ?? "");
  return Number.isFinite(due) && due < now ? "Closed" : "Active";
}

export type AttentionItem = { key: string; tone: "danger" | "warning" | "info"; title: string; detail?: string; href?: string; indicator?: { code: string; classId?: string; curriculumNodeId?: string } };
const DAY = 864e5;

export function buildAttentionQueue(input: {
  assignments: AssignmentRow[];
  classes: Array<{ id: string; class_name?: string; completionRate: number; average: number }>;
  needsAttention: Array<{ code: string; title?: string; learnerCount: number; averageMastery: number; classId?: string; curriculumNodeId?: string }>;
  now?: number;
}): AttentionItem[] {
  const now = input.now ?? Date.now();
  const active = input.assignments.filter((row) => assignmentPhase(row, now) === "Active");
  const items: AttentionItem[] = [];
  const dueSoon = active.filter((row) => row.due_at && Date.parse(row.due_at) - now <= 3 * DAY).sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!));
  if (dueSoon.length) items.push({ key: "due", tone: "warning", title: `${dueSoon.length} assignment${dueSoon.length === 1 ? "" : "s"} due within 3 days`, detail: dueSoon[0].title ?? undefined, href: "/teacher/assignments" });
  const activeClassIds = new Set(active.map((row) => row.class_id).filter(Boolean));
  for (const cls of input.classes.filter((c) => activeClassIds.has(c.id) && c.completionRate < 50).slice(0, 2)) {
    items.push({ key: `completion-${cls.id}`, tone: "warning", title: `Low completion in ${cls.class_name ?? "a class"}`, detail: `${Math.round(cls.completionRate)}% of learners have a final grade`, href: "/teacher/gradebook" });
  }
  for (const row of input.needsAttention.slice(0, 3)) {
    items.push({ key: `weak-${row.classId ?? ""}-${row.code}`, tone: "danger", title: `${row.title ?? row.code} needs work`, detail: `${row.learnerCount} learner${row.learnerCount === 1 ? "" : "s"} affected · ${Math.round(row.averageMastery)}% mastery`, indicator: { code: row.code, classId: row.classId, curriculumNodeId: row.curriculumNodeId } });
  }
  return items.sort((a, b) => ["danger", "warning", "info"].indexOf(a.tone) - ["danger", "warning", "info"].indexOf(b.tone)).slice(0, 6);
}
