import { COVERAGE_TARGETS, isFixtureSource, type CurriculumNode } from "./contract";

export interface QuestionMetadata { curriculum_node_id: string | null; status: string; validation_status: string | null; source_type: string | null; difficulty_label: string | null; answer_type: string; duplicate_group_id?: string | null; }
export function coverageHealth(approved: number, indicators = 1, target = COVERAGE_TARGETS.minimum) {
  if (!approved) return "Empty";
  if (approved < indicators * COVERAGE_TARGETS.easy) return "Critical";
  if (approved < indicators * target) return "Thin";
  return approved < indicators * COVERAGE_TARGETS.strong ? "Adequate" : "Strong";
}
export function calculateCoverage(nodes: CurriculumNode[], questions: QuestionMetadata[], target = COVERAGE_TARGETS.minimum) {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const rows = new Map(nodes.map((node) => [node.id, { ...node, total: 0, approved: 0, review: 0, rejected: 0, duplicates: 0, easy: 0, medium: 0, hard: 0, indicators: 0, types: {} as Record<string, number> }]));
  const ancestors = (id: string) => { const path: string[] = []; let current: string | null = id; while (current && map.has(current)) { if (path.includes(current)) throw new Error("CURRICULUM_CYCLE"); path.push(current); current = map.get(current)!.parent_id; } return path; };
  for (const node of nodes.filter((n) => n.is_active && ["learning_indicator", "learning_objective"].includes(n.node_type))) for (const id of ancestors(node.id)) rows.get(id)!.indicators++;
  const production = questions.filter((q) => !isFixtureSource(q.source_type));
  for (const q of production) {
    if (!q.curriculum_node_id || !map.has(q.curriculum_node_id)) continue;
    for (const id of ancestors(q.curriculum_node_id)) {
      const row = rows.get(id)!; row.total++;
      if (q.validation_status === "approved" && q.status === "active") { row.approved++; if (["easy", "medium", "hard"].includes(q.difficulty_label ?? "")) row[q.difficulty_label as "easy" | "medium" | "hard"]++; row.types[q.answer_type] = (row.types[q.answer_type] ?? 0) + 1; }
      if (["draft", "generated", "review", "needs_revision"].includes(q.validation_status ?? "review")) row.review++;
      if (q.validation_status === "rejected") row.rejected++;
      if (q.duplicate_group_id) row.duplicates++;
    }
  }
  const all = [...rows.values()].map((row) => ({ ...row, health: coverageHealth(row.approved, Math.max(1, row.indicators), target), belowDifficultyTarget: row.easy < row.indicators * COVERAGE_TARGETS.easy || row.medium < row.indicators * COVERAGE_TARGETS.medium || row.hard < row.indicators * COVERAGE_TARGETS.hard }));
  const indicators = all.filter((n) => n.is_active && ["learning_indicator", "learning_objective"].includes(n.node_type));
  return { summary: { totalNodes: nodes.length, totalIndicators: indicators.length, indicatorsWithQuestions: indicators.filter((n) => n.total > 0).length, zeroApproved: indicators.filter((n) => n.approved === 0).length, belowTarget: indicators.filter((n) => n.approved < target).length, meetingTarget: indicators.filter((n) => n.approved >= target).length, coveragePercent: indicators.length ? indicators.filter((n) => n.approved > 0).length / indicators.length * 100 : 0, productionApproved: production.filter((q) => q.status === "active" && q.validation_status === "approved").length, reviewQueue: production.filter((q) => ["draft", "generated", "review", "needs_revision"].includes(q.validation_status ?? "review")).length, rejected: production.filter((q) => q.validation_status === "rejected").length, fixtureQuestions: questions.length - production.length, unmappedProduction: production.filter((q) => !q.curriculum_node_id || !map.has(q.curriculum_node_id)).length }, targets: { ...COVERAGE_TARGETS, minimum: target }, nodes: all };
}
