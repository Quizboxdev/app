import { describe, expect, it } from "vitest";
import { WAVE_ONE_OBJECTIVES, waveOneBatch } from "./wave-one";
import { validateCandidate, validateSpec, type CurriculumNode } from "./contract";
import { duplicateWarnings } from "./duplicates";

const nodes = WAVE_ONE_OBJECTIVES.map((r, i): CurriculumNode => ({ id: `unit-node-${i}`, curriculum_id: "unit-curriculum", parent_id: null,
 node_type: "learning_indicator", code: r.code, title: r.objective, canonical_grade_code: "SHS1", source_grade_code: "B10", grade_code: "SHS1", subject_code: r.subject, is_active: true }));
const map = new Map(nodes.map(n => [n.id, n]));
const batches = nodes.map(n => waveOneBatch(n, { file: "unit-curriculum.pdf", sha256: "a".repeat(64) }));
const candidates = batches.flatMap(b => b.candidates);
describe("original production Wave 1", () => {
 it("prepares five drafts for each of nine distinct objectives across three subjects", () => {
  expect(batches).toHaveLength(9); expect(candidates).toHaveLength(45); expect(new Set(nodes.map(n => n.id)).size).toBe(9);
  expect(new Set(nodes.map(n => n.subject_code)).size).toBe(3); expect(batches.every(b => b.candidates.length === 5)).toBe(true);
 });
 it.each(nodes)("validates the complete candidate structure for $code / $subject_code", n => {
  const b = batches.find(b => b.spec.indicatorId === n.id)!; expect(validateSpec(b.spec, n)).toEqual([]);
  for (const q of b.candidates) expect(validateCandidate(q, map).filter(i => i.severity === "error")).toEqual([]);
 });
 it("preserves B10 codes while grouping learners as SHS1", () => expect(batches.every(b => b.spec.grade === "SHS1" && b.spec.indicatorCode.startsWith("B10."))).toBe(true));
 it("retains original authorship provenance and never marks content approved", () => {
  expect(candidates.every(q => q.source_type === "AI_GENERATED" && q.tags?.includes("HUMAN_REVIEW_REQUIRED"))).toBe(true);
  expect(batches.every(b => b.approval === "HUMAN_REVIEW_REQUIRED")).toBe(true);
 });
 it("has no internal exact or near duplicate stems", () => expect(candidates.flatMap(q => duplicateWarnings(q, candidates))).toEqual([]));
 it("balances answer positions instead of making every answer A", () => {
  expect(Object.fromEntries("ABCD".split("").map(key => [key, candidates.filter(q => q.correct_answer === key).length]))).toEqual({ A: 12, B: 11, C: 11, D: 11 });
 });
 it("supplies two easy, two medium and one hard item per objective", () => {
  for (const b of batches) expect(b.candidates.map(q => q.difficulty_label)).toEqual(["easy", "easy", "medium", "medium", "hard"]);
 });
 it("rejects an unrelated curriculum objective", () => expect(() => waveOneBatch({ ...nodes[0], code: "UNRELATED" }, { file: "unit.pdf", sha256: "a".repeat(64) })).toThrow());
});
