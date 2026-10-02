import { participantEligible, type Draft, type Participant } from "./lifecycle";

export type CompetitionAttempt = {
  competitionId: string; snapshotId: string; participantId: string;
  attemptId: string; attemptNumber: number;
};
export type PublishedCompetition = {
  draft: Draft; snapshotId: string; assessmentId: string; published: boolean;
};
export interface CompetitionAssessmentAdapter {
  // Implementations must resolve the authenticated identity, reload the frozen
  // snapshot and lock participant limits within the existing RPC transaction.
  start(args: { competitionId: string; snapshotId: string; assessmentId: string; participantId: string; attemptLimit: number }): Promise<CompetitionAttempt>;
  save(args: { attemptId: string; questionId: string; selectedValue: unknown }): Promise<void>;
  complete(args: { attemptId: string }): Promise<{ attemptId: string; score: number; percentage: number; submittedAt: string }>;
}
export async function startCompetitionAttempt(competition: PublishedCompetition, participant: Participant, now: string, adapter: CompetitionAssessmentAdapter) {
  if (!competition.published || !competition.snapshotId || !competition.assessmentId) throw new Error("COMPETITION_NOT_PUBLISHED");
  const time = Date.parse(now);
  if (!Number.isFinite(time) || time < Date.parse(competition.draft.startsAt) || time >= Date.parse(competition.draft.endsAt)) throw new Error("COMPETITION_NOT_OPEN");
  if (!participantEligible(competition.draft, participant)) throw new Error("PARTICIPANT_NOT_ELIGIBLE");
  const attempt = await adapter.start({ competitionId: competition.draft.id, snapshotId: competition.snapshotId, assessmentId: competition.assessmentId, participantId: participant.id, attemptLimit: competition.draft.rules.attemptLimit });
  if (!attempt.attemptId || attempt.snapshotId !== competition.snapshotId || attempt.competitionId !== competition.draft.id || attempt.participantId !== participant.id || !Number.isSafeInteger(attempt.attemptNumber) || attempt.attemptNumber < 1 || attempt.attemptNumber > competition.draft.rules.attemptLimit) throw new Error("COMPETITION_ATTEMPT_CONTRACT_MISMATCH");
  return attempt;
}
export async function completeCompetitionAttempt(attempt: CompetitionAttempt, adapter: CompetitionAssessmentAdapter) {
  const result = await adapter.complete({ attemptId: attempt.attemptId });
  if (result.attemptId !== attempt.attemptId || !Number.isFinite(result.score) || !Number.isFinite(result.percentage) || result.percentage < 0 || result.percentage > 100 || !Number.isFinite(Date.parse(result.submittedAt))) throw new Error("INVALID_AUTHORITATIVE_COMPETITION_RESULT");
  return result;
}
