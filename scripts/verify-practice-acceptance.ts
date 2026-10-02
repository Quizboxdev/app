import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { acceptancePassword, fixtureMutationAllowed } from "../lib/operations/safety";
import { acceptanceAccount, acceptanceAccountPassword } from "../lib/operations/acceptance";

async function main() {
  for (const line of (await readFile(".env.local", "utf8")).split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const accountA = acceptanceAccount("student"), accountB = acceptanceAccount("student2"), teacherAccount = acceptanceAccount("teacher");
  acceptancePassword({ ...process.env, QB_ACCEPTANCE_PASSWORD: accountA.password });
  if (!process.argv.includes("--verify-ui-publication")) fixtureMutationAllowed(process.env, process.argv, "DEV_ACCEPTANCE_FIXTURE");
  if (process.argv.includes("--verify-ui-publication")) {
    const report = JSON.parse(await readFile("reports/practice-acceptance.json", "utf8"));
    const published = await admin.from("assignments").select("id,assessment_id,class_id").eq("title", "DEV Acceptance UI Remediation").order("created_at", { ascending: false }).limit(1).single();
    if (published.error) throw published.error;
    for (const [account, included] of [[accountA, true], [accountB, false]] as const) {
      const client = createClient(url, anon, options);
      const login = await client.auth.signInWithPassword(account); if (login.error) throw login.error;
      const available = await client.rpc("qb_list_available_assessments"); if (available.error) throw available.error;
      assert.equal(available.data.some((row: any) => row.id === published.data.assessment_id), included);
      if (included) {
        const before = await admin.from("mastery_records").select("*").eq("student_user_id", report.studentA).eq("curriculum_node_id", report.nodeId); if (before.error) throw before.error;
        const xp = await client.rpc("qb_student_xp"); if (xp.error) throw xp.error;
        report.ui = { published: published.data, before: before.data, xpBefore: xp.data, targetedInclusion: true, untargetedExclusion: true };
      }
    }
    await writeFile("reports/practice-acceptance.json", JSON.stringify(report, null, 2));
    console.log("UI publication: authenticated targeted inclusion PASS; untargeted exclusion PASS");
    return;
  }
  if (process.argv.includes("--verify-ui-completion")) {
    const report = JSON.parse(await readFile("reports/practice-acceptance.json", "utf8"));
    const attempt = await admin.from("attempts").select("id").eq("assignment_id", report.ui.published.id).eq("student_user_id", report.studentA).order("created_at", { ascending: false }).limit(1).single(); if (attempt.error) throw attempt.error;
    const client = createClient(url, anon, options);
    const login = await client.auth.signInWithPassword(accountA); if (login.error) throw login.error;
    const result = await client.rpc("qb_get_result", { p_attempt_id: attempt.data.id }); if (result.error) throw result.error;
    const xpAfter = await client.rpc("qb_student_xp"); if (xpAfter.error) throw xpAfter.error;
    const retry = await client.rpc("qb_complete_attempt", { p_attempt_id: attempt.data.id, p_submission_reason: "acceptance_retry" }); if (retry.error) throw retry.error;
    const xpRetry = await client.rpc("qb_student_xp"); if (xpRetry.error) throw xpRetry.error; assert.deepEqual(xpAfter.data, xpRetry.data);
    const mastery = await admin.from("mastery_records").select("*").eq("student_user_id", report.studentA).eq("curriculum_node_id", report.nodeId); if (mastery.error) throw mastery.error;
    assert.equal(mastery.data.length, 1); assert.equal(mastery.data[0].id, report.ui.before[0].id); assert(mastery.data[0].attempts_count > report.ui.before[0].attempts_count);
    const events = await admin.from("learning_events").select("id").eq("attempt_id", attempt.data.id); if (events.error) throw events.error; assert.equal(events.data.length, 2);
    const awards = await admin.from("xp_transactions").select("reason,points").eq("attempt_id", attempt.data.id); if (awards.error) throw awards.error;
    const duplicates = awards.data.length - new Set(awards.data.map((row) => row.reason)).size; assert.equal(duplicates, 0);
    Object.assign(report.ui, { attemptId: attempt.data.id, result: result.data, after: mastery.data, xpAfter: xpAfter.data, xpRetry: xpRetry.data, persistedEventCount: events.data.length, duplicateCount: duplicates, complete: true });
    await writeFile("reports/practice-acceptance.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ result: result.data.percentage, mastery: [report.ui.before[0].mastery_score, mastery.data[0].mastery_score], xp: [report.ui.xpBefore, xpAfter.data, xpRetry.data], duplicateCount: duplicates }, null, 2));
    return;
  }
  if (process.argv.includes("--verify-completion")) {
    const report = JSON.parse(await readFile("reports/practice-acceptance.json", "utf8"));
    const client = createClient(url, anon, options);
    const login = await client.auth.signInWithPassword(accountA);
    if (login.error) throw login.error;
    const result = await client.rpc("qb_get_result", { p_attempt_id: report.attemptId });
    if (result.error) throw result.error;
    const xpAfter = await client.rpc("qb_student_xp"); if (xpAfter.error) throw xpAfter.error;
    const retry = await client.rpc("qb_complete_attempt", { p_attempt_id: report.attemptId, p_submission_reason: "acceptance_retry" }); if (retry.error) throw retry.error;
    const xpRetry = await client.rpc("qb_student_xp"); if (xpRetry.error) throw xpRetry.error;
    assert.deepEqual(xpAfter.data, xpRetry.data);
    const mastery = await admin.from("mastery_records").select("*").eq("student_user_id", report.studentA).eq("curriculum_node_id", report.nodeId);
    if (mastery.error) throw mastery.error; assert.equal(mastery.data.length, 1); assert.equal(mastery.data[0].id, report.before[0].id);
    assert(mastery.data[0].attempts_count > report.before[0].attempts_count);
    assert(Number(mastery.data[0].mastery_score) !== Number(report.before[0].mastery_score));
    const events = await admin.from("learning_events").select("id,response_id").eq("attempt_id", report.attemptId); if (events.error) throw events.error; assert.equal(events.data.length, 2);
    const transactions = await admin.from("xp_transactions").select("reason,points").eq("attempt_id", report.attemptId); if (transactions.error) throw transactions.error;
    const duplicateCount = transactions.data.length - new Set(transactions.data.map((row) => row.reason)).size; assert.equal(duplicateCount, 0);
    Object.assign(report, { result: result.data, after: mastery.data, xpAfter: xpAfter.data, xpRetry: xpRetry.data, duplicateCount, persistedEventCount: events.data.length });
    await writeFile("reports/practice-acceptance.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ result: result.data.percentage, before: report.before[0].mastery_score, after: mastery.data[0].mastery_score, evidence: [report.before[0].attempts_count, mastery.data[0].attempts_count], xp: [report.xpBefore, xpAfter.data, xpRetry.data], duplicateCount }, null, 2));
    return;
  }
  const emailB = accountB.email;
  const checked = (result: { data: any; error: unknown }): any => { if (result.error) throw result.error; if (result.data == null) throw new Error("EMPTY_RESULT"); return result.data; };
  const cls = checked(await admin.from("classes").select("*").eq("class_name", "QuizBox Developer Acceptance Class").single());
  const studentA = checked(await admin.from("profiles").select("*").eq("email", accountA.email).single());
  const listed = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw listed.error;
  const users = listed.data.users;
  let userB = users.find((user) => user.email === emailB);
  if (!userB) { const created = await admin.auth.admin.createUser({ email: emailB, password: accountB.password, email_confirm: true }); if (created.error) throw created.error; userB = created.data.user; }
  checked(await admin.from("profiles").upsert({ id: userB.id, email: emailB, full_name: "QuizBox Acceptance Student B", role: "student", status: "active" }));
  const foundB = await admin.from("student_profiles").select("*").eq("user_id", userB.id).maybeSingle();
  if (foundB.error) throw foundB.error;
  let profileB = foundB.data;
  if (!profileB) profileB = checked(await admin.from("student_profiles").insert({ user_id: userB.id, grade: cls.grade, status: "active" }).select("*").single());
  if (!checked(await admin.from("tenant_memberships").select("id").eq("user_id", userB.id).eq("tenant_id", cls.tenant_id)).length) {
    checked(await admin.from("tenant_memberships").insert({ user_id: userB.id, tenant_id: cls.tenant_id, role: "MEMBER", status: "ACTIVE" }));
  }
  if (!checked(await admin.from("class_memberships").select("id").eq("class_id", cls.id).eq("student_user_id", userB.id)).length) {
    checked(await admin.from("class_memberships").insert({ class_id: cls.id, student_id: profileB.id, student_user_id: userB.id, student_email: emailB, student_name: "QuizBox Acceptance Student B", grade: cls.grade, status: "active" }));
  }
  const login = async (email: string) => { const client = createClient(url, anon, options); const result = await client.auth.signInWithPassword({ email, password: acceptanceAccountPassword(email) }); if (result.error) throw result.error; return client; };
  const [teacher, a, b] = await Promise.all([login(teacherAccount.email), login(studentA.email), login(emailB)]);
  const questions: Array<{ id: string; curriculum_node_id: string }> = checked(await admin.from("questions").select("id,curriculum_node_id").eq("source_type", "DEV_ACCEPTANCE_FIXTURE").eq("subject_code", "Computing").eq("status", "active").eq("validation_status", "approved").limit(2));
  const nodeId = questions[0].curriculum_node_id;
  const args = { p_class_id: cls.id, p_description: "DEV_ACCEPTANCE_FIXTURE secure feedback acceptance", p_curriculum_node_ids: [nodeId], p_question_count: 2, p_selection_mode: "MANUAL", p_question_ids: questions.map((q) => q.id), p_mode: "PRACTICE", p_attempts_allowed: 2, p_time_limit_minutes: 30, p_target_student_ids: [studentA.id], p_remediation_node_id: nodeId };
  const published = checked(await teacher.rpc("qb_publish_assignment", { ...args, p_title: "Secure Practice Acceptance" }));
  const normal = checked(await teacher.rpc("qb_publish_assignment", { ...args, p_title: "Class-wide Acceptance", p_target_student_ids: null, p_remediation_node_id: null, p_mode: "ASSESSMENT" }));
  const availableA = checked(await a.rpc("qb_list_available_assessments"));
  const availableB = checked(await b.rpc("qb_list_available_assessments"));
  assert(availableA.some((row: any) => row.id === published.assessment_id));
  assert(!availableB.some((row: any) => row.id === published.assessment_id));
  assert(availableA.some((row: any) => row.id === normal.assessment_id));
  assert(availableB.some((row: any) => row.id === normal.assessment_id));
  const startArgs = { p_assessment_id: published.assessment_id, p_assignment_id: published.assignment_id, p_class_id: cls.id, p_client_session_id: crypto.randomUUID() };
  assert((await b.rpc("qb_start_attempt", startArgs)).error, "Untargeted student must not start remediation");
  const attempt = checked(await a.rpc("qb_start_attempt", startArgs));
  const active = checked(await a.rpc("qb_get_attempt", { p_attempt_id: attempt.attempt_id }));
  const forbidden = ["correct_answer", "answer_spec", "correct_answer_snapshot", "answer_spec_snapshot", "explanation", "is_correct"];
  for (const q of active.questions) for (const field of forbidden) assert(!(field in q));
  assert((await b.rpc("qb_save_practice_response", { p_attempt_id: attempt.attempt_id, p_question_id: active.questions[0].question_id, p_selected_answer: "A" })).error);
  assert((await a.rpc("qb_save_practice_response", { p_attempt_id: attempt.attempt_id, p_question_id: crypto.randomUUID(), p_selected_answer: "A" })).error);
  const assessmentAttempt = checked(await a.rpc("qb_start_attempt", { ...startArgs, p_assessment_id: normal.assessment_id, p_assignment_id: normal.assignment_id }));
  const assessmentActive = checked(await a.rpc("qb_get_attempt", { p_attempt_id: assessmentAttempt.attempt_id }));
  assert((await a.rpc("qb_save_practice_response", { p_attempt_id: assessmentAttempt.attempt_id, p_question_id: assessmentActive.questions[0].question_id, p_selected_answer: "A" })).error);
  for (const q of assessmentActive.questions) for (const field of forbidden) assert(!(field in q));
  const before = checked(await admin.from("mastery_records").select("*").eq("student_user_id", studentA.id).eq("curriculum_node_id", nodeId));
  const xpBefore = checked(await a.rpc("qb_student_xp"));
  const report: Record<string, any> = { published, normal, attemptId: attempt.attempt_id, assessmentAttemptId: assessmentAttempt.attempt_id, studentB: userB.id, studentA: studentA.id, nodeId, before, xpBefore, targetedInclusion: true, untargetedExclusion: true, normalClassVisibility: true, ownershipDenied: true, foreignQuestionDenied: true, assessmentFeedbackDenied: true, activeAnswerFree: true };
  await writeFile("reports/practice-acceptance.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ targetedInclusion: true, untargetedExclusion: true, normalClassVisibility: true, assessmentFeedbackDenied: true, attemptId: attempt.attempt_id, assessmentAttemptId: assessmentAttempt.attempt_id, published }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : { message: error.message, code: error.code }); process.exitCode = 1; });
