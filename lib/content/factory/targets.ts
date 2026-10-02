import { COVERAGE_TARGETS, type CurriculumNode } from "./contract";
export interface TargetOverride { curriculum_id: string; grade_code: string; subject_code: string; minimum: number; easy: number; medium: number; hard: number; type_mix: Record<string, number>; }
export function resolveTarget(node: CurriculumNode, overrides: TargetOverride[]) {
  const matches = overrides.filter((row) => row.curriculum_id === node.curriculum_id && (!row.grade_code || row.grade_code === (node.canonical_grade_code ?? node.grade_code)) && (!row.subject_code || row.subject_code === node.subject_code));
  matches.sort((a,b) => Number(!!b.grade_code)+Number(!!b.subject_code)-Number(!!a.grade_code)-Number(!!a.subject_code) || Number(!!b.subject_code)-Number(!!a.subject_code));
  return matches[0] ?? { ...COVERAGE_TARGETS, type_mix: { SINGLE_CHOICE: 8, TRUE_FALSE: 2 } };
}
