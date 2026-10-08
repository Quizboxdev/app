import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pilotBatch } from "./pilot";
import type { CurriculumNode } from "./contract";
import { createFixtureWorld, destroyFixtureWorld, previewSql, sweepStaleRuns, type FixtureWorld } from "../../operations/live-fixture";

// Self-contained editorial/security acceptance. The curriculum, content authorization (an approved curriculum source document),
// users, class and every question are created for this run and removed afterwards. Ingested pilot candidates keep the
// DEV_FACTORY_PILOT namespace because the exclusion tests below exercise exactly that label; they exist only inside the run.
// The optional browser-server media upload test is not part of this suite (it needs a running app and storage objects).
describe.skipIf(process.env.QB_LIVE_ACCEPTANCE !== "1")("authenticated editorial and security acceptance", () => {
  let world: FixtureWorld, world2: FixtureWorld | undefined;
  let admin: SupabaseClient, student: SupabaseClient, teacher: SupabaseClient, other: SupabaseClient;
  let batch: any, question: any;
  const scope = () => ({ curriculum: world.curriculum.id });
  const detail = async () => { const result = await admin.rpc("qb_content_detail", { p_id: question.id }); expect(result.error).toBeNull(); return result.data; };
  const review = async (action: string, human = false, patch = {}) => admin.rpc("qb_content_review", { p_id: question.id, p_action: action, p_version: question.version, p_expected_state: question.validation_status, p_patch: patch, p_note: "Controlled DEV_FACTORY_PILOT workflow acceptance only; not production academic approval.", p_human_reviewed: human });
  const mappingFor = (w: FixtureWorld): CurriculumNode => ({ id: w.node.id, curriculum_id: w.curriculum.id, parent_id: null, node_type: "learning_indicator", code: w.node.code, title: w.node.title, grade_code: "B7", canonical_grade_code: "B7", source_grade_code: "B7", subject_code: "Mathematics", education_level: "JHS", is_active: true });
  // Question text is deliberately the shared pilot text: identical text exists in other markets (including other runs and persistent
  // Preview data), and ingest must neither read nor mutate those rows. Only external ids are run-prefixed (they are globally unique).
  const batchFor = (w: FixtureWorld) => {
    const input = pilotBatch(mappingFor(w));
    input.spec.provenance.sourceVersion = "factory-pilot-v1";
    (input.spec as any).sourceDocumentIds = [w.documentId];
    input.candidates.forEach((candidate) => { candidate.external_question_id = candidate.external_question_id.replace("DEV_FACTORY_PILOT_", `QBRUN-${w.runId}-ING-`); });
    return input;
  };
  const runBatch = () => batchFor(world);
  const ingest = (input = runBatch()) => admin.rpc("qb_content_ingest", { p_spec: input.spec, p_candidates: input.candidates, p_source_file: `qbrun-${world.runId}.json`, p_provider: "local-sample", p_model: "controlled-v1" });
  const publishPractice = async (questionIds: string[], targets: string[]) => {
    const published = await teacher.rpc("qb_publish_assignment", {
      p_class_id: world.classroom.id, p_title: "QBRUN factory " + world.runId, p_description: "QBRUN run-scoped fixture", p_curriculum_node_ids: [world.node.id],
      p_question_count: questionIds.length, p_difficulty: null, p_selection_mode: "MANUAL", p_question_ids: questionIds, p_mode: "PRACTICE", p_attempts_allowed: 1,
      p_time_limit_minutes: 30, p_start_at: new Date(Date.now() - 60_000).toISOString(), p_due_at: null, p_target_student_ids: targets, p_remediation_source_assignment_id: null, p_remediation_node_id: null,
    });
    expect(published.error).toBeNull();
    return published.data;
  };

  beforeAll(async () => {
    sweepStaleRuns();
    world = await createFixtureWorld({ roles: ["admin", "teacher", "student", "student2"], otherTenant: true, reviewerDomain: true });
    [admin, teacher, student, other] = await Promise.all([world.client("admin"), world.client("teacher"), world.client("student"), world.client("student2")]);
    const response = await ingest();
    if (response.error) throw new Error("INGEST_FAILED: " + response.error.message);
    batch = response.data;
    const queue = await admin.rpc("qb_content_queue", { p_filters: { ...scope(), batch: batch.batch_id }, p_page: 1, p_limit: 25 });
    expect(queue.error).toBeNull(); question = queue.data.rows.find((q: any) => q.answer_type === "SINGLE_CHOICE");
    await review("review"); question = (await detail()).question;
  }, 180_000);
  afterAll(async () => { if (world2) await destroyFixtureWorld(world2); if (world) await destroyFixtureWorld(world); }, 120_000);

  it("ingests mapped local pilot samples without auto-approval", async () => {
    const { data, error } = await admin.from("content_import_batches").select("valid_records,rejected_records,report").eq("id", batch.batch_id).single();
    expect(error).toBeNull(); expect(data?.valid_records).toBe(3); expect(data?.rejected_records).toBe(1); expect(data?.report.auto_approved).toBe(0);
  });
  it("preserves rejected candidates only in staging", async () => { const r = await admin.from("question_import_staging").select("issues,imported_question_id").eq("import_batch_id", batch.batch_id).eq("classification", "rejected"); expect(r.error).toBeNull(); expect(r.data).toHaveLength(1); expect(r.data?.[0].imported_question_id).toBeNull(); });
  it("replays ingestion without duplicate writes", async () => { const r = await ingest(); expect(r.error).toBeNull(); expect(r.data.replayed).toBe(true); expect(r.data.batch_id).toBe(batch.batch_id); });
  it("flags exact duplicates in the live queue", async () => { const r = await admin.rpc("qb_content_queue", { p_filters: { ...scope(), batch: batch.batch_id }, p_page: 1, p_limit: 25 }); expect(r.data.rows.some((q: any) => q.duplicate_group_id)).toBe(true); });
  it("denies student editorial queue and details", async () => { for (const name of ["qb_content_queue", "qb_content_detail"]) expect((await student.rpc(name, name.endsWith("detail") ? { p_id: question.id } : { p_filters: scope() })).error).not.toBeNull(); });
  it("denies teacher approval of platform content", async () => expect((await teacher.rpc("qb_content_review", { p_id: question.id, p_action: "approve", p_version: question.version, p_expected_state: "review", p_patch: {}, p_note: "Unauthorized approval probe", p_human_reviewed: true })).error?.message).toBe("QB_CONTENT_ACCESS_DENIED"));
  it("blocks raw student answer columns and editorial versions", async () => { expect((await student.from("questions").select("correct_answer,answer_spec").limit(1)).error).not.toBeNull(); const versions = await student.from("question_versions").select("id").limit(1); expect(versions.error).toBeNull(); expect(versions.data).toEqual([]); });
  it("returns no raw questions to students under RLS", async () => { const r = await student.from("questions").select("id").limit(10); expect(r.error).toBeNull(); expect(r.data).toEqual([]); });
  it("blocks raw answer-bearing assessment snapshots", async () => { const r = await student.from("assessment_questions").select("correct_answer_snapshot,answer_spec_snapshot").limit(1); expect(r.data ?? []).toEqual([]); });
  it("rejects hidden answer keys in rich-content metadata on the server", async () => {
    const candidate = runBatch().candidates[0];
    const r = await admin.rpc("qb_content_validation_errors", { p: { ...candidate, question_content: { blocks: [{ type: "text", text: "Question", answer_spec: { correct: "A" } }] } } });
    expect(r.error).toBeNull(); expect(r.data).toContain("UNSAFE_CONTENT");
  });
  it.each([
    { answer_type: "NUMERIC", answer_spec: { value: 2, tolerance: -1 } },
    { answer_type: "SHORT_TEXT", answer_spec: { accepted: [] } },
    { answer_type: "EXPRESSION", answer_spec: { value: "x+1" } },
    { answer_type: "MULTIPLE_CHOICE", answer_spec: { correct_options: ["A", "A"] } },
  ])("rejects answer specifications incompatible with grading %j", async (patch) => {
    const candidate = runBatch().candidates[0];
    const r = await admin.rpc("qb_content_validation_errors", { p: { ...candidate, ...patch } });
    expect(r.error).toBeNull(); expect(r.data).toContain("INVALID_ANSWER_SPEC");
  });
  it("rejects unsafe LaTeX commands on the server", async () => {
    const candidate = runBatch().candidates[0];
    const r = await admin.rpc("qb_content_validation_errors", { p: { ...candidate, question_content: { blocks: [{ type: "math", latex: String.fromCharCode(92) + "href{https://example.test}{link}" }] } } });
    expect(r.error).toBeNull(); expect(r.data).toContain("UNSAFE_CONTENT");
  });
  it("prevents self-promotion to ADMIN", async () => { const uid = (await student.auth.getUser()).data.user!.id; expect((await student.from("profiles").update({ role: "ADMIN" }).eq("id", uid)).error).not.toBeNull(); });
  it("denies direct attempt/result mutation", async () => { for (const table of ["attempts", "assessment_results"]) expect((await student.from(table).update({ status: "submitted" }).eq("id", crypto.randomUUID())).error).not.toBeNull(); });
  it("rejects approval without human attestation", async () => expect((await review("approve")).error?.message).toBe("QB_HUMAN_REVIEW_REQUIRED"));
  it("rejects publication before approval", async () => expect((await review("publish")).error?.message).toBe("QB_CONTENT_NOT_APPROVED"));
  it("exercises approval/publication only on isolated pilot fixtures", async () => {
    expect(question.source_type).toBe("DEV_FACTORY_PILOT");
    expect((await review("approve", true)).error).toBeNull(); question = (await detail()).question; expect(question.status).toBe("inactive");
    expect((await review("publish")).error).toBeNull(); question = (await detail()).question; expect(question.status).toBe("active");
  });
  it("increments meaningful versions and resets approval on edit", async () => {
    const before = question.version, text = question.question_text.endsWith(" (revised)") ? question.question_text.replace(/ \(revised\)$/, "") : question.question_text + " (revised)";
    expect((await review("edit", false, { question_text: text })).error).toBeNull(); const d = await detail(); question = d.question;
    expect(question.version).toBe(before + 1); expect(question.validation_status).toBe("review"); expect(question.status).toBe("inactive"); expect(question.reviewed_by).toBeNull();
    expect(d.versions.some((v: any) => v.version === before)).toBe(true); expect(d.versions.some((v: any) => v.version === before + 1)).toBe(true);
  });
  it("rejects stale concurrent review versions", async () => expect((await admin.rpc("qb_content_review", { p_id: question.id, p_action: "reject", p_version: question.version - 1, p_expected_state: "review", p_patch: {}, p_note: "Stale update probe", p_human_reviewed: false })).error?.message).toBe("QB_CONTENT_CONFLICT"));
  it("keeps fixture approvals out of production coverage", async () => {
    const r = await admin.rpc("qb_content_coverage", { p_filters: scope() });
    expect(r.error).toBeNull(); expect(r.data.summary.totalIndicators).toBe(1);
    expect(r.data.summary.productionApproved).toBe(world.questions.length);
    expect(r.data.summary.fixtureQuestions).toBeGreaterThanOrEqual(1);
  }, 60_000);
  it("enforces server-side queue limits", async () => expect((await admin.rpc("qb_content_queue", { p_filters: scope(), p_limit: 1000 })).error).not.toBeNull());
  it.each(["qb_content_queue", "qb_content_coverage", "qb_content_batches"])("rejects null pagination for %s", async (name) => expect((await admin.rpc(name, name === "qb_content_batches" ? { p_limit: null } : { p_filters: scope(), p_limit: null })).error?.message).toBe("QB_INVALID_PAGE"));
  it("counts authorized approved availability consistently", async () => {
    const r = await teacher.rpc("qb_question_availability", { p_curriculum_node_ids: [world.node.id], p_grade: "B7", p_subject_code: "Mathematics" });
    expect(r.error).toBeNull(); expect(Number(r.data[0].approved_count)).toBeGreaterThanOrEqual(world.questions.length);
    expect(Number(r.data[0].easy_count) + Number(r.data[0].medium_count) + Number(r.data[0].hard_count)).toBe(Number(r.data[0].approved_count));
  });
  it("never delivers unapproved questions through legacy catalogue RPC", async () => {
    const r = await student.rpc("qb_get_questions", { p_subject_code: "Mathematics", p_limit: 100 });
    expect(r.error).toBeNull(); expect(r.data.some((q: any) => q.id === question.id)).toBe(false);
  });
  it("hides uncertified legacy standalone snapshots from new delivery", async () => {
    const result = await student.rpc("qb_list_available_assessments"); expect(result.error).toBeNull();
    expect(result.data.some((a: any) => a.subject_code === "QBTEST")).toBe(false);
  });
  it("allows answer-free teacher bank metadata and difficulty filters", async () => {
    const r = await teacher.from("questions").select("id,question_text,difficulty_label").eq("subject_code", "Mathematics").or("difficulty_code.eq.easy,difficulty_label.eq.easy").range(0, 24);
    expect(r.error).toBeNull(); expect(r.data!.length).toBeGreaterThan(0);
    expect(r.data?.[0]).not.toHaveProperty("correct_answer");
  });
  it("creates, joins idempotently and archives a labeled run class", async () => {
    const teacherId = (await teacher.rpc("qb_current_teacher_id")).data;
    const teacherUser = (await teacher.auth.getUser()).data.user!.id;
    const created = await teacher.from("classes").insert({ class_name: `QBRUN lifecycle ${world.runId}`, grade: "B7", grade_label: "Basic 7", teacher_id: teacherId, primary_teacher_id: teacherId, teacher_user_id: teacherUser, curriculum_id: world.curriculum.id, education_level: "JHS", status: "active", join_code: "QBFACT-" + crypto.randomUUID().slice(0, 8).toUpperCase() }).select("id,join_code").single();
    expect(created.error).toBeNull();
    const classroom = created.data!;
    try {
      const first = await student.rpc("qb_join_class", { p_join_code: classroom.join_code });
      const retry = await student.rpc("qb_join_class", { p_join_code: classroom.join_code });
      expect(first.error).toBeNull(); expect(retry.error).toBeNull(); expect(retry.data.membership_id).toBe(first.data.membership_id);
    } finally { expect((await teacher.from("classes").update({ status: "archived" }).eq("id", classroom.id)).error).toBeNull(); }
  });
  it("rejects invalid generation specifications before queueing", async () => { const spec = { ...runBatch().spec, subject: "invented" }; expect((await admin.rpc("qb_content_request_generation", { p_spec: spec })).error).not.toBeNull(); });
  it("queues valid requests without pretending a provider executed", async () => { const r = await admin.rpc("qb_content_request_generation", { p_spec: runBatch().spec }); expect(r.error).toBeNull(); const queued = await admin.from("content_import_batches").select("provider,report").eq("id", r.data.batch_id).single(); expect(queued.data?.provider).toBe("not-configured"); expect(queued.data?.report.state).toBe("awaiting_provider"); });
  it("denies other-student attempt and result access", async () => {
    const published = await publishPractice(world.questions.slice(0, 1).map((q) => q.id), [world.users.student!.id]);
    const start = await student.rpc("qb_start_attempt", { p_assessment_id: published.assessment_id, p_assignment_id: published.assignment_id, p_class_id: world.classroom.id, p_client_session_id: crypto.randomUUID() });
    expect(start.error).toBeNull();
    for (const client of [other, teacher]) for (const rpc of ["qb_get_attempt", "qb_get_result", "qb_get_attempt_review"]) expect((await client.rpc(rpc, { p_attempt_id: start.data.attempt_id })).error).not.toBeNull();
  });
  it("denies teacher-owned class creation in an unrelated tenant", async () => {
    const tid = await teacher.rpc("qb_current_teacher_id"); expect(tid.error).toBeNull();
    const uid = (await teacher.auth.getUser()).data.user!.id;
    const result = await teacher.from("classes").insert({ class_name: `QBRUN forbidden tenant probe ${world.runId}`, grade: "B7", grade_label: "Basic 7", teacher_id: tid.data, primary_teacher_id: tid.data, teacher_user_id: uid, tenant_id: world.otherTenantId, status: "active", join_code: "QBDENY-" + crypto.randomUUID().slice(0, 8) });
    expect(result.error?.code).toBe("42501");
  });
  it("keeps published snapshots unchanged after a governed edit", async () => {
    const target = world.questions[2]; // approved, active, run-scoped, not used by other tests
    const published = await publishPractice([target.id], [world.users.student!.id]);
    const start = await student.rpc("qb_start_attempt", { p_assessment_id: published.assessment_id, p_assignment_id: published.assignment_id, p_class_id: world.classroom.id, p_client_session_id: crypto.randomUUID() });
    expect(start.error).toBeNull();
    question = (await admin.rpc("qb_content_detail", { p_id: target.id })).data.question;
    const text = question.question_text, version = question.version;
    expect((await review("edit", false, { question_text: text + " [snapshot revision]" })).error).toBeNull();
    const payload = await student.rpc("qb_get_attempt", { p_attempt_id: start.data.attempt_id }); expect(payload.error).toBeNull();
    expect(payload.data.questions[0].question_text).toBe(text);
    expect(payload.data.questions[0]).not.toHaveProperty("correct_answer");
    const history = await admin.from("question_versions").select("snapshot").eq("question_id", target.id).eq("version_no", version).single();
    expect(history.error).toBeNull(); expect(history.data?.snapshot.question_text).toBe(text);
  }, 30_000);
  it("does not read, group or mutate duplicates across markets, and still groups inside the market", async () => {
    // A second, independent market ingests the identical pilot text. Before the fix this failed with QB_CONTENT_SOURCE_DENIED because the
    // grouping UPDATE touched the first market's rows, and the lookup would also have revealed that those rows exist.
    world2 = await createFixtureWorld({ roles: ["admin", "teacher"] });
    const admin2 = await world2.client("admin");
    const snapshot = () => previewSql(`select coalesce(string_agg(id::text||':'||coalesce(duplicate_group_id,'-'),',' order by id),'') from public.questions where import_batch_id='${batch.batch_id}'::uuid;`).trim();
    const before = snapshot();
    const input = batchFor(world2);
    const result = await admin2.rpc("qb_content_ingest", { p_spec: input.spec, p_candidates: input.candidates, p_source_file: `qbrun-${world2.runId}.json`, p_provider: "local-sample", p_model: "controlled-v1" });
    expect(result.error).toBeNull(); expect(result.data.valid).toBe(3); expect(result.data.rejected).toBe(1);
    expect(snapshot()).toBe(before); // the first market's rows were not touched
    const staging = await admin2.from("question_import_staging").select("external_source_id,classification").eq("import_batch_id", result.data.batch_id);
    expect(staging.error).toBeNull();
    const byId = Object.fromEntries(staging.data!.map((r) => [r.external_source_id, r.classification]));
    const original = `QBRUN-${world2.runId}-ING-MATHEMATICS_1`;
    expect(byId[original]).toBe("valid"); // identical text exists only in another market, so it is not a duplicate here
    expect(byId[original + "_DUPLICATE"]).toBe("warning"); // the in-market duplicate is still detected
    const groups = await admin2.rpc("qb_content_queue", { p_filters: { curriculum: world2.curriculum.id, batch: result.data.batch_id }, p_page: 1, p_limit: 25 });
    expect(groups.error).toBeNull();
    expect(groups.data.rows.filter((q: any) => q.duplicate_group_id).length).toBe(2); // the in-market pair, both grouped
  }, 120_000);
  // Throttle order (migration 20261010100000): the budget is charged before the market/content gate, so denied calls are throttled too, and the
  // gate's own error is identical for every denied call (the throttle point reveals nothing about whether the target exists).
  it.each([
    ["qb_content_request_generation", 12, () => ({ p_spec: { ...runBatch().spec, indicatorId: crypto.randomUUID() } })],
    ["qb_content_ingest", 24, () => { const input = runBatch(); return { p_spec: { ...input.spec, indicatorId: crypto.randomUUID() }, p_candidates: input.candidates, p_source_file: "denied.json", p_provider: "local-sample", p_model: "controlled-v1" }; }],
  ] as const)("throttles denied %s calls before any authorization lookup", async (name, calls, args) => {
    const messages: string[] = [];
    for (let i = 0; i < calls; i++) { const r = await other.rpc(name, args() as any); expect(r.error).not.toBeNull(); messages.push(r.error!.message); }
    expect(messages).toContain("QB_RATE_LIMITED");
    const denials = messages.filter((m) => m !== "QB_RATE_LIMITED");
    expect(denials.length).toBeGreaterThan(0);
    expect(new Set(denials).size).toBe(1); // identical denial every time: no existence signal
    expect(messages.indexOf("QB_RATE_LIMITED")).toBeGreaterThan(0); // the gate answers first, then the budget runs out
  }, 120_000);
  it("throttles denied qb_content_review calls and keeps their denial identical", async () => {
    const messages: string[] = [];
    for (let i = 0; i < 4; i++) { const r = await other.rpc("qb_content_review", { p_id: crypto.randomUUID(), p_action: "reject", p_version: 1, p_expected_state: "review", p_patch: {}, p_note: "probe", p_human_reviewed: false }); expect(r.error).not.toBeNull(); messages.push(r.error!.message); }
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).not.toBe("QB_RATE_LIMITED");
    const spent = previewSql(`select coalesce(sum(used),0) from quizbox_private.operation_budgets where actor_id='${world.users.student2!.id}' and operation='qb_content_review';`, { idempotent: true }).trim().split("\n").slice(-1)[0];
    expect(Number(spent)).toBeGreaterThanOrEqual(4); // denied calls are now charged to the budget
  });
  it("teardown leaves zero rows from the run", async () => { if (world2) expect((await destroyFixtureWorld(world2)).total).toBe(0); const left = await destroyFixtureWorld(world); expect(left.total).toBe(0); }, 120_000);
});
