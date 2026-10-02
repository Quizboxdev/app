import { beforeAll, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { acceptancePassword } from "../operations/safety";

describe.skipIf(process.env.QB_LIVE_ACCEPTANCE !== "1")("authenticated practice acceptance", () => {
  let a: SupabaseClient, b: SupabaseClient;
  let report: any, active: any, assessment: any, feedbackAttempt: any;
  beforeAll(async () => {
    for (const line of (await readFile(".env.local", "utf8")).split(/\r?\n/)) { const match = line.match(/^([A-Z_]+)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); }
    report = JSON.parse(await readFile("reports/practice-acceptance.json", "utf8"));
    const make = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    a = make(); b = make();
    for (const [client, email] of [[a, "student.test@quizbox.local"], [b, "student2.test@quizbox.local"]] as const) {
      const result = await client.auth.signInWithPassword({ email, password: acceptancePassword() }); if (result.error) throw new Error("ACCEPTANCE_LOGIN_FAILED");
    }
    active = (await a.rpc("qb_get_attempt", { p_attempt_id: report.attemptId })).data;
    assessment = (await a.rpc("qb_get_attempt", { p_attempt_id: report.assessmentAttemptId })).data;
    const assignment = await a.from("assignments").select("class_id").eq("id", report.published.assignment_id).single();
    if (assignment.error) throw assignment.error;
    // Fresh isolated assignments keep live tests repeatable after old attempts expire.
    const teacher = make();
    const login = await teacher.auth.signInWithPassword({ email: "teacher.test@quizbox.local", password: acceptancePassword() });
    if (login.error) throw login.error;
    for (const [key, mode, targets] of [["published", "PRACTICE", [report.studentA]], ["normal", "ASSESSMENT", null]] as const) {
      const published = await teacher.rpc("qb_publish_assignment", {
        p_class_id: assignment.data.class_id, p_title: "Acceptance regression " + mode + " " + new Date().toISOString(),
        p_description: "DEV_ACCEPTANCE_FIXTURE regression only", p_curriculum_node_ids: [report.nodeId],
        p_question_count: 2, p_difficulty: null, p_selection_mode: "MANUAL", p_question_ids: active.questions.map((question: any) => question.question_id),
        p_mode: mode, p_attempts_allowed: 2, p_time_limit_minutes: 30, p_start_at: new Date().toISOString(), p_due_at: null,
        p_target_student_ids: targets, p_remediation_source_assignment_id: null, p_remediation_node_id: null,
      });
      if (published.error) throw published.error;
      report[key] = published.data;
    }
    {
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
  it("rejects mismatched assignment context before resuming", async () => {
    const r=await a.rpc("qb_start_attempt",{p_assessment_id:report.published.assessment_id,p_assignment_id:report.normal.assignment_id,p_class_id:crypto.randomUUID(),p_client_session_id:crypto.randomUUID()});
    expect(r.error?.message).toBe("QB_ASSIGNMENT_CONTEXT_MISMATCH");
  });
  it("completes a fresh practice cycle with persisted responses, mastery and idempotent XP", async () => {
    const before=await a.from("mastery_records").select("id,mastery_score,attempts_count").eq("curriculum_node_id",report.nodeId).single();
    const xpBefore=(await a.rpc("qb_student_xp")).data;
    for(const question of feedbackAttempt.questions) {
      const first=await a.rpc("qb_save_practice_response",{p_attempt_id:feedbackAttempt.attempt_id,p_question_id:question.question_id,p_selected_answer:"B"});
      expect(first.error).toBeNull();
      const saved=await a.rpc("qb_save_response",{p_attempt_id:feedbackAttempt.attempt_id,p_question_id:question.question_id,p_selected_answer:first.data.correct_answer,p_selected_value:null,p_response_seconds:5});
      expect(saved.error).toBeNull();
      const refreshed=await a.rpc("qb_get_attempt",{p_attempt_id:feedbackAttempt.attempt_id});
      expect(refreshed.data.saved_responses.some((r:any)=>r.question_id===question.question_id && r.selected_answer===first.data.correct_answer)).toBe(true);
    }
    expect((await a.rpc("qb_complete_attempt",{p_attempt_id:feedbackAttempt.attempt_id,p_submission_reason:"acceptance"})).error).toBeNull();
    const result=await a.rpc("qb_get_result",{p_attempt_id:feedbackAttempt.attempt_id});
    expect(result.error).toBeNull(); expect(Number(result.data.percentage)).toBe(100);
    expect((await a.rpc("qb_get_attempt_review",{p_attempt_id:feedbackAttempt.attempt_id})).error).toBeNull();
    const events=await a.from("learning_events").select("id").eq("attempt_id",feedbackAttempt.attempt_id);
    expect(events.error).toBeNull(); expect(events.data).toHaveLength(2);
    const after=await a.from("mastery_records").select("id,mastery_score,attempts_count").eq("curriculum_node_id",report.nodeId).single();
    expect(after.data?.id).toBe(before.data?.id); expect(after.data?.attempts_count).toBe(Number(before.data?.attempts_count)+events.data!.length);
    const xpAfter=(await a.rpc("qb_student_xp")).data;
    expect((await a.rpc("qb_complete_attempt",{p_attempt_id:feedbackAttempt.attempt_id,p_submission_reason:"retry"})).error).toBeNull();
    const xpRetry=(await a.rpc("qb_student_xp")).data; expect(xpRetry).toEqual(xpAfter);
    const awards=await a.from("xp_transactions").select("reason,points").eq("attempt_id",feedbackAttempt.attempt_id);
    expect(awards.error).toBeNull(); expect(new Set(awards.data?.map((r)=>r.reason)).size).toBe(awards.data?.length);
    await writeFile("reports/hardening-learning-acceptance.json",JSON.stringify({generatedAt:new Date().toISOString(),attemptId:feedbackAttempt.attempt_id,masteryBefore:before.data,masteryAfter:after.data,xpBefore,xpAfter,xpRetry,eventCount:events.data?.length,duplicateXpTransactions:0,percentage:Number(result.data.percentage)},null,2));
  },30000);
});
