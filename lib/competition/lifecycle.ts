import { createHash } from "node:crypto";
import { validateContentContext, type ContentContext, type SourceCorpus } from "../content/market-context";
import { canonicalGradeCode } from "../content/normalize";

// Server-only domain contract. Repository adapters must transact mutations and
// resolve identities, memberships and source approval from authenticated storage.
export type SponsorRole = "sponsor_owner" | "sponsor_admin" | "sponsor_editor" | "sponsor_viewer";
export type Actor = { userId: string; sponsorId: string; role: SponsorRole; marketIds: string[] };
export type Sponsor = { id: string; organizationName: string; status: "pending" | "active" | "suspended" | "archived" };
export type Rules = {
  totalQuestions: number; questionsPerAttempt: number; durationSeconds: number; attemptLimit: number;
  difficulty: { easy: number; medium: number; hard: number };
  randomizeQuestions: boolean; randomizeAnswers: boolean;
  scoring: "points"; negativeMarking: number; passMark: number | null;
  tieBreak: "score_only" | "completion_time";
  answerVisibility: "never" | "after_submission" | "after_close";
  explanationVisibility: "never" | "after_submission" | "after_close";
  leaderboard: "hidden" | "during" | "after_close"; topN: number | null;
};
export type Audience = {
  kind: "student" | "teacher" | "public" | "employee" | "custom";
  access: "public" | "private" | "invite_only"; grades: string[]; institutionIds: string[];
  minAge: number | null; maxAge: number | null;
};
export type Draft = {
  id: string; sponsorId: string; title: string; description: string;
  startsAt: string; endsAt: string; registrationOpensAt: string; registrationClosesAt: string;
  context: ContentContext; audience: Audience; rules: Rules;
};
export type Chunk = {
  id: string; documentId: string; order: number; text: string;
  page: number | null; chapter: string | null; section: string | null; heading: string | null;
};
export type DocumentState = "UPLOADED" | "PROCESSING" | "EXTRACTED" | "READY_FOR_GENERATION" | "FAILED";
export type JobState = "QUEUED" | "PROCESSING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
export type Candidate = {
  id: string; competitionId: string; jobId: string; sourceDocumentId: string; sourceChunkId: string;
  stem: string; options: string[]; correctAnswer: number; explanation: string;
  difficulty: "easy" | "medium" | "hard"; cognitiveLevel: string; subject: string;
  curriculumId: string | null; educationLevel: string; model: string;
  status: "GENERATED" | "ASSIGNED_FOR_REVIEW" | "UNDER_REVIEW" | "REVISION_REQUIRED" | "APPROVED" | "REJECTED" | "PUBLISHED";
  approvedVersionId: string | null;
};
export type Reviewer = {
  id: string; active: boolean; capability: boolean; marketIds: string[];
  subjects: string[]; curriculumIds: string[]; educationLevels: string[];
};
export type ReviewDecision = {
  assignmentId: string; reviewerId: string; candidateId: string; previousState: Candidate["status"];
  newState: Candidate["status"]; decision: "APPROVE" | "REQUEST_REVISION" | "REJECT";
  notes: string; startedAt: string; completedAt: string; durationSeconds: number;
  policyVersionId: string | null; context: ContentContext;
};
function fail(code: string): never { throw new Error(code); }
export function authorizeSponsor(actor: Actor, sponsorId: string, write = false) {
  if (!actor.userId || actor.sponsorId !== sponsorId || !["sponsor_owner", "sponsor_admin", "sponsor_editor", "sponsor_viewer"].includes(actor.role)) fail("SPONSOR_ACCESS_DENIED");
  if (write && actor.role === "sponsor_viewer") fail("SPONSOR_WRITE_DENIED");
}
export function validateDraft(draft: Draft, actor: Actor, sources: SourceCorpus[]): string[] {
  authorizeSponsor(actor, draft.sponsorId, true);
  const errors = validateContentContext(draft.context, sources, actor.marketIds);
  if (!draft.id || !draft.title.trim() || !draft.description.trim()) errors.push("COMPETITION_BASICS_REQUIRED");
  const dates = [draft.registrationOpensAt, draft.registrationClosesAt, draft.startsAt, draft.endsAt].map(Date.parse);
  if (dates.some(d => !Number.isFinite(d)) || dates[0] > dates[1] || dates[1] > dates[2] || dates[2] >= dates[3]) errors.push("INVALID_COMPETITION_DATES");
  const r = draft.rules;
  if (![r.totalQuestions, r.questionsPerAttempt, r.durationSeconds, r.attemptLimit].every(n => Number.isSafeInteger(n) && n > 0) || r.questionsPerAttempt > r.totalQuestions) errors.push("INVALID_ASSESSMENT_LIMITS");
  if (!Object.values(r.difficulty).every(n => Number.isFinite(n) && n >= 0) || Math.abs(Object.values(r.difficulty).reduce((a, b) => a + b, 0) - 100) > 0.000001) errors.push("INVALID_DIFFICULTY_DISTRIBUTION");
  if (r.scoring !== "points" || !Number.isFinite(r.negativeMarking) || r.negativeMarking < 0 || (r.passMark !== null && (!Number.isFinite(r.passMark) || r.passMark < 0 || r.passMark > 100))) errors.push("INVALID_SCORING_CONFIGURATION");
  if (!["score_only", "completion_time"].includes(r.tieBreak) || !["hidden", "during", "after_close"].includes(r.leaderboard) || [r.answerVisibility, r.explanationVisibility].some(v => !["never", "after_submission", "after_close"].includes(v)) || (r.topN !== null && (!Number.isSafeInteger(r.topN) || r.topN < 1))) errors.push("INVALID_VISIBILITY_CONFIGURATION");
  const a = draft.audience;
  if (!["student", "teacher", "public", "employee", "custom"].includes(a.kind) || !["public", "private", "invite_only"].includes(a.access) || [a.minAge, a.maxAge].some(v => v !== null && (!Number.isSafeInteger(v) || v < 0)) || (a.minAge !== null && a.maxAge !== null && a.minAge > a.maxAge)) errors.push("INVALID_AUDIENCE");
  return [...new Set(errors)];
}
export function transitionDocument(from: DocumentState, to: DocumentState) {
  const transitions: Record<DocumentState, DocumentState[]> = { UPLOADED: ["PROCESSING"], PROCESSING: ["EXTRACTED", "FAILED"], EXTRACTED: ["READY_FOR_GENERATION", "FAILED"], READY_FOR_GENERATION: [], FAILED: ["PROCESSING"] };
  if (!transitions[from]?.includes(to)) fail("INVALID_INGESTION_TRANSITION");
  return to;
}
export function transitionJob(from: JobState, to: JobState) {
  const transitions: Record<JobState, JobState[]> = { QUEUED: ["PROCESSING", "CANCELLED"], PROCESSING: ["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"], COMPLETED: [], PARTIAL: [], FAILED: [], CANCELLED: [] };
  if (!transitions[from]?.includes(to)) fail("INVALID_GENERATION_TRANSITION");
  return to;
}
export function chunkExtract(documentId: string, sections: Array<Omit<Chunk, "id" | "documentId" | "order">>): Chunk[] {
  if (!documentId || !sections.length || sections.some(s => !s.text.trim())) fail("EMPTY_SOURCE_EXTRACTION");
  return sections.flatMap(section => {
    const paragraphs = section.text.split(/\n\s*\n/).filter(p => p.trim());
    return paragraphs.flatMap(text => Array.from({ length: Math.ceil(text.length / 4000) }, (_, i) => ({ ...section, text: text.slice(i * 4000, (i + 1) * 4000) })));
  }).map((section, order) => {
    const hash = createHash("sha256").update(JSON.stringify([documentId, order, section])).digest("hex");
    // Stable UUIDv8 fits the persisted chunk FK; checksum remains independent.
    const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-${((parseInt(hash[16], 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return { ...section, documentId, order, id };
  });
}
export type GenerationInput = { competitionId: string; sponsorId: string; jobId: string; provider: string; model: string; count: number; context: ContentContext; settings?: Record<string, unknown> };
export async function generateCandidates(input: GenerationInput, actor: Actor, sources: SourceCorpus[], chunks: Chunk[], provider: (input: GenerationInput, chunks: Chunk[]) => Promise<Candidate[]>) {
  authorizeSponsor(actor, input.sponsorId, true);
  const errors = validateContentContext(input.context, sources, actor.marketIds);
  if (errors.length) fail(errors.join(","));
  if (!input.jobId || !input.competitionId || !input.provider || !input.model || !Number.isSafeInteger(input.count) || input.count < 1 || input.count > 500 || !chunks.length || new Set(chunks.map(c => c.id)).size !== chunks.length || chunks.some(c => !c.text.trim() || !input.context.sourceIds.includes(c.documentId))) fail("INVALID_GENERATION_INPUT");
  const rows = await provider(structuredClone(input), structuredClone(chunks));
  if (!Array.isArray(rows) || rows.length > input.count || new Set(rows.map(r => r.id)).size !== rows.length) fail("INVALID_GENERATION_OUTPUT");
  for (const row of rows) {
    const chunk = chunks.find(c => c.id === row.sourceChunkId && c.documentId === row.sourceDocumentId);
    if (!row.id || !chunk || row.competitionId !== input.competitionId || row.jobId !== input.jobId || row.model !== input.model || !row.stem.trim() || !row.explanation.trim() || row.options.length < 2 || new Set(row.options.map(o => o.trim().toLowerCase())).size !== row.options.length || row.options.some(o => !o.trim()) || !Number.isInteger(row.correctAnswer) || row.correctAnswer < 0 || row.correctAnswer >= row.options.length || !["easy", "medium", "hard"].includes(row.difficulty) || !row.subject || !row.cognitiveLevel || !row.educationLevel) fail("INVALID_CANDIDATE_OR_PROVENANCE");
  }
  return { state: rows.length === input.count ? "COMPLETED" as const : rows.length ? "PARTIAL" as const : "FAILED" as const, candidates: rows.map(row => ({ ...structuredClone(row), status: "GENERATED" as const, approvedVersionId: null })) };
}
export function authorizeReview(reviewer: Reviewer, candidate: Candidate, context: ContentContext) {
  if (!reviewer.active || !reviewer.capability || !reviewer.subjects.includes(candidate.subject) || !reviewer.educationLevels.includes(candidate.educationLevel) || (candidate.curriculumId && !reviewer.curriculumIds.includes(candidate.curriculumId)) || context.marketIds.some(id => !reviewer.marketIds.includes(id))) fail("SME_DOMAIN_ACCESS_DENIED");
}
export function decideReview(candidate: Candidate, reviewer: Reviewer, context: ContentContext, input: { assignmentId: string; decision: ReviewDecision["decision"]; notes: string; startedAt: string; completedAt: string; humanReviewed: boolean; policyVersionId: string | null }): ReviewDecision {
  authorizeReview(reviewer, candidate, context);
  if (!input.assignmentId || !input.humanReviewed || !["ASSIGNED_FOR_REVIEW", "UNDER_REVIEW"].includes(candidate.status)) fail("HUMAN_REVIEW_REQUIRED");
  if (!["APPROVE", "REQUEST_REVISION", "REJECT"].includes(input.decision) || (input.decision !== "APPROVE" && !input.notes.trim())) fail("REVIEW_DECISION_REQUIRED");
  const durationSeconds = (Date.parse(input.completedAt) - Date.parse(input.startedAt)) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) fail("INVALID_REVIEW_TIMESTAMPS");
  return { ...input, reviewerId: reviewer.id, candidateId: candidate.id, previousState: candidate.status, newState: input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "REVISION_REQUIRED", durationSeconds, context: structuredClone(context) };
}
export type EarningHook = { assignmentId: string; reviewerId: string; policyVersionId: string; idempotencyKey: string };
export function earningHook(decision: ReviewDecision): EarningHook | null {
  // Amount/currency and eligibility remain authoritative in the existing SME ledger RPC.
  return decision.policyVersionId ? { assignmentId: decision.assignmentId, reviewerId: decision.reviewerId, policyVersionId: decision.policyVersionId, idempotencyKey: `sme-review:${decision.assignmentId}` } : null;
}
export type BankItem = { candidate: Candidate; versionId: string; reviewComplete: boolean };
export function requiredDifficultyCounts(total: number, distribution: Rules["difficulty"]) {
  const kinds = ["easy", "medium", "hard"] as const;
  const counts = { easy: 0, medium: 0, hard: 0 };
  for (const kind of kinds) counts[kind] = Math.floor(total * distribution[kind] / 100);
  const remaining = total - Object.values(counts).reduce((sum, value) => sum + value, 0);
  const fractions = [...kinds].sort((a, b) => (total * distribution[b] / 100 - counts[b]) - (total * distribution[a] / 100 - counts[a]));
  for (let i = 0; i < remaining && i < fractions.length; i++) counts[fractions[i]]++;
  return counts;
}
export function publicationIssues(draft: Draft, sponsor: Sponsor, actor: Actor, sources: SourceCorpus[], bank: BankItem[]): string[] {
  const issues = validateDraft(draft, actor, sources);
  if (sponsor.id !== draft.sponsorId || sponsor.status !== "active") issues.push("SPONSOR_NOT_ACTIVE");
  if (bank.length !== draft.rules.totalQuestions) issues.push("APPROVED_QUESTION_COUNT_MISMATCH");
  if (new Set(bank.map(i => i.candidate.id)).size !== bank.length) issues.push("DUPLICATE_BANK_QUESTION");
  if (bank.some(i => i.candidate.competitionId !== draft.id || i.candidate.status !== "APPROVED" || !i.reviewComplete || !i.versionId || i.candidate.approvedVersionId !== i.versionId || !draft.context.sourceIds.includes(i.candidate.sourceDocumentId))) issues.push("UNAPPROVED_BANK_OR_PROVENANCE");
  if (!issues.includes("INVALID_DIFFICULTY_DISTRIBUTION") && !issues.includes("INVALID_ASSESSMENT_LIMITS")) {
    const required = requiredDifficultyCounts(draft.rules.totalQuestions, draft.rules.difficulty);
    if ((["easy", "medium", "hard"] as const).some(kind => bank.filter(item => item.candidate.difficulty === kind).length !== required[kind])) issues.push("BANK_DIFFICULTY_MIX_MISMATCH");
  }
  return [...new Set(issues)];
}
export function freezeCompetition(draft: Draft, sponsor: Sponsor, actor: Actor, sources: SourceCorpus[], bank: BankItem[], version: number, publishedAt: string) {
  const errors = publicationIssues(draft, sponsor, actor, sources, bank);
  if (!Number.isSafeInteger(version) || version < 1 || !Number.isFinite(Date.parse(publishedAt)) || Date.parse(publishedAt) >= Date.parse(draft.endsAt)) errors.push("INVALID_SNAPSHOT_VERSION_OR_TIME");
  if (errors.length) fail(errors.join(","));
  const payload = structuredClone({ draft, version, publishedAt, questions: bank.map(i => ({ questionId: i.candidate.id, versionId: i.versionId })) });
  const json = JSON.stringify(payload);
  return Object.freeze({ json, checksum: createHash("sha256").update(json).digest("hex") });
}
export type Participant = { id: string; marketIds: string[]; kind: Audience["kind"]; grade: string | null; institutionId: string | null; age: number | null; invited: boolean; authorizedPrivate: boolean };
export function participantEligible(draft: Draft, participant: Participant): boolean {
  const a = draft.audience;
  return Boolean(participant.id) && (draft.context.scope === "global" || participant.marketIds.some(id => draft.context.marketIds.includes(id))) && (a.kind === "public" || a.kind === participant.kind) && (a.access === "public" || (a.access === "invite_only" ? participant.invited : participant.authorizedPrivate)) && (!a.grades.length || (participant.grade !== null && a.grades.some(grade => canonicalGradeCode(grade) === canonicalGradeCode(participant.grade!)))) && (!a.institutionIds.length || (participant.institutionId !== null && a.institutionIds.includes(participant.institutionId))) && (a.minAge === null || (participant.age !== null && participant.age >= a.minAge)) && (a.maxAge === null || (participant.age !== null && participant.age <= a.maxAge));
}
export type OfficialResult = { participantId: string; attemptId: string; score: number; durationSeconds: number; submittedAt: string };
export function rankResults(draft: Draft, results: OfficialResult[], now: string) {
  if (draft.rules.leaderboard === "hidden" || (draft.rules.leaderboard === "after_close" && Date.parse(now) < Date.parse(draft.endsAt))) return [];
  if (!Number.isFinite(Date.parse(now)) || results.some(r => !Number.isFinite(r.score) || !Number.isFinite(r.durationSeconds) || r.durationSeconds < 0)) fail("INVALID_OFFICIAL_RESULT");
  const best = new Map<string, OfficialResult>();
  const compare = (a: OfficialResult, b: OfficialResult) => b.score - a.score || (draft.rules.tieBreak === "completion_time" ? a.durationSeconds - b.durationSeconds : 0);
  for (const row of results) if (!best.has(row.participantId) || compare(row, best.get(row.participantId)!) < 0) best.set(row.participantId, row);
  let previous: OfficialResult | undefined; let rank = 0;
  return [...best.values()].sort(compare).map((row, index) => { if (!previous || compare(row, previous) !== 0) rank = index + 1; previous = row; return { participantId: row.participantId, score: row.score, rank }; }).slice(0, draft.rules.topN ?? best.size);
}
export function sponsorAnalytics(actor: Actor, sponsorId: string, registrations: number, started: number, results: OfficialResult[]) {
  authorizeSponsor(actor, sponsorId);
  if (![registrations, started].every(n => Number.isSafeInteger(n) && n >= 0) || new Set(results.map(r => r.attemptId)).size !== results.length || results.some(r => !Number.isFinite(r.score))) fail("INVALID_ANALYTICS_INPUT");
  return { registrations, attemptsStarted: started, attemptsCompleted: results.length, completionRate: started ? results.length / started * 100 : 0, averageScore: results.length ? results.reduce((sum, r) => sum + r.score, 0) / results.length : null };
}
