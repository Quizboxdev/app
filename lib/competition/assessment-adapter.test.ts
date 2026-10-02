import { describe, expect, it, vi } from "vitest";
import { completeCompetitionAttempt, startCompetitionAttempt, type CompetitionAssessmentAdapter, type PublishedCompetition } from "./assessment-adapter";
import { chunkExtract, decideReview, earningHook, freezeCompetition, generateCandidates, rankResults, sponsorAnalytics, type Actor, type Candidate, type Draft } from "./lifecycle";
import type { SourceCorpus } from "../content/market-context";

const actor: Actor = { userId: "owner", sponsorId: "sponsor", role: "sponsor_owner", marketIds: ["gh"] };
const source: SourceCorpus = { id: "doc", kind: "sponsor_document", market_id: "gh", curriculum_id: null, authority_id: null, active: true, validation_status: "approved" };
const draft: Draft = { id: "competition", sponsorId: "sponsor", title: "Mock source challenge", description: "Controlled lifecycle", startsAt: "2027-01-03T00:00:00Z", endsAt: "2027-01-04T00:00:00Z", registrationOpensAt: "2027-01-01T00:00:00Z", registrationClosesAt: "2027-01-02T00:00:00Z", context: { scope: "local_market", sourceMode: "sponsor_document", marketIds: ["gh"], sourceIds: ["doc"] }, audience: { kind: "student", access: "public", grades: [], institutionIds: [], minAge: null, maxAge: null }, rules: { totalQuestions: 1, questionsPerAttempt: 1, durationSeconds: 120, attemptLimit: 1, difficulty: { easy: 100, medium: 0, hard: 0 }, randomizeQuestions: false, randomizeAnswers: false, scoring: "points", negativeMarking: 0, passMark: null, tieBreak: "score_only", answerVisibility: "after_close", explanationVisibility: "after_close", leaderboard: "during", topN: null } };
const participant = { id: "student", marketIds: ["gh"], kind: "student" as const, grade: "SHS1", institutionId: null, age: null, invited: false, authorizedPrivate: false };
const published: PublishedCompetition = { draft, snapshotId: "snapshot", assessmentId: "assessment", published: true };
const attempt = { competitionId: draft.id, snapshotId: published.snapshotId, participantId: participant.id, attemptId: "attempt", attemptNumber: 1 };
function adapter(): CompetitionAssessmentAdapter { return { start: vi.fn(async () => attempt), save: vi.fn(async () => undefined), complete: vi.fn(async () => ({ attemptId: "attempt", score: 1, percentage: 100, submittedAt: "2027-01-03T00:02:00Z" })) }; }
describe("mocked sponsor-to-participant lifecycle using assessment adapter", () => {
  it("extracts, generates, reviews, freezes, completes and aggregates without client grading", async () => {
    const chunks = chunkExtract("doc", [{ text: "The safety switch disconnects power.", page: 2, chapter: "Safety", section: null, heading: null }]);
    const row: Candidate = { id: "candidate", competitionId: draft.id, jobId: "job", sourceDocumentId: source.id, sourceChunkId: chunks[0].id, stem: "Does the safety switch disconnect power?", options: ["True", "False"], correctAnswer: 0, explanation: "The source states it disconnects power.", difficulty: "easy", cognitiveLevel: "recall", subject: "Computing", curriculumId: null, educationLevel: "SHS", model: "mock", status: "GENERATED", approvedVersionId: null };
    const generated = await generateCandidates({ competitionId: draft.id, sponsorId: draft.sponsorId, jobId: "job", provider: "mock", model: "mock", count: 1, context: draft.context }, actor, [source], chunks, async () => [row]);
    const reviewed = { ...generated.candidates[0], status: "UNDER_REVIEW" as const };
    const decision = decideReview(reviewed, { id: "reviewer", active: true, capability: true, marketIds: ["gh"], subjects: ["Computing"], curriculumIds: [], educationLevels: ["SHS"] }, draft.context, { assignmentId: "review", decision: "APPROVE", notes: "Verified against page 2", startedAt: "2027-01-01T00:00:00Z", completedAt: "2027-01-01T00:01:00Z", humanReviewed: true, policyVersionId: "policy-v1" });
    expect(earningHook(decision)?.policyVersionId).toBe("policy-v1");
    const approved = { ...reviewed, status: "APPROVED" as const, approvedVersionId: "question-version" };
    const frozen = freezeCompetition(draft, { id: "sponsor", organizationName: "Example", status: "active" }, actor, [source], [{ candidate: approved, versionId: "question-version", reviewComplete: true }], 1, "2027-01-02T00:00:00Z");
    expect(frozen.json).not.toContain("correctAnswer");
    const engine = adapter();
    const started = await startCompetitionAttempt(published, participant, "2027-01-03T00:00:00Z", engine);
    await engine.save({ attemptId: started.attemptId, questionId: "question", selectedValue: "A" });
    const result = await completeCompetitionAttempt(started, engine);
    expect(engine.complete).toHaveBeenCalledWith({ attemptId: started.attemptId });
    const official = [{ participantId: participant.id, attemptId: started.attemptId, score: result.score, durationSeconds: 120, submittedAt: result.submittedAt }];
    expect(rankResults(draft, official, result.submittedAt)[0].rank).toBe(1);
    expect(sponsorAnalytics(actor, "sponsor", 1, 1, official).completionRate).toBe(100);
  });
  it("never starts an unpublished competition", async () => { const engine = adapter(); await expect(startCompetitionAttempt({ ...published, published: false }, participant, draft.startsAt, engine)).rejects.toThrow("COMPETITION_NOT_PUBLISHED"); expect(engine.start).not.toHaveBeenCalled(); });
  it("never starts before opening or after closing", async () => { const engine = adapter(); for (const time of [draft.registrationOpensAt, draft.endsAt]) await expect(startCompetitionAttempt(published, participant, time, engine)).rejects.toThrow("COMPETITION_NOT_OPEN"); expect(engine.start).not.toHaveBeenCalled(); });
  it("never invokes attempt engine for foreign participant", async () => { const engine = adapter(); await expect(startCompetitionAttempt(published, { ...participant, marketIds: ["foreign"] }, draft.startsAt, engine)).rejects.toThrow("PARTICIPANT_NOT_ELIGIBLE"); expect(engine.start).not.toHaveBeenCalled(); });
  it("checks snapshot identity returned by RPC adapter", async () => { const engine = adapter(); engine.start = async () => ({ ...attempt, snapshotId: "different" }); await expect(startCompetitionAttempt(published, participant, draft.startsAt, engine)).rejects.toThrow("CONTRACT_MISMATCH"); });
  it("checks authoritative result identity", async () => { const engine = adapter(); engine.complete = async () => ({ attemptId: "other", score: 1, percentage: 100, submittedAt: draft.startsAt }); await expect(completeCompetitionAttempt(attempt, engine)).rejects.toThrow("INVALID_AUTHORITATIVE"); });
});
