export const EDITORIAL_STATES = ["draft", "generated", "review", "approved", "rejected", "needs_revision"] as const;
export type EditorialState = typeof EDITORIAL_STATES[number];
export const COVERAGE_TARGETS = { minimum: 10, easy: 3, medium: 4, hard: 3, strong: 20 };
export const FIXTURE_SOURCES = ["DEV_ACCEPTANCE_FIXTURE", "DEV_FACTORY_PILOT"];
export const isFixtureSource = (source?: string | null) => FIXTURE_SOURCES.includes(source ?? "");
export const isApproved = (state?: string | null) => state === "approved";
export interface CurriculumNode {
  id: string; curriculum_id: string; parent_id: string | null; node_type: string; code: string; title: string;
  grade_code: string | null; source_grade_code?: string | null; canonical_grade_code?: string | null;
  subject_code: string | null; education_level?: string | null; is_active: boolean;
}
export interface GenerationSpec {
  indicatorId: string; indicatorCode: string; indicatorTitle: string; curriculumId: string;
  educationLevel: string; grade: string; subject: string; strand?: string; subStrand?: string; contentStandard?: string;
  difficulty: "easy" | "medium" | "hard"; cognitiveLevel: string; answerType: "SINGLE_CHOICE" | "TRUE_FALSE";
  count: number; language: string; marks: number; expectedSeconds: number; theme?: string;
  provenance: { source: string; provider?: string; model?: string; sourceVersion?: string };
}
export interface Candidate {
  external_question_id: string; curriculum_node_id: string; question_text: string;
  answer_type: "SINGLE_CHOICE" | "TRUE_FALSE"; option_a: string; option_b: string; option_c: string; option_d: string;
  correct_answer: string; answer_spec?: { boolean?: boolean }; explanation: string; hint?: string;
  difficulty_label: string; cognitive_level: string; marks: number; estimated_time_seconds: number;
  source_type: string; tags?: string[]; question_content?: { blocks: Array<Record<string, unknown>> };
}
export interface ValidationIssue { code: string; severity: "error" | "review"; }
export function validateSpec(spec: GenerationSpec, node?: CurriculumNode): string[] {
  const errors: string[] = [];
  if (!node || !node.is_active || !["learning_indicator", "learning_objective"].includes(node.node_type)) errors.push("INVALID_INDICATOR");
  if (node && (node.id !== spec.indicatorId || node.code !== spec.indicatorCode || node.curriculum_id !== spec.curriculumId || node.subject_code !== spec.subject || (node.canonical_grade_code ?? node.grade_code) !== spec.grade)) errors.push("SPEC_MAPPING_MISMATCH");
  if (node && node.title !== spec.indicatorTitle) errors.push("SPEC_MAPPING_MISMATCH");
  if (!Number.isInteger(spec.count) || spec.count < 1 || spec.count > 100) errors.push("INVALID_COUNT");
  if (!["easy", "medium", "hard"].includes(spec.difficulty)) errors.push("INVALID_DIFFICULTY");
  if (!["SINGLE_CHOICE", "TRUE_FALSE"].includes(spec.answerType)) errors.push("UNSUPPORTED_FACTORY_TYPE");
  if (!spec.cognitiveLevel?.trim() || !spec.language?.trim() || !spec.provenance?.source?.trim()) errors.push("INCOMPLETE_SPEC");
  if (!(spec.marks > 0 && spec.marks <= 100) || !Number.isInteger(spec.expectedSeconds) || spec.expectedSeconds < 5 || spec.expectedSeconds > 3600) errors.push("INVALID_SCORING_LIMITS");
  return errors;
}
export function canTransition(from: EditorialState, to: EditorialState, humanReviewed = false): boolean {
  const allowed: Record<EditorialState, EditorialState[]> = { draft: ["generated", "review", "rejected"], generated: ["review", "rejected", "needs_revision"], review: ["approved", "rejected", "needs_revision"], approved: ["needs_revision", "review"], rejected: ["needs_revision"], needs_revision: ["review", "rejected"] };
  return allowed[from]?.includes(to) === true && (to !== "approved" || humanReviewed);
}
export function isProductionAvailable(question: { status: string; validation_status: string | null; source_type?: string | null }, structurallyValid: boolean): boolean {
  return question.status === "active" && isApproved(question.validation_status) && structurallyValid && !isFixtureSource(question.source_type);
}
export function validateCandidate(q: Candidate, nodes: Map<string, CurriculumNode>): ValidationIssue[] {
  if (!q || typeof q !== "object" || ["external_question_id", "curriculum_node_id", "question_text", "answer_type", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation", "difficulty_label", "cognitive_level", "source_type"].some((key) => typeof (q as unknown as Record<string, unknown>)[key] !== "string") || (q.question_content != null && (!Array.isArray(q.question_content.blocks) || q.question_content.blocks.some((b) => !b || typeof b !== "object")))) return [{ code: "MALFORMED_CANDIDATE", severity: "error" }];
  const issues: ValidationIssue[] = [];
  const fail = (code: string) => issues.push({ code, severity: "error" });
  const node = nodes.get(q.curriculum_node_id);
  if (!node?.is_active || !["learning_indicator", "learning_objective"].includes(node.node_type)) fail("INVALID_INDICATOR");
  if (!q.external_question_id?.trim()) fail("MISSING_EXTERNAL_ID");
  if (!q.question_text?.trim()) fail("EMPTY_QUESTION");
  if (/<[^>]*>|javascript:|data:|\bon\w+\s*=/i.test(q.question_text ?? "")) fail("UNSAFE_CONTENT");
  if (/\b(correct answer|answer key|the answer is)\b/i.test(q.question_text ?? "")) fail("ANSWER_LEAKAGE");
  if (!["SINGLE_CHOICE", "TRUE_FALSE"].includes(q.answer_type)) fail("UNSUPPORTED_FACTORY_TYPE");
  const options = [q.option_a, q.option_b, q.option_c, q.option_d];
  if (q.answer_type === "SINGLE_CHOICE") {
    if (options.some((v) => !v?.trim())) fail("EMPTY_OPTION");
    if (new Set(options.map(normalize)).size !== 4) fail("DUPLICATE_OPTIONS");
    if (!["A", "B", "C", "D"].includes(q.correct_answer)) fail("INVALID_ANSWER");
  }
  if (q.answer_type === "TRUE_FALSE") {
    if (typeof q.answer_spec?.boolean !== "boolean" || q.correct_answer !== (q.answer_spec.boolean ? "A" : "B") || normalize(q.option_a) !== "true" || normalize(q.option_b) !== "false") fail("INVALID_BOOLEAN_ANSWER");
    if (/\bnot\b.*\b(not|never|no)\b|\bnever\b.*\bnot\b/i.test(q.question_text ?? "")) fail("DOUBLE_NEGATIVE");
  }
  if (!q.explanation?.trim()) fail("MISSING_EXPLANATION");
  if (!["easy", "medium", "hard"].includes(q.difficulty_label)) fail("INVALID_DIFFICULTY");
  if (!(Number.isFinite(q.marks) && q.marks > 0 && q.marks <= 100)) fail("INVALID_MARKS");
  if (!Number.isInteger(q.estimated_time_seconds) || q.estimated_time_seconds < 5 || q.estimated_time_seconds > 3600) fail("INVALID_DURATION");
  if (!q.source_type?.trim() || !q.cognitive_level?.trim()) fail("MISSING_PROVENANCE_OR_COGNITIVE_LEVEL");
  for (const block of q.question_content?.blocks ?? []) {
    const allowed = block.type === "text" ? ["type","text"] : block.type === "image" ? ["type","asset_id","alt"] : ["type","latex","display"];
    if (Object.keys(block).some((key) => !allowed.includes(key))) fail("UNSAFE_CONTENT");
    if (!["text", "math", "image"].includes(String(block.type))) fail("UNSUPPORTED_MEDIA");
    if (block.type === "image" && (!/^[0-9a-f-]{36}$/i.test(String(block.asset_id)) || typeof block.alt !== "string" || !block.alt.trim() || /<[^>]*>|correct answer|answer key|the answer is/i.test(block.alt))) fail("UNSUPPORTED_MEDIA");
    if (block.type === "text" && (typeof block.text !== "string" || /<[^>]*>/.test(block.text))) fail("UNSAFE_CONTENT");
    if (block.type === "text" && /\b(correct answer|answer key|the answer is)\b/i.test(String(block.text))) fail("ANSWER_LEAKAGE");
    if (block.type === "math" && (typeof block.latex !== "string" || /\\(?:href|html|includegraphics)/i.test(block.latex))) fail("UNSAFE_CONTENT");
  }
  if (q.question_content && Object.keys(q.question_content).some((key) => key !== "blocks")) fail("UNSAFE_CONTENT");
  issues.push({ code: "HUMAN_CHECK_DISTRACTORS_EXPLANATION_AND_ALIGNMENT", severity: "review" });
  return issues;
}
export function normalize(text: string): string { return (text ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
