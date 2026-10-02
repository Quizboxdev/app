import { describe, expect, it, vi } from "vitest";
import { authorizeSponsor, chunkExtract, decideReview, earningHook, freezeCompetition, generateCandidates, participantEligible, publicationIssues, rankResults, requiredDifficultyCounts, sponsorAnalytics, transitionDocument, transitionJob, validateDraft, type Actor, type Candidate, type Draft, type Reviewer } from "./lifecycle";
import type { SourceCorpus } from "../content/market-context";

const actor: Actor = { userId: "owner", sponsorId: "sponsor", role: "sponsor_owner", marketIds: ["gh", "other"] };
const sources: SourceCorpus[] = [
  { id: "doc", kind: "sponsor_document", market_id: "gh", curriculum_id: null, authority_id: null, validation_status: "approved", active: true },
  { id: "national", kind: "curriculum", market_id: "gh", curriculum_id: "ccp", authority_id: "authority", validation_status: "approved", active: true },
  { id: "pack", kind: "harmonized_concept_pack", market_id: null, curriculum_id: null, authority_id: null, validation_status: "approved", active: true },
];
function draft(): Draft {
  return { id: "competition", sponsorId: "sponsor", title: "Reading challenge", description: "Source-aligned challenge", startsAt: "2027-01-03T00:00:00Z", endsAt: "2027-01-04T00:00:00Z", registrationOpensAt: "2027-01-01T00:00:00Z", registrationClosesAt: "2027-01-02T00:00:00Z", context: { scope: "local_market", sourceMode: "sponsor_document", marketIds: ["gh"], sourceIds: ["doc"] }, audience: { kind: "student", access: "public", grades: ["SHS1"], institutionIds: [], minAge: null, maxAge: null }, rules: { totalQuestions: 1, questionsPerAttempt: 1, durationSeconds: 120, attemptLimit: 1, difficulty: { easy: 100, medium: 0, hard: 0 }, randomizeQuestions: false, randomizeAnswers: false, scoring: "points", negativeMarking: 0, passMark: null, tieBreak: "completion_time", answerVisibility: "after_close", explanationVisibility: "after_close", leaderboard: "during", topN: null } };
}
const chunk = chunkExtract("doc", [{ text: "Verified source excerpt.", page: 4, chapter: "Chapter 1", section: "Safety", heading: "Reading" }])[0];
function candidate(): Candidate { return { id: "candidate", competitionId: "competition", jobId: "job", sourceDocumentId: "doc", sourceChunkId: chunk.id, stem: "Which option matches the source?", options: ["Yes", "No"], correctAnswer: 0, explanation: "The source states the first option.", difficulty: "easy", cognitiveLevel: "understand", subject: "Computing", curriculumId: "ccp", educationLevel: "SHS", model: "mock", status: "GENERATED", approvedVersionId: null }; }
const reviewer: Reviewer = { id: "reviewer", active: true, capability: true, marketIds: ["gh"], subjects: ["Computing"], curriculumIds: ["ccp"], educationLevels: ["SHS"] };
const decisionInput = { assignmentId: "assignment", decision: "APPROVE" as const, notes: "Source checked", startedAt: "2027-01-01T00:00:00Z", completedAt: "2027-01-01T00:02:00Z", humanReviewed: true, policyVersionId: "policy-v1" };
const sponsor = { id: "sponsor", organizationName: "Example", status: "active" as const };

describe("sponsor lifecycle authorization and context", () => {
  it("accepts a local sponsor document draft", () => expect(validateDraft(draft(), actor, sources)).toEqual([]));
  it.each(["sponsor_owner", "sponsor_admin", "sponsor_editor"] as const)("allows %s to edit", role => expect(() => authorizeSponsor({ ...actor, role }, "sponsor", true)).not.toThrow());
  it("keeps viewers read-only", () => expect(() => authorizeSponsor({ ...actor, role: "sponsor_viewer" }, "sponsor", true)).toThrow("SPONSOR_WRITE_DENIED"));
  it("denies another sponsor", () => expect(() => authorizeSponsor(actor, "other")).toThrow("SPONSOR_ACCESS_DENIED"));
  it("rejects invalid dates", () => { const d = draft(); d.endsAt = d.startsAt; expect(validateDraft(d, actor, sources)).toContain("INVALID_COMPETITION_DATES"); });
  it("supports explicit multi-market", () => { const d = draft(); d.context.scope = "selected_multi_market"; d.context.marketIds = ["gh", "other"]; expect(validateDraft(d, actor, sources)).toEqual([]); });
  it("does not automatically add markets", () => { const d = draft(); d.context.marketIds = ["foreign"]; expect(validateDraft(d, actor, sources)).toContain("MARKET_ACCESS_DENIED"); });
  it("supports global explicit pack", () => { const d = draft(); d.context = { scope: "global", sourceMode: "curriculum_aligned", marketIds: [], sourceIds: ["pack"] }; expect(validateDraft(d, actor, sources)).toEqual([]); });
  it("rejects global national curriculum mixing", () => { const d = draft(); d.context = { scope: "global", sourceMode: "curriculum_aligned", marketIds: [], sourceIds: ["national"] }; expect(validateDraft(d, actor, sources)).toContain("GLOBAL_REQUIRES_DOCUMENTS_OR_HARMONIZED_PACKS"); });
  it.each([ ["curriculum_aligned", ["national"]], ["hybrid", ["national", "doc"]] ] as const)("supports %s source mode", (sourceMode, ids) => { const d = draft(); d.context.sourceMode = sourceMode; d.context.sourceIds = [...ids]; expect(validateDraft(d, actor, sources)).toEqual([]); });
  it("rejects invalid difficulty distribution", () => { const d = draft(); d.rules.difficulty.easy = 90; expect(validateDraft(d, actor, sources)).toContain("INVALID_DIFFICULTY_DISTRIBUTION"); });
});
describe("traceable extraction and generation", () => {
  it("preserves page/chapter/order with stable chunk identity", () => { expect(chunk.page).toBe(4); expect(chunk.chapter).toBe("Chapter 1"); expect(chunk.order).toBe(0); expect(chunkExtract("doc", [{ text: "Verified source excerpt.", page: 4, chapter: "Chapter 1", section: "Safety", heading: "Reading" }])[0].id).toBe(chunk.id); });
  it("bounds chunk size", () => expect(chunkExtract("doc", [{ ...chunk, text: "a".repeat(9000) }]).map(c => c.text.length)).toEqual([4000, 4000, 1000]));
  it("uses UUID-compatible provenance identity", () => expect(chunk.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/));
  it("does not accept failed empty extraction", () => expect(() => chunkExtract("doc", [])).toThrow("EMPTY_SOURCE_EXTRACTION"));
  it("requires ingestion order", () => { expect(transitionDocument("UPLOADED", "PROCESSING")).toBe("PROCESSING"); expect(() => transitionDocument("UPLOADED", "READY_FOR_GENERATION")).toThrow(); });
  it("permits explicit failed extraction retry", () => expect(transitionDocument("FAILED", "PROCESSING")).toBe("PROCESSING"));
  it("does not reopen completed jobs", () => expect(() => transitionJob("COMPLETED", "PROCESSING")).toThrow());
  it("supports processing and cancellation", () => { expect(transitionJob("QUEUED", "PROCESSING")).toBe("PROCESSING"); expect(transitionJob("PROCESSING", "CANCELLED")).toBe("CANCELLED"); });
  const input = () => ({ competitionId: "competition", sponsorId: "sponsor", jobId: "job", provider: "mock", model: "mock", count: 1, context: draft().context });
  it("checks authorization before invoking provider", async () => { const provider = vi.fn(); const i = input(); i.context.sourceIds = ["missing"]; await expect(generateCandidates(i, actor, sources, [chunk], provider)).rejects.toThrow("UNAPPROVED_SOURCE_CORPUS"); expect(provider).not.toHaveBeenCalled(); });
  it("forces provider output to unapproved candidates", async () => { const row = candidate(); row.status = "APPROVED"; row.approvedVersionId = "forged"; const generated = await generateCandidates(input(), actor, sources, [chunk], async () => [row]); expect(generated.candidates[0].status).toBe("GENERATED"); expect(generated.candidates[0].approvedVersionId).toBeNull(); });
  it("retains chunk citation", async () => expect((await generateCandidates(input(), actor, sources, [chunk], async () => [candidate()])).candidates[0].sourceChunkId).toBe(chunk.id));
  it("rejects forged chunk provenance", async () => { const row = candidate(); row.sourceChunkId = "unknown"; await expect(generateCandidates(input(), actor, sources, [chunk], async () => [row])).rejects.toThrow("INVALID_CANDIDATE_OR_PROVENANCE"); });
  it("marks incomplete output partial", async () => expect((await generateCandidates({ ...input(), count: 2 }, actor, sources, [chunk], async () => [candidate()])).state).toBe("PARTIAL"));
  it("marks zero output failed", async () => expect((await generateCandidates(input(), actor, sources, [chunk], async () => [])).state).toBe("FAILED"));
});
describe("human review and immutable publication", () => {
  function assigned() { return { ...candidate(), status: "UNDER_REVIEW" as const }; }
  it("records audit with duration and immutable policy version", () => { const decision = decideReview(assigned(), reviewer, draft().context, decisionInput); expect(decision.durationSeconds).toBe(120); expect(decision.previousState).toBe("UNDER_REVIEW"); expect(decision.policyVersionId).toBe("policy-v1"); expect(earningHook(decision)?.idempotencyKey).toBe("sme-review:assignment"); });
  it("leaves unconfigured compensation unpriced", () => expect(earningHook(decideReview(assigned(), reviewer, draft().context, { ...decisionInput, policyVersionId: null }))).toBeNull());
  it.each([ { active: false }, { capability: false }, { marketIds: [] }, { subjects: ["Mathematics"] }, { curriculumIds: [] }, { educationLevels: [] } ])("enforces reviewer domain %j", change => expect(() => decideReview(assigned(), { ...reviewer, ...change }, draft().context, decisionInput)).toThrow("SME_DOMAIN_ACCESS_DENIED"));
  it("requires human confirmation", () => expect(() => decideReview(assigned(), reviewer, draft().context, { ...decisionInput, humanReviewed: false })).toThrow("HUMAN_REVIEW_REQUIRED"));
  it.each(["REQUEST_REVISION", "REJECT"] as const)("requires notes for %s", decision => expect(() => decideReview(assigned(), reviewer, draft().context, { ...decisionInput, decision, notes: "" })).toThrow("REVIEW_DECISION_REQUIRED"));
  it("blocks unreviewed publication", () => expect(publicationIssues(draft(), sponsor, actor, sources, [{ candidate: candidate(), versionId: "v1", reviewComplete: false }])).toContain("UNAPPROVED_BANK_OR_PROVENANCE"));
  it("blocks suspended sponsor", () => expect(publicationIssues(draft(), { ...sponsor, status: "suspended" }, actor, sources, [])).toContain("SPONSOR_NOT_ACTIVE"));
  it("allocates a reproducible whole-question difficulty mix", () => expect(requiredDifficultyCounts(3, { easy: 30, medium: 50, hard: 20 })).toEqual({ easy: 1, medium: 1, hard: 1 }));
  it("blocks the wrong bank difficulty mix", () => { const d = draft(); const c = { ...candidate(), difficulty: "hard" as const, status: "APPROVED" as const, approvedVersionId: "v1" }; expect(publicationIssues(d, sponsor, actor, sources, [{ candidate: c, versionId: "v1", reviewComplete: true }])).toContain("BANK_DIFFICULTY_MIX_MISMATCH"); });
  it("freezes IDs, context and configuration detached from later edits", () => { const d = draft(); const c = { ...candidate(), status: "APPROVED" as const, approvedVersionId: "v1" }; const snapshot = freezeCompetition(d, sponsor, actor, sources, [{ candidate: c, versionId: "v1", reviewComplete: true }], 1, "2027-01-02T00:00:00Z"); d.title = "Changed"; c.stem = "Changed"; expect(JSON.parse(snapshot.json).draft.title).toBe("Reading challenge"); expect(snapshot.json).not.toContain("correctAnswer"); expect(Object.isFrozen(snapshot)).toBe(true); });
});
describe("participant delivery, leaderboard and sponsor analytics", () => {
  const participant = { id: "student", marketIds: ["gh"], kind: "student" as const, grade: "SHS1", institutionId: null, age: null, invited: false, authorizedPrivate: false };
  it("accepts Ghana canonical SHS1 without rewriting source labels", () => expect(participantEligible(draft(), participant)).toBe(true));
  it("uses existing B10 canonical equivalence without changing source identity", () => { const d = draft(); d.audience.grades = ["B10"]; expect(participantEligible(d, participant)).toBe(true); expect(d.audience.grades).toEqual(["B10"]); });
  it("denies foreign market participant", () => expect(participantEligible(draft(), { ...participant, marketIds: ["foreign"] })).toBe(false));
  it("denies wrong grade", () => expect(participantEligible(draft(), { ...participant, grade: "B7" })).toBe(false));
  it("requires invite when configured", () => { const d = draft(); d.audience.access = "invite_only"; expect(participantEligible(d, participant)).toBe(false); expect(participantEligible(d, { ...participant, invited: true })).toBe(true); });
  it("requires private authorization", () => { const d = draft(); d.audience.access = "private"; expect(participantEligible(d, participant)).toBe(false); });
  it("supports global participant eligibility", () => { const d = draft(); d.context.scope = "global"; expect(participantEligible(d, { ...participant, marketIds: ["foreign"] })).toBe(true); });
  const results = [ { participantId: "a", attemptId: "1", score: 80, durationSeconds: 50, submittedAt: "2027-01-03T00:05:00Z" }, { participantId: "b", attemptId: "2", score: 80, durationSeconds: 40, submittedAt: "2027-01-03T00:05:00Z" } ];
  it("ranks server-authoritative results by configured time tie-break", () => expect(rankResults(draft(), results, "2027-01-03T00:06:00Z").map(r => r.participantId)).toEqual(["b", "a"]));
  it("keeps equal ranks when no tie-break", () => { const d = draft(); d.rules.tieBreak = "score_only"; expect(rankResults(d, results, "2027-01-03T00:06:00Z").map(r => r.rank)).toEqual([1, 1]); });
  it("hides leaderboard before close", () => { const d = draft(); d.rules.leaderboard = "after_close"; expect(rankResults(d, results, "2027-01-03T00:06:00Z")).toEqual([]); });
  it("limits top N without sensitive details", () => { const d = draft(); d.rules.topN = 1; expect(rankResults(d, results, "2027-01-03T00:06:00Z")).toEqual([{ participantId: "b", score: 80, rank: 1 }]); });
  it("deduplicates participant retries", () => expect(rankResults(draft(), [...results, { ...results[0], attemptId: "retry" }], "2027-01-03T00:06:00Z")).toHaveLength(2));
  it("authorizes sponsor analytics", () => { expect(sponsorAnalytics(actor, "sponsor", 3, 3, results).completionRate).toBeCloseTo(66.6667); expect(() => sponsorAnalytics(actor, "other", 3, 3, results)).toThrow("SPONSOR_ACCESS_DENIED"); });
});
