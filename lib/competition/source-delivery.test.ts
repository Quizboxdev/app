import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createDeliveryFixture } from "./fixtures/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SponsorRepository } from "./repository";
import { uploadSource, ingestSource, type SourceStorage } from "./ingestion";
import { executeGenerationJob } from "./generation-job";
import { newWizardConfig } from "./wizard";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";

let db: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let market: string, sponsor: string, competition: string, document: string, question: string, version: string, attempt: string, assignment: string;
let repository: SponsorRepository;
const objects = new Map<string, Buffer>();
const storage: SourceStorage = { async upload(_bucket, path, bytes) { objects.set(path, bytes); }, async download(_bucket, path) { const bytes = objects.get(path); if (!bytes) throw new Error("OBJECT_MISSING"); return bytes; } };
async function actor(n: number) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]); await db.exec("set role authenticated"); }
async function call<T = Record<string, unknown>>(action: string, data: Record<string, unknown> = {}, organization: string | null = sponsor): Promise<T> {
  const result = await db.query<{ data: T }>("select public.qb_sponsor_workspace($1,$2::uuid,$3::jsonb) data", [action, organization, JSON.stringify(data)]);
  return result.rows[0].data;
}
async function negative(work: () => Promise<void>) { await db.exec("reset role; begin"); try { await work(); } finally { await db.exec("rollback; reset role"); } }
async function sourceModeFixture(mode: "HYBRID" | "CURRICULUM_ALIGNED", includeNode: boolean) {
  await actor(1);
  const draft = await repository.saveDraft(sponsor, { title: `${mode} isolated contract`, scope: "LOCAL_MARKET", sourceMode: mode, marketIds: [market] });
  const comp = draft.competition_id, cid = randomUUID(), node = randomUUID(), source = randomUUID(), chunk = randomUUID(), candidate = randomUUID();
  const text = "An isolated authorized Computing learning indicator for governance testing.";
  const checksum = createHash("sha256").update(text).digest("hex");
  await actor(2); await db.exec("reset role");
  const authority = (await db.query<{ id: string }>("select id from curriculum_authorities where market_id=$1 limit 1", [market])).rows[0].id;
  await db.query("insert into curricula(id,code,country,market_id) values($1::uuid,'ISOLATED-'||$1::uuid::text,'Ghana',$2)", [cid, market]);
  await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [cid, market, authority]);
  await db.query("insert into curriculum_nodes(id,curriculum_id,education_level,is_active,source_grade_code,canonical_grade_code,subject_code,grade_code,node_type,code,title) values($1,$2,'SHS',true,'B10','SHS1','Computing','B10','learning_indicator','B10.FIXTURE','Isolated test indicator')", [node, cid]);
  await db.query("insert into source_documents(id,title,checksum,rights_confirmed,market_id,curriculum_id,authority_id,source_kind,validation_status,approved_by,content_text) values($1,'Isolated national control',$2,true,$3,$4,$5,'CURRICULUM','approved',$6,$7)", [source, checksum, market, cid, authority, id(2), text]);
  // Curriculum ingestion is an external precondition; only its approved source
  // and extracted chunk are seeded. Review/materialization/guard RPCs are real.
  await db.query("insert into quizbox_competition.documents(id,competition_id,version,checksum,ingestion_status) values($1,$2,1,$3,'READY_FOR_GENERATION')", [source, comp, checksum]);
  await db.query("insert into quizbox_competition.chunks(id,document_id,position,source_text,checksum) values($1,$2,0,$3,$4)", [chunk, source, text, checksum]);
  await actor(1); const sources: string[] = [source];
  if (mode === "HYBRID") {
    const uploaded = await uploadSource(repository, storage, { sponsor, competition: comp, title: "Hybrid sponsor extract", market, rightsConfirmed: true, mime: "text/plain", bytes: Buffer.from("Safety switches disconnect power.") });
    await ingestSource(repository, storage, sponsor, comp, uploaded.id);
    await actor(2); await db.exec("reset role"); await db.query("update source_documents set validation_status='approved',approved_by=$1 where id=$2", [id(2), uploaded.id]); await actor(1); sources.push(uploaded.id);
  }
  await repository.saveDraft(sponsor, { ...draft.configuration, sourceIds: sources, totalQuestions: 1, questionsPerAttempt: 1, easy: 100, medium: 0, hard: 0, durationSeconds: 120, attemptLimit: 1, randomizeQuestions: false, randomizeAnswers: false, scoring: "points", audience: "student", access: "public", tieBreak: "completion_time", leaderboard: "during", answerVisibility: "after_close", explanationVisibility: "after_close", seniorReviewRequired: mode === "HYBRID", registrationOpensAt: "2020-01-01T00:00:00Z", registrationClosesAt: "2090-01-01T00:00:00Z", startsAt: "2090-01-01T00:00:00Z", endsAt: "2091-01-01T00:00:00Z", domainCounts: { Computing: 1 } }, draft);
  const job = await call<{ id: string }>("queue_generation", { competition_id: comp, request_key: randomUUID(), spec: { provider: "mock", model: "fixture", scope: "LOCAL_MARKET", sourceMode: mode, marketIds: [market], sourceIds: sources, count: 1 } });
  await executeGenerationJob(repository, sponsor, comp, job.id, { name: "mock", model: "fixture", async generate(input) { return [{ id: candidate, competitionId: comp, jobId: input.jobId, sourceDocumentId: source, sourceChunkId: chunk, stem: `Is isolation required in this ${mode} control?`, options: ["True", "False"], correctAnswer: 0, explanation: "The approved control explicitly describes isolation.", difficulty: "easy", cognitiveLevel: "recall", subject: "Computing", curriculumId: cid, curriculumNodeId: includeNode ? node : null, educationLevel: "SHS", model: "fixture", status: "GENERATED", approvedVersionId: null }]; } });
  return { comp, candidate, node, cid, sources };
}

describe("source-aware delivery over the actual isolated assessment and governance SQL", () => {
  beforeAll(async () => {
    ({ db, market } = await createDeliveryFixture());
    repository = new SponsorRepository({ async rpc(_name: string, args: Record<string, unknown>) { try { return { data: await call(args.p_action as string, args.p_data as Record<string, unknown>, args.p_sponsor as string), error: null }; } catch (error) { return { data: null, error: { message: (error as Error).message } }; } } } as unknown as Pick<SupabaseClient, "rpc">);
  }, 120_000);
  afterAll(async () => { await db?.close(); });
  it("installs the staged source-aware migration transactionally", async () => {
    const result = await db.query<{ count: number }>("select count(*)::int count from information_schema.tables where table_schema='quizbox_competition' and table_name in ('registrations','official_results','leaderboard')");
    expect(result.rows[0].count).toBe(3);
  });
  it("persists sponsor, document upload, extraction and a source-only generation job", async () => {
    await actor(1);
    sponsor = (await repository.createOrganization({ organization_name: "QuizBox Demo Sponsor", organization_type: "education", country_id: (await db.query<{ country_id: string }>("select country_id from markets where id=$1", [market])).rows[0].country_id, market_id: market, contact_name: "Demo", contact_email: "demo@example.invalid" })).sponsor_id;
    await actor(2); await call("sponsor_status", { status: "active" }); await actor(1);
    competition = (await repository.saveDraft(sponsor, { title: "Document-only competition", scope: "LOCAL_MARKET", sourceMode: "SPONSOR_SOURCE", marketIds: [market] })).competition_id;
    document = (await uploadSource(repository, storage, { sponsor, competition, title: "Demo safety handbook", market, rightsConfirmed: true, mime: "text/plain", bytes: Buffer.from("Isolate power before maintenance. A safety switch disconnects power.") })).id;
    await ingestSource(repository, storage, sponsor, competition, document);
    await actor(2); await db.exec("reset role"); await db.query("update source_documents set validation_status='approved',approved_by=$1 where id=$2", [id(2), document]); await actor(1);
    const old = await repository.draft(sponsor, competition);
    await repository.saveDraft(sponsor, { ...old.configuration, sourceIds: [document], totalQuestions: 1, questionsPerAttempt: 1, easy: 100, medium: 0, hard: 0, durationSeconds: 120, attemptLimit: 2, randomizeQuestions: false, randomizeAnswers: false, negativeMarking: 0, scoring: "points", passMark: 50, audience: "student", access: "public", tieBreak: "completion_time", leaderboard: "during", answerVisibility: "after_submission", explanationVisibility: "after_submission", topN: 10, registrationOpensAt: "2020-01-01T00:00:00Z", registrationClosesAt: "2090-01-01T00:00:00Z", startsAt: "2090-01-01T00:00:00Z", endsAt: "2091-01-01T00:00:00Z" }, old);
    const job = await call<{ id: string }>("queue_generation", { competition_id: competition, request_key: id(20), spec: { provider: "mock", model: "fixture", scope: "LOCAL_MARKET", sourceMode: "SPONSOR_SOURCE", marketIds: [market], sourceIds: [document], count: 1, easy: 100, medium: 0, hard: 0 } });
    await executeGenerationJob(repository, sponsor, competition, job.id, { name: "mock", model: "fixture", async generate(input, chunks) { return [{ id: id(21), competitionId: competition, jobId: input.jobId, sourceDocumentId: document, sourceChunkId: chunks[0].id, stem: "Should power be isolated before maintenance?", options: ["True", "False"], correctAnswer: 0, explanation: "The safety handbook requires power isolation before maintenance.", difficulty: "easy", cognitiveLevel: "recall", subject: "Computing", curriculumId: null, educationLevel: "SHS", model: "fixture", status: "GENERATED", approvedVersionId: null }]; } });
    expect(await call("candidates", { competition_id: competition })).toEqual(expect.arrayContaining([expect.objectContaining({ id: id(21), curriculum_id: null })]));
  });
  it("reviews source-only candidates through persisted SME work and version-pinned earnings", async () => {
    await actor(2);
    const configure = async (entity: string, data: Record<string, unknown>) => (await db.query<{ data: { id: string } }>("select public.qb_sme_configure($1,$2::jsonb) data", [entity, JSON.stringify(data)])).rows[0].data;
    await configure("sme_profiles", { user_id: id(3), reviewer_tier: "qualified", reviewer_status: "verified", active: true });
    await configure("sme_domain_assignments", { id: id(22), reviewer_id: id(3), subject_code: "Computing", market_id: market, education_level: "SHS", can_review: true, can_approve: true });
    const policy = await configure("compensation_policies", { name: "Isolated demo policy", sponsor_id: sponsor, active: true });
    await configure("compensation_policy_versions", { policy_id: policy.id, currency_code: "GHS", effective_from: "2020-01-01T00:00:00Z", base_review_fee: "2.5", approve_fee: "1.25", reject_fee: "0.5", revision_fee: "0.25", senior_review_fee: "2", funded_by: "isolated fixture" });
    // Sponsor members cannot choose their own reviewers; assignment is a content-admin action.
    await actor(1);
    await expect(call("assign_candidate", { competition_id: competition, candidate_id: id(21), reviewer_id: id(3), domain_id: id(22) })).rejects.toThrow("QB_SME_ASSIGNMENT_DENIED");
    await expect(call("assignment_queue", {}, null)).rejects.toThrow("QB_SME_ASSIGNMENT_DENIED");
    await actor(2);
    const queue = await call<Array<{ candidate_id: string; status: string; primary_assigned: boolean; subject: string }>>("assignment_queue", { subject: "Computing" }, null);
    expect(queue).toEqual(expect.arrayContaining([expect.objectContaining({ candidate_id: id(21), status: "GENERATED", primary_assigned: false, subject: "Computing" })]));
    expect(await call("assignment_queue", { subject: "Mathematics" }, null)).toEqual([]);
    const eligible = await call<Array<{ reviewer_id: string; domain_id: string }>>("eligible_reviewers", { candidate_id: id(21) }, null);
    expect(eligible).toEqual([expect.objectContaining({ reviewer_id: id(3), domain_id: id(22) })]);
    const work = await call<{ id: string }>("assign_candidate", { competition_id: competition, candidate_id: id(21), reviewer_id: id(3), domain_id: id(22) }); assignment = work.id;
    await actor(3); const detail = await call<{ source: { excerpt: string; document_title: string } }>("review_detail", { candidate_id: id(21), assignment_id: work.id }, null);
    expect(detail.source.excerpt.length).toBeGreaterThan(0); expect(detail.source.document_title).toEqual(expect.any(String));
    const data = { candidate_id: id(21), assignment_id: work.id, decision: "approve", human_reviewed: true, note: "Reviewed against the isolated handbook", version: 1 };
    const review = await call<{ id: string }>("complete_review", data, null);
    expect((await call<{ id: string }>("complete_review", data, null)).id).toBe(review.id);
    await db.exec("reset role"); expect((await db.query<{ n: number }>("select count(*)::int n from reviewer_earnings where review_event_id=$1", [review.id])).rows[0].n).toBe(1);
  });
  it("materializes exactly one approved question/version without a curriculum node", async () => {
    await actor(1); const result = await call<{ question_id: string; version_id: string }>("materialize_candidate", { competition_id: competition, candidate_id: id(21) });
    question = result.question_id; version = result.version_id;
    expect(await call("materialize_candidate", { competition_id: competition, candidate_id: id(21) })).toMatchObject({ question_id: question, version_id: version, idempotent: true });
    await db.exec("reset role"); const q = (await db.query<{ curriculum_node_id: string | null; content_origin: string; snapshot: Record<string, unknown> }>("select q.curriculum_node_id,q.content_origin,v.snapshot from questions q join question_versions v on v.question_id=q.id where q.id=$1", [question])).rows[0];
    expect(q.curriculum_node_id).toBeNull(); expect(q.content_origin).toBe("SPONSOR_DOCUMENT"); expect(q.snapshot.origin_metadata).toMatchObject({ competition_id: competition, sponsor_id: sponsor, source_document_id: document, candidate_id: id(21), approved_by: id(3) });
  });
  it("persists balanced bank inclusion/exclusion, immutable snapshot, and publication", async () => {
    await actor(1);
    await call("include_bank", { competition_id: competition, candidate_id: id(21), position: 0 });
    await call("include_bank", { competition_id: competition, candidate_id: id(21), included: false });
    expect(await call("publication_check", { competition_id: competition })).toMatchObject({ blockers: expect.arrayContaining(["NOT_ENOUGH_APPROVED_QUESTIONS"]) });
    await call("include_bank", { competition_id: competition, candidate_id: id(21), position: 0 });
    const old = await repository.draft(sponsor, competition);
    const starts = new Date(Date.now() + 2500).toISOString();
    await repository.saveDraft(sponsor, { ...old.configuration, publishAt: "", registrationClosesAt: starts, startsAt: starts, endsAt: new Date(Date.now() + 600000).toISOString() }, old);
    expect(await call("create_snapshot", { competition_id: competition })).toMatchObject({ snapshot_id: expect.any(String), assessment_id: expect.any(String) });
    expect(await call("publish", { competition_id: competition })).toEqual({ published: true, blockers: [] });
    await db.exec("reset role");
    await expect(db.query("update quizbox_competition.snapshots set payload='{}' where competition_id=$1", [competition])).rejects.toThrow("IMMUTABLE_COMPETITION_RECORD");
    await expect(db.query("update assessment_questions set question_text_snapshot='changed' where question_id=$1", [question])).rejects.toThrow("IMMUTABLE_COMPETITION_RECORD");
  });
  it("persists eligibility and registration, then delivers only safe frozen questions", async () => {
    await actor(4);
    // An unset visible-from time ("" from the wizard) must not break discovery for every learner.
    expect(await call<Array<{ competition_id: string }>>("discover", {}, null)).toEqual(expect.arrayContaining([expect.objectContaining({ competition_id: competition })]));
    const reg = await call<{ id: string }>("register", { competition_id: competition, market_id: market }, null);
    expect(reg).toMatchObject({ eligible: true, status: "REGISTERED", participant_id: id(4) });
    expect((await call<{ id: string }>("register", { competition_id: competition }, null)).id).toBe(reg.id);
    await actor(6); expect(await call("register", { competition_id: competition, market_id: market }, null)).toMatchObject({ eligible: true }); await actor(4);
    await new Promise(resolve => setTimeout(resolve, 2600));
    const started = await call<{ attempt_id: string }>("start_competition", { competition_id: competition }, null);
    attempt = started.attempt_id; expect(attempt).toBeTypeOf("string");
    const active = (await db.query<{ data: unknown }>("select qb_get_attempt($1) data", [attempt])).rows[0].data;
    expect(JSON.stringify(active)).not.toMatch(/correct_answer|answer_spec/);
    expect(JSON.stringify(active)).toContain("Should power be isolated before maintenance?");
  });
  it("saves, resumes, scores with the original server engine and persists one official result", async () => {
    const saved = (await db.query<{ data: unknown }>("select qb_save_response($1,$2,'A',null,3) data", [attempt, question])).rows[0].data;
    expect(saved).toMatchObject({ status: "PASS" });
    expect(await call("start_competition", { competition_id: competition }, null)).toMatchObject({ attempt_id: attempt });
    const result = await call<{ id: string }>("complete_competition", { attempt_id: attempt }, null);
    expect(result).toMatchObject({ score: 1, possible_score: 1, percentage: 100, participant_id: id(4), rank_eligible: true });
    expect((await call<{ id: string }>("complete_competition", { attempt_id: attempt }, null)).id).toBe(result.id);
    const board = await call<Array<Record<string, unknown>>>("leaderboard", { competition_id: competition }, null);
    expect(board).toEqual([expect.objectContaining({ rank: 1, display_name: "Participant 1", score: 1 })]);
    expect(board.some(row => "participant_id" in row)).toBe(false);
  });
  it("serves persisted sponsor analytics and Super Admin oversight with tenant isolation", async () => {
    await actor(1); const stats = await call<{ ranking_summary: unknown[] }>("analytics", { competition_id: competition });
    expect(stats).toMatchObject({ registrations: 2, attempts_started: 1, attempts_completed: 1, completion_rate: 100, ranking_summary: [{ rank: 1, display_name: "Participant 1", score: 1, possible_score: 1 }] });
    expect(JSON.stringify(stats.ranking_summary)).not.toContain(id(4));
    await actor(5); await expect(call("analytics", { competition_id: competition })).rejects.toThrow("SPONSOR_ACCESS_DENIED");
    await expect(call("oversight", {}, null)).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await actor(2); expect(await call("oversight", {}, null)).toMatchObject({ results: [expect.objectContaining({ attempt_id: attempt })], leaderboard: [expect.objectContaining({ rank: 1 })] });
  });
  it("ranks a second authenticated participant from official server-scored results only", async () => {
    await actor(6); const started = await call<{ attempt_id: string }>("start_competition", { competition_id: competition }, null);
    const active = (await db.query<{ data: unknown }>("select qb_get_attempt($1) data", [started.attempt_id])).rows[0].data; expect(JSON.stringify(active)).not.toMatch(/correct_answer|answer_spec/);
    await db.query("select qb_save_response($1,$2,'B',null,3)", [started.attempt_id, question]);
    expect(await call("complete_competition", { attempt_id: started.attempt_id }, null)).toMatchObject({ score: 0, percentage: 0 });
    await db.exec("reset role"); await db.query("update profiles set full_name='Ama Serwaa Mensah' where id=$1", [id(4)]); await actor(6);
    const board = await call<Array<Record<string, unknown>>>("leaderboard", { competition_id: competition }, null);
    expect(board).toEqual([expect.objectContaining({ rank: 1, display_name: "Ama M.", score: 1, is_you: false }), expect.objectContaining({ rank: 2, display_name: "Participant 2", score: 0, is_you: true })]);
    expect(JSON.stringify(board)).not.toContain(id(4));
    await db.exec("reset role"); expect((await db.query<{ n: number }>("select count(*)::int n from learning_events where attempt_id=$1 and curriculum_node_id is null", [started.attempt_id])).rows[0].n).toBe(1);
    expect((await db.query<{ points: number }>("select sum(points)::int points from xp_transactions where attempt_id=$1", [started.attempt_id])).rows[0].points).toBe(20);
  });
  it("preserves learning-event and XP idempotency when completed competition is retried", async () => {
    await actor(4); await call("complete_competition", { attempt_id: attempt }, null); await db.exec("reset role");
    expect((await db.query<{ n: number }>("select count(*)::int n from quizbox_competition.official_results where attempt_id=$1", [attempt])).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from learning_events where attempt_id=$1", [attempt])).rows[0].n).toBe(1);
    expect((await db.query<{ points: number }>("select sum(points)::int points from xp_transactions where attempt_id=$1", [attempt])).rows[0].points).toBe(50);
    expect((await db.query<{ n: number }>("select count(*)::int n from mastery_records where student_user_id=$1", [id(4)])).rows[0].n).toBe(0);
  });
  it("accepts the default wizard configuration at publication (no engine or audience blockers)", async () => negative(async () => {
    await actor(1);
    const draft = await repository.saveDraft(sponsor, { ...newWizardConfig(), title: "Default configuration", scope: "LOCAL_MARKET", sourceMode: "SPONSOR_SOURCE", marketIds: [market],
      registrationOpensAt: "2030-01-01T00:00", registrationClosesAt: "2030-01-02T00:00", startsAt: "2030-01-02T00:00", endsAt: "2030-01-03T00:00" } as never);
    const gate = await call<{ blockers: string[] }>("publication_check", { competition_id: draft.competition_id });
    expect(gate.blockers).not.toContain("UNSUPPORTED_ENGINE_CONFIGURATION"); expect(gate.blockers).not.toContain("UNVERIFIED_AUDIENCE_ATTRIBUTES"); expect(gate.blockers).not.toContain("INVALID_DATES");
  }));
  it("does not relax the curriculum-only insert guard", async () => negative(async () => {
    await actor(1); await db.exec("reset role");
    await expect(db.query("insert into questions(subject_code,subject_name,grade,question_text,option_a,option_b,option_c,option_d,correct_answer) values('Computing','Computing','B10','No curriculum mapping','a','b','c','d','A')")).rejects.toThrow("QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT");
  }));
  it("rejects curriculum-aligned candidate review without a real authorized node", async () => negative(async () => {
    const fixture = await sourceModeFixture("CURRICULUM_ALIGNED", false);
    await actor(2); await expect(call("assign_candidate", { competition_id: fixture.comp, candidate_id: fixture.candidate, reviewer_id: id(3), domain_id: id(22) })).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
  }));
  for (const mode of ["HYBRID", "CURRICULUM_ALIGNED"] as const) it(`materializes ${mode} with actual authorized national identity and source provenance`, async () => negative(async () => {
    const fixture = await sourceModeFixture(mode, true);
    await actor(2); const work = await call<{ id: string }>("assign_candidate", { competition_id: fixture.comp, candidate_id: fixture.candidate, reviewer_id: id(3), domain_id: id(22) });
    await actor(3); await call("review_detail", { candidate_id: fixture.candidate, assignment_id: work.id }, null); await call("complete_review", { candidate_id: fixture.candidate, assignment_id: work.id, decision: "approve", note: "Reviewed explicit national and document control", version: 1, human_reviewed: true }, null);
    if (mode === "HYBRID") {
      await actor(1); await db.exec("savepoint premature");
      await expect(call("materialize_candidate", { competition_id: fixture.comp, candidate_id: fixture.candidate })).rejects.toThrow("CANDIDATE_NOT_APPROVED"); await db.exec("rollback to premature; release premature");
      await actor(2); await db.query("select qb_sme_configure('sme_profiles',$1::jsonb)", [JSON.stringify({ user_id: id(5), reviewer_tier: "qualified", reviewer_status: "verified", active: true })]);
      await db.query("select qb_sme_configure('sme_domain_assignments',$1::jsonb)", [JSON.stringify({ id: id(23), reviewer_id: id(5), subject_code: "Computing", market_id: market, education_level: "SHS", can_review: true, can_approve: true, can_senior_review: true })]);
      await actor(2); const senior = await call<{ id: string }>("assign_candidate", { competition_id: fixture.comp, candidate_id: fixture.candidate, reviewer_id: id(5), domain_id: id(23), kind: "senior" });
      await actor(5); await call("review_detail", { candidate_id: fixture.candidate, assignment_id: senior.id }, null); await call("complete_review", { candidate_id: fixture.candidate, assignment_id: senior.id, decision: "approve", note: "Independent senior source and national QA", version: 1, human_reviewed: true }, null);
    }
    await actor(1); const materialized = await call<{ question_id: string }>("materialize_candidate", { competition_id: fixture.comp, candidate_id: fixture.candidate });
    await db.exec("reset role"); const q = (await db.query("select curriculum_node_id,curriculum_id,source_document_ids,source_grade_code,canonical_grade_code,content_origin from questions where id=$1", [materialized.question_id])).rows[0];
    expect(q).toMatchObject({ curriculum_node_id: fixture.node, curriculum_id: fixture.cid, source_document_ids: fixture.sources, source_grade_code: "B10", canonical_grade_code: "SHS1", content_origin: mode === "HYBRID" ? "HYBRID" : "CURRICULUM" });
    await actor(1); await call("include_bank", { competition_id: fixture.comp, candidate_id: fixture.candidate, position: 0 });
    expect(await call("create_snapshot", { competition_id: fixture.comp })).toMatchObject({ snapshot_id: expect.any(String) });
    expect(await call("publish", { competition_id: fixture.comp })).toEqual({ published: true, blockers: [] });
  }));
  it("denies source-only review when the reviewer's market membership is revoked", async () => negative(async () => {
    await actor(2); await db.exec("reset role"); await db.query("update user_market_memberships set active=false where user_id=$1", [id(3)]);
    await actor(3); await expect(call("review_detail", { candidate_id: id(21), assignment_id: assignment }, null)).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
  }));
  it("rejects cross-sponsor generation sources before provider execution", async () => negative(async () => {
    await actor(5); const other = await repository.createOrganization({ organization_name: "Other fixture sponsor", organization_type: "education", country_id: (await db.query<{ country_id: string }>("select country_id from markets where id=$1", [market])).rows[0].country_id, market_id: market, contact_name: "Other", contact_email: "other@example.invalid" });
    await actor(2); await call("sponsor_status", { status: "active" }, other.sponsor_id); await actor(5);
    const draft = await repository.saveDraft(other.sponsor_id, { title: "Not owned source", scope: "LOCAL_MARKET", sourceMode: "SPONSOR_SOURCE", marketIds: [market], sourceIds: [document] });
    await expect(call("queue_generation", { competition_id: draft.competition_id, request_key: randomUUID(), spec: { provider: "mock", model: "fixture", scope: "LOCAL_MARKET", sourceMode: "SPONSOR_SOURCE", marketIds: [market], sourceIds: [document], count: 1 } }, other.sponsor_id)).rejects.toThrow(/QB_CONTENT_SOURCE_DENIED|SOURCE_NOT_READY_OR_NOT_OWNED/);
  }));
  it("honors submitted review visibility and includes explanation from the immutable version", async () => {
    await actor(4); const review = (await db.query<{ data: { questions: Array<{ correct_answer: string; explanation: string }> } }>("select qb_get_attempt_review($1) data", [attempt])).rows[0].data;
    expect(review.questions[0]).toMatchObject({ correct_answer: "A", explanation: "The safety handbook requires power isolation before maintenance." });
  });
  it("prevents additional questions being inserted into a frozen assessment", async () => negative(async () => {
    await actor(2); await db.exec("reset role"); const assessment = (await db.query<{ assessment_id: string }>("select assessment_id from attempts where id=$1", [attempt])).rows[0].assessment_id;
    await expect(db.query("insert into assessment_questions(assessment_id,question_id,question_order) values($1,$2,2)", [assessment, question])).rejects.toThrow("IMMUTABLE_COMPETITION_RECORD");
  }));
});

describe("source-aware delivery reversal", () => {
  afterAll(async () => { await db?.close(); });
  const sql = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const definition = async (signature: string) => (await db.query<{ body: string }>("select pg_get_functiondef($1::regprocedure) body", [signature])).rows[0].body;
  it("keeps the source bucket storage policy executable for authenticated callers", async () => {
    ({ db } = await createDeliveryFixture());
    const grant = await db.query<{ ok: boolean }>("select has_function_privilege('authenticated','quizbox_competition.storage_access(text,boolean)','execute') ok");
    expect(grant.rows[0].ok).toBe(true);
  }, 120_000);
  it("reverses an empty install, restores the preserved predicates and reapplies cleanly", async () => {
    await db.exec("reset role");
    await db.exec(sql("../../supabase/rollback/sponsor_source_delivery.sql"));
    const remaining = await db.query<{ count: number }>("select count(*)::int count from information_schema.tables where table_schema='quizbox_competition' and table_name in ('registrations','invitations','official_results','leaderboard')");
    expect(remaining.rows[0].count).toBe(0);
    expect(await definition("public.qb_get_attempt_review(uuid)")).not.toContain("engine_attempt_review");
    expect(await definition("quizbox_market.question_allowed(uuid,jsonb)")).not.toContain("origin_candidate_id");
    expect(await definition("quizbox_competition.dispatch(text,uuid,jsonb)")).not.toContain("materialize_candidate");
    const restored = await db.query<{ ok: boolean }>("select has_function_privilege('authenticated','quizbox_competition.dispatch(text,uuid,jsonb)','execute') ok");
    expect(restored.rows[0].ok).toBe(true);
    await db.exec(sql("../../supabase/migrations/20261002250000_sponsor_source_delivery.sql"));
    expect(await definition("quizbox_competition.dispatch(text,uuid,jsonb)")).toContain("materialize_candidate");
  });
  it("refuses reversal once source-only delivery data exists", async () => negative(async () => {
    // Inside the rolled-back transaction only: skip FK triggers to seed one invitation row.
    await db.exec("set local session_replication_role = replica");
    await db.query("insert into quizbox_competition.invitations(competition_id,participant_id,invited_by) values($1,$2,$2)", [randomUUID(), id(4)]);
    await db.exec("set local session_replication_role = origin");
    await expect(db.exec(sql("../../supabase/rollback/sponsor_source_delivery.sql"))).rejects.toThrow("ROLLBACK_REQUIRES_ARCHIVE_AND_ISOLATED_RESTORE");
  }));
});
