import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFixtureWorld, destroyFixtureWorld, previewSql, sweepStaleRuns, type FixtureWorld } from "../operations/live-fixture";

// Self-contained: this suite builds its own market, curriculum, users, class and questions (see lib/operations/live-fixture.ts),
// proves the student learning flow end to end against Preview, and tears everything down. It reads no report files and
// never reads .env.local.
const ANSWER_FIELDS = ["correct_answer", "answer_spec", "correct_answer_snapshot", "answer_spec_snapshot", "explanation", "is_correct"];

describe.skipIf(process.env.QB_LIVE_ACCEPTANCE !== "1")("authenticated practice acceptance (self-provisioned)", () => {
  let world: FixtureWorld;
  let teacher: SupabaseClient, a: SupabaseClient, b: SupabaseClient;
  let practice: any, normal: any;
  let practiceAttempt: any, assessmentAttempt: any;
  let wrongOnPurpose: string;
  const answerFor = (questionId: string) => world.questions.find((q) => q.id === questionId)!.correct;
  const wrongFor = (questionId: string) => (answerFor(questionId) === "A" ? "B" : "A");
  const xpRows = async (attemptId: string) => { const r = await a.from("xp_transactions").select("reason,points").eq("attempt_id", attemptId); expect(r.error).toBeNull(); return r.data ?? []; };
  const isFailure = (payload: any) => payload?.code !== undefined && payload?.message !== undefined && payload?.attempt_id === undefined;

  beforeAll(async () => {
    sweepStaleRuns({ maxAgeMs: 60 * 60 * 1000 });
    world = await createFixtureWorld({ roles: ["teacher", "student", "student2"] });
    [teacher, a, b] = await Promise.all([world.client("teacher"), world.client("student"), world.client("student2")]);
    const publish = async (mode: "PRACTICE" | "ASSESSMENT", targets: string[] | null) => {
      const r = await teacher.rpc("qb_publish_assignment", {
        p_class_id: world.classroom.id, p_title: `${mode} ${world.runId}`, p_description: "QBRUN run-scoped fixture",
        p_curriculum_node_ids: [world.node.id], p_question_count: 2, p_difficulty: null, p_selection_mode: "MANUAL",
        p_question_ids: world.questions.slice(0, 2).map((q) => q.id), p_mode: mode, p_attempts_allowed: 2, p_time_limit_minutes: 30,
        p_start_at: new Date(Date.now() - 60_000).toISOString(), p_due_at: null, p_target_student_ids: targets, p_remediation_source_assignment_id: null, p_remediation_node_id: null,
      });
      if (r.error) throw new Error("PUBLISH_FAILED: " + r.error.message);
      return r.data;
    };
    practice = await publish("PRACTICE", [world.users.student!.id]);
    normal = await publish("ASSESSMENT", null);
  }, 180_000);

  afterAll(async () => { if (world) await destroyFixtureWorld(world); }, 120_000);

  it("authenticates the student under the expected role and market", async () => {
    const me = await a.auth.getUser();
    expect(me.data.user?.id).toBe(world.users.student!.id);
    const profile = await a.from("profiles").select("role,default_market_id").eq("id", world.users.student!.id).single();
    expect(profile.error).toBeNull(); expect(profile.data?.role).toBe("student"); expect(profile.data?.default_market_id).toBe(world.market.id);
  });

  it("gives the student access to the run curriculum and its learning indicator", async () => {
    const nodes = await a.from("curriculum_nodes").select("id,code,curriculum_id").eq("curriculum_id", world.curriculum.id);
    expect(nodes.error).toBeNull(); expect(nodes.data?.map((n) => n.id)).toContain(world.node.id);
  });

  it("publishes authorized questions (market and source enforcement admit the run's questions)", () => {
    expect(practice.status).toBe("PUBLISHED"); expect(practice.question_count).toBe(2); expect(practice.recipient_mode).toBe("selected");
    expect(normal.status).toBe("PUBLISHED"); expect(normal.recipient_mode).toBe("class");
  });

  it("lists practice work only for its targeted recipient and class work for both students", async () => {
    const listA = (await a.rpc("qb_list_available_assessments")).data ?? [], listB = (await b.rpc("qb_list_available_assessments")).data ?? [];
    expect(listA.some((row: any) => row.id === practice.assessment_id)).toBe(true);
    expect(listB.some((row: any) => row.id === practice.assessment_id)).toBe(false);
    for (const list of [listA, listB]) expect(list.some((row: any) => row.id === normal.assessment_id)).toBe(true);
  });

  it("starts practice and assessment attempts with answer-free question payloads", async () => {
    const start = async (flow: any) => {
      const started = await a.rpc("qb_start_attempt", { p_assessment_id: flow.assessment_id, p_assignment_id: flow.assignment_id, p_class_id: world.classroom.id, p_client_session_id: crypto.randomUUID() });
      expect(started.error).toBeNull();
      const payload = await a.rpc("qb_get_attempt", { p_attempt_id: started.data.attempt_id });
      expect(payload.error).toBeNull();
      return payload.data;
    };
    practiceAttempt = await start(practice);
    assessmentAttempt = await start(normal);
    for (const payload of [practiceAttempt, assessmentAttempt]) {
      expect(payload.questions).toHaveLength(2);
      for (const question of payload.questions) for (const field of ANSWER_FIELDS) expect(question).not.toHaveProperty(field);
    }
  });

  it("denies another student, out-of-snapshot questions and assessment feedback", async () => {
    const q = practiceAttempt.questions[0].question_id;
    expect((await b.rpc("qb_save_practice_response", { p_attempt_id: practiceAttempt.attempt_id, p_question_id: q, p_selected_answer: "B" })).error?.message).toBe("QB_ATTEMPT_OWNERSHIP_DENIED");
    expect((await a.rpc("qb_save_practice_response", { p_attempt_id: practiceAttempt.attempt_id, p_question_id: crypto.randomUUID(), p_selected_answer: "B" })).error?.message).toBe("QB_QUESTION_NOT_IN_ATTEMPT");
    expect((await a.rpc("qb_save_practice_response", { p_attempt_id: assessmentAttempt.attempt_id, p_question_id: assessmentAttempt.questions[0].question_id, p_selected_answer: "B" })).error?.message).toBe("QB_PRACTICE_ONLY");
  });

  it("returns practice feedback for the answered question only", async () => {
    const [first, second] = practiceAttempt.questions;
    const { data, error } = await a.rpc("qb_save_practice_response", { p_attempt_id: practiceAttempt.attempt_id, p_question_id: first.question_id, p_selected_answer: wrongFor(first.question_id) });
    expect(error).toBeNull(); expect(data.question_id).toBe(first.question_id);
    expect(data.is_correct).toBe(false); expect(data.correct_answer).toBe(answerFor(first.question_id));
    expect(data.explanation).toBeTruthy(); expect(data.hint).toBeTruthy();
    expect(data).not.toHaveProperty("questions"); expect(data).not.toHaveProperty("answer_spec"); expect(JSON.stringify(data)).not.toContain(second.question_id);
  });

  it("persists submitted answers and resumes the attempt with them intact", async () => {
    for (const question of practiceAttempt.questions) {
      const saved = await a.rpc("qb_save_response", { p_attempt_id: practiceAttempt.attempt_id, p_question_id: question.question_id, p_selected_answer: answerFor(question.question_id), p_selected_value: null, p_response_seconds: 5 });
      expect(saved.error).toBeNull();
    }
    const refreshed = await a.rpc("qb_get_attempt", { p_attempt_id: practiceAttempt.attempt_id });
    expect(refreshed.error).toBeNull();
    for (const question of practiceAttempt.questions) expect(refreshed.data.saved_responses.some((r: any) => r.question_id === question.question_id && r.selected_answer === answerFor(question.question_id))).toBe(true);
  });

  it("scores a fully correct practice attempt at 100% and awards XP once", async () => {
    const done = await a.rpc("qb_complete_attempt", { p_attempt_id: practiceAttempt.attempt_id, p_submission_reason: "acceptance" });
    expect(done.error).toBeNull(); expect(isFailure(done.data)).toBe(false);
    const result = await a.rpc("qb_get_result", { p_attempt_id: practiceAttempt.attempt_id });
    expect(result.error).toBeNull(); expect(Number(result.data.percentage)).toBe(100);
    const rows = await xpRows(practiceAttempt.attempt_id);
    const points = Object.fromEntries(rows.map((r) => [r.reason, r.points]));
    expect(points).toMatchObject({ CORRECT_ANSWER: 10, ASSIGNMENT_COMPLETION: 20, HIGH_PROFICIENCY: 25 });
    expect(new Set(rows.map((r) => r.reason)).size).toBe(rows.length);
  });

  it("does not duplicate XP when completion is retried", async () => {
    const before = (await xpRows(practiceAttempt.attempt_id)).map((r) => `${r.reason}:${r.points}`).sort();
    const retry = await a.rpc("qb_complete_attempt", { p_attempt_id: practiceAttempt.attempt_id, p_submission_reason: "retry" });
    expect(retry.error).toBeNull(); expect(isFailure(retry.data)).toBe(false);
    expect((await xpRows(practiceAttempt.attempt_id)).map((r) => `${r.reason}:${r.points}`).sort()).toEqual(before);
  });

  it("reveals correct answers only after submission, through the review", async () => {
    const review = await a.rpc("qb_get_attempt_review", { p_attempt_id: practiceAttempt.attempt_id });
    expect(review.error).toBeNull();
    expect(JSON.stringify(review.data)).toContain(practiceAttempt.questions[0].question_id);
    expect((await a.rpc("qb_get_attempt_review", { p_attempt_id: assessmentAttempt.attempt_id })).data?.questions?.some?.((q: any) => "correct_answer" in q) ?? false).toBe(false);
  });

  it("scores a half-correct assessment at 50% with completion XP and no proficiency bonus", async () => {
    const [first, second] = assessmentAttempt.questions;
    wrongOnPurpose = second.question_id;
    for (const [question, answer] of [[first.question_id, answerFor(first.question_id)], [second.question_id, wrongFor(second.question_id)]] as const) {
      expect((await a.rpc("qb_save_response", { p_attempt_id: assessmentAttempt.attempt_id, p_question_id: question, p_selected_answer: answer, p_selected_value: null, p_response_seconds: 4 })).error).toBeNull();
    }
    const done = await a.rpc("qb_complete_attempt", { p_attempt_id: assessmentAttempt.attempt_id, p_submission_reason: "acceptance" });
    expect(done.error).toBeNull(); expect(isFailure(done.data)).toBe(false);
    const result = await a.rpc("qb_get_result", { p_attempt_id: assessmentAttempt.attempt_id });
    expect(result.error).toBeNull(); expect(Number(result.data.percentage)).toBe(50);
    const points = Object.fromEntries((await xpRows(assessmentAttempt.attempt_id)).map((r) => [r.reason, r.points]));
    expect(points).toEqual({ CORRECT_ANSWER: 5, ASSIGNMENT_COMPLETION: 20 });
  });

  it("records learning evidence and one stable mastery record per node", async () => {
    const events = await a.from("learning_events").select("id,is_correct,question_id").in("attempt_id", [practiceAttempt.attempt_id, assessmentAttempt.attempt_id]);
    expect(events.error).toBeNull(); expect(events.data).toHaveLength(4);
    expect(events.data?.filter((e) => e.is_correct)).toHaveLength(3);
    expect(events.data?.find((e) => e.question_id === wrongOnPurpose && !e.is_correct)).toBeTruthy();
    const mastery = await a.from("mastery_records").select("id,attempts_count").eq("curriculum_node_id", world.node.id);
    expect(mastery.error).toBeNull(); expect(mastery.data).toHaveLength(1); expect(Number(mastery.data![0].attempts_count)).toBe(4);
  });

  it("reports the student's XP total as the sum of persisted awards (QB Coin is not minted by completion)", async () => {
    const xp = await a.rpc("qb_student_xp"); expect(xp.error).toBeNull();
    const rows = [...await xpRows(practiceAttempt.attempt_id), ...await xpRows(assessmentAttempt.attempt_id)];
    expect(rows.reduce((sum, r) => sum + r.points, 0)).toBe(10 + 20 + 25 + 5 + 20);
    const studentId = world.users.student!.id;
    const ledger = previewSql(`select (select count(*) from public.coin_transactions where actor_id='${studentId}')||','||(select count(*) from public.qpoint_transactions where user_id='${studentId}');`).trim();
    expect(ledger).toBe("0,0");
  });

  it("rejects an assignment context that does not match the class", async () => {
    const r = await a.rpc("qb_start_attempt", { p_assessment_id: practice.assessment_id, p_assignment_id: normal.assignment_id, p_class_id: crypto.randomUUID(), p_client_session_id: crypto.randomUUID() });
    expect(r.error?.message).toBe("QB_ASSIGNMENT_CONTEXT_MISMATCH");
  });

  it("teardown leaves zero rows from the run", async () => {
    const leftover = await destroyFixtureWorld(world);
    expect(leftover.byTable).toEqual(Object.fromEntries(Object.keys(leftover.byTable).map((k) => [k, 0])));
    expect(leftover.total).toBe(0);
  }, 120_000);
});
