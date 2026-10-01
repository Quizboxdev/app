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
