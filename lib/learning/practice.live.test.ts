import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

describe.skipIf(process.env.QB_LIVE_ACCEPTANCE !== "1")("authenticated practice acceptance", () => {
  let a: SupabaseClient, b: SupabaseClient;
  let report: any, active: any, assessment: any, feedbackAttempt: any;
  beforeAll(async () => {
    for (const line of (await readFile(".env.local", "utf8")).split(/\r?\n/)) { const match = line.match(/^([A-Z_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); }
    report = JSON.parse(await readFile("reports/practice-acceptance.json", "utf8"));
    const make = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    a = make(); b = make();
    for (const [client, email] of [[a, "student.test@quizbox.local"], [b, "student2.test@quizbox.local"]] as const) {
      const result = await client.auth.signInWithPassword({ email, password: process.env.QB_ACCEPTANCE_PASSWORD ?? "QuizBox123!" }); if (result.error) throw result.error;
    }
    active = (await a.rpc("qb_get_attempt", { p_attempt_id: report.attemptId })).data;
    assessment = (await a.rpc("qb_get_attempt", { p_attempt_id: report.assessmentAttemptId })).data;
    const assignment = await a.from("assignments").select("class_id").eq("id", report.published.assignment_id).single();
    if (assignment.error) throw assignment.error;
    if (assessment.attempt_status !== "in_progress") {
      const assessmentStart = await a.rpc("qb_start_attempt", { p_assessment_id: report.normal.assessment_id, p_assignment_id: report.normal.assignment_id, p_class_id: assignment.data.class_id, p_client_session_id: crypto.randomUUID() });
      if (assessmentStart.error) throw assessmentStart.error;
      const assessmentPayload = await a.rpc("qb_get_attempt", { p_attempt_id: assessmentStart.data.attempt_id });
      if (assessmentPayload.error) throw assessmentPayload.error;
      assessment = assessmentPayload.data;
    }
    const started = await a.rpc("qb_start_attempt", { p_assessment_id: report.published.assessment_id, p_assignment_id: report.published.assignment_id, p_class_id: assignment.data.class_id, p_client_session_id: crypto.randomUUID() });
    if (started.error) throw started.error;
    const feedbackPayload = await a.rpc("qb_get_attempt", { p_attempt_id: started.data.attempt_id });
    if (feedbackPayload.error) throw feedbackPayload.error;
    feedbackAttempt = feedbackPayload.data;
  }, 30000);
  it("includes the targeted recipient", async () => expect((await a.rpc("qb_list_available_assessments")).data.some((row: any) => row.id === report.published.assessment_id)).toBe(true));
  it("excludes an authenticated active classmate", async () => expect((await b.rpc("qb_list_available_assessments")).data.some((row: any) => row.id === report.published.assessment_id)).toBe(false));
  it("includes normal class work for both students", async () => { for (const client of [a, b]) expect((await client.rpc("qb_list_available_assessments")).data.some((row: any) => row.id === report.normal.assessment_id)).toBe(true); });
  it("denies other-student practice feedback", async () => expect((await b.rpc("qb_save_practice_response", { p_attempt_id: feedbackAttempt.attempt_id, p_question_id: feedbackAttempt.questions[0].question_id, p_selected_answer: "B" })).error?.message).toBe("QB_ATTEMPT_OWNERSHIP_DENIED"));
  it("denies questions outside the snapshot", async () => expect((await a.rpc("qb_save_practice_response", { p_attempt_id: feedbackAttempt.attempt_id, p_question_id: crypto.randomUUID(), p_selected_answer: "B" })).error?.message).toBe("QB_QUESTION_NOT_IN_ATTEMPT"));
  it("denies assessment feedback before submission", async () => expect((await a.rpc("qb_save_practice_response", { p_attempt_id: assessment.attempt_id, p_question_id: assessment.questions[0].question_id, p_selected_answer: "B" })).error?.message).toBe("QB_PRACTICE_ONLY"));
  it("keeps normal attempt and assessment payloads answer free", () => {
    for (const payload of [active, assessment]) for (const question of payload.questions) {
      for (const field of ["correct_answer", "answer_spec", "correct_answer_snapshot", "answer_spec_snapshot", "explanation", "is_correct"]) expect(question).not.toHaveProperty(field);
    }
  });
  it("reveals only submitted practice question feedback", async () => {
    const { data, error } = await a.rpc("qb_save_practice_response", { p_attempt_id: feedbackAttempt.attempt_id, p_question_id: feedbackAttempt.questions[0].question_id, p_selected_answer: "B" });
    expect(error).toBeNull(); expect(data.question_id).toBe(feedbackAttempt.questions[0].question_id); expect(typeof data.is_correct).toBe("boolean"); expect(data.explanation).toBeTruthy(); expect(data.hint).toBeTruthy();
    expect(data).not.toHaveProperty("questions"); expect(data).not.toHaveProperty("answer_spec"); expect(JSON.stringify(data)).not.toContain(feedbackAttempt.questions[1].question_id);
  });
  it("preserves mastery identity after improved evidence", () => {
    expect(report.after).toBeDefined();
    expect(report.after).toHaveLength(1); expect(report.after[0].id).toBe(report.before[0].id);
    expect(report.after[0].attempts_count).toBeGreaterThan(report.before[0].attempts_count);
    expect(Number(report.after[0].mastery_score)).toBeGreaterThan(Number(report.before[0].mastery_score));
  });
  it("does not add XP when completion is retried", async () => {
    expect(active.attempt_status).toBe("submitted");
    const before = await a.rpc("qb_student_xp");
    const retry = await a.rpc("qb_complete_attempt", { p_attempt_id: report.attemptId, p_submission_reason: "test_retry" }); expect(retry.error).toBeNull();
    expect((await a.rpc("qb_student_xp")).data).toEqual(before.data);
  });
  it("persisted events and XP reasons are unique", () => {
    expect(report.after).toBeDefined();
    expect(report.persistedEventCount).toBe(2); expect(report.duplicateCount).toBe(0);
  });
  it("completes zero-correct attempts without zero-point XP rows", async () => {
    const result = await a.rpc("qb_get_result", { p_attempt_id: report.assessmentAttemptId });
    expect(result.error).toBeNull(); expect(Number(result.data.percentage)).toBe(0);
    const awards = await a.from("xp_transactions").select("reason,points").eq("attempt_id", report.assessmentAttemptId);
    expect(awards.error).toBeNull(); expect(awards.data).toContainEqual({ reason: "ASSIGNMENT_COMPLETION", points: 20 });
    expect(awards.data?.some((row) => row.points === 0)).toBe(false);
  });
});
