import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIG, TOPIC, U, makeCtx, read, type Ctx } from "./mock-exams-fixture";

// Mock exams, class delivery and results (migration 20261122110000). The class publisher and the attempt engine are stand-ins (see mock-exams-fixture.ts).
const ROLLBACK = read("supabase/rollback/mock_exams_delivery.sql");
const { TEACHER, TEACHER2, STUDENT, STUDENT2, STUDENT3, SPONSOR_OK, OWNER } = U;
let c: Ctx;
beforeAll(async () => { c = await makeCtx("delivery"); });
afterAll(async () => { await c.close(); });

// A published 6-question exam (3 from B7 Fractions, 3 from B8 Algebra), a JHS class of three learners, and the exam assigned to it.
async function assigned(over: { due?: string | null } = {}) {
  const ex = await c.publishedExam(TEACHER);
  const cls = await c.makeClass(TEACHER, [STUDENT, STUDENT2, STUDENT3]);
  await c.as(TEACHER);
  const a = await c.rpc("select public.qb_mock_assign_class($1,$2,now(),$3,null)", [ex.id, cls, over.due ?? null]);
  const qids = (await c.q<{ question_id: string }>("select question_id from public.mock_exam_version_questions where version_id = $1 order by position", [ex.versionId])).map((r) => r.question_id);   // in the exam's own order
  return { ...ex, classId: cls, assignmentId: a.assignment_id as string, assessmentId: a.assessment_id as string, qids };
}
const answers = (qids: string[], correctCount: number) => qids.map((q, i) => ({ question_id: q, selected_answer: i < correctCount ? "A" : "B", is_correct: i < correctCount }));

describe("mock exams: assigning to a class", () => {
  it("assigns the published version through the one publisher and records which version went to which class", async () => {
    const x = await assigned();
    expect(x.qids).toHaveLength(6);
    const link = await c.q("select exam_id, version_id, assignment_id, class_id from public.mock_exam_assignments where assignment_id = $1", [x.assignmentId]);
    expect(link).toEqual([{ exam_id: x.id, version_id: x.versionId, assignment_id: x.assignmentId, class_id: x.classId }]);
    const asg = (await c.q("select a.title, a.question_count, s.max_attempts, s.time_limit_minutes, s.reference_type from public.assignments a join public.assessments s on s.id = a.assessment_id where a.id = $1", [x.assignmentId]))[0];
    expect(asg).toMatchObject({ title: "JHS 2 BECE readiness mock", question_count: 6, max_attempts: 1, time_limit_minutes: 60, reference_type: "ASSIGNMENT" });
    await c.as(TEACHER);
    const list = await c.rpc("select public.qb_mock_exam_assignments($1)", [x.id]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ class_name: "JHS 2 Gold", version_no: 1, learners: 3 });
    expect((await c.rpc("select public.qb_mock_class_options()")).map((o: any) => [o.class_name, o.stage, o.learners])).toContainEqual(["JHS 2 Gold", "JHS", 3]);
  });

  it("refuses an unpublished exam, someone else's class, a class of another stage, a sponsor, bad dates and an archived exam", async () => {
    const ready = await c.readyExam(TEACHER);                                       // built, not published
    const cls = await c.makeClass(TEACHER, [STUDENT]);
    await c.as(TEACHER);
    await c.fails("select public.qb_mock_assign_class($1,$2,now(),null,null)", [ready, cls], /QB_MOCK_NOT_PUBLISHED/);
    const ex = await c.publishedExam(TEACHER);
    const others = await c.makeClass(TEACHER2, [STUDENT2], { name: "Other class" });
    const primary = await c.makeClass(TEACHER, [STUDENT3], { name: "Class 6", grade: "B6", level: "Primary" });
    await c.as(TEACHER);
    await c.fails("select public.qb_mock_assign_class($1,$2,now(),null,null)", [ex.id, others], /QB_MOCK_CLASS_FORBIDDEN/);
    await c.fails("select public.qb_mock_assign_class($1,$2,now(),null,null)", [ex.id, primary], /QB_MOCK_CLASS_LEVEL_MISMATCH/);
    await c.fails("select public.qb_mock_assign_class($1,$2,now(),now() - interval '1 day',null)", [ex.id, cls], /QB_MOCK_DATES_INVALID/);
    await c.as(TEACHER2); await c.fails("select public.qb_mock_assign_class($1,$2,now(),null,null)", [ex.id, others], /QB_NOT_FOUND/);       // not their exam
    // A sponsor's exam can be built and published but not handed to a class.
    await c.as(SPONSOR_OK);
    const se = await c.rpc("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "Sponsor mock exam", curriculum_id: (await c.q<{ id: string }>("select id from public.curricula limit 1"))[0].id, target_grade: "B8", desired_total: 5 })]);
    expect(se.owner_kind).toBe("sponsor");
    await c.fails("select public.qb_mock_assign_class($1,$2,now(),null,null)", [se.id, cls], /QB_MOCK_CLASS_ONLY_TEACHERS|QB_MOCK_NOT_PUBLISHED/);
    await c.as(TEACHER); await c.rpc("select public.qb_mock_exam_archive($1)", [ex.id]);
    await c.fails("select public.qb_mock_assign_class($1,$2,now(),null,null)", [ex.id, cls], /QB_MOCK_ARCHIVED/);
  });

  it("refuses to hand out a version whose questions changed since it was published, and the next version fixes it", async () => {
    const ex = await c.publishedExam(TEACHER);
    const cls = await c.makeClass(TEACHER, [STUDENT]);
    await c.as(TEACHER);
    expect(await c.rpc("select public.qb_mock_exam_health($1)", [ex.id])).toEqual({ version_no: 1, stale_questions: 0 });
    const victim = (await c.q<{ question_id: string }>("select question_id from public.mock_exam_version_questions where version_id = $1 and position = 1", [ex.versionId]))[0].question_id;
    await c.q("update public.questions set question_text = 'Edited wording of the question?', version = 2, status = 'inactive', validation_status = 'review' where id = $1", [victim]);
    await c.as(TEACHER);
    expect(await c.rpc("select public.qb_mock_exam_health($1)", [ex.id])).toEqual({ version_no: 1, stale_questions: 1 });
    await c.fails("select public.qb_mock_assign_class($1,$2,now(),null,null)", [ex.id, cls], /QB_MOCK_VERSION_STALE: 1 question\(s\) changed/);
    // Build the next version: refill the round that lost its question, publish, assign.
    const rounds = (await c.rpc("select public.qb_mock_exam_get($1)", [ex.id])).rounds;
    await c.rpc("select public.qb_mock_round_clear($1,$2)", [ex.id, rounds[0].id]);
    await c.rpc("select public.qb_mock_round_pick($1,$2)", [ex.id, rounds[0].id]);
    expect((await c.rpc("select public.qb_mock_exam_publish($1)", [ex.id])).version_no).toBe(2);
    const a = await c.rpc("select public.qb_mock_assign_class($1,$2,now(),null,null)", [ex.id, cls]);
    expect(a.version_no).toBe(2);
    expect((await c.q("select v.version_no from public.mock_exam_assignments ma join public.mock_exam_versions v on v.id = ma.version_id where ma.assignment_id = $1", [a.assignment_id]))[0].version_no).toBe(2);
  });
});

describe("mock exams: results", () => {
  it("reports participation, completion, scores and per-question results for the owner", async () => {
    const x = await assigned();
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT, answers: answers(x.qids, 6) });
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT2, answers: answers(x.qids, 3) });
    await c.as(TEACHER);
    const r = await c.rpc("select public.qb_mock_results($1,null)", [x.id]);
    expect(r.summary).toMatchObject({ assigned: 3, started: 2, finished: 2, in_progress: 0, not_started: 1, completion_percent: 66.7, average_percent: 75, median_percent: 75, highest_percent: 100, lowest_percent: 50, scored: 2 });
    expect(r.version).toMatchObject({ version_no: 1, question_count: 6 });
    expect(r.questions).toHaveLength(6);
    expect(r.questions.map((q: any) => q.correct_percent)).toEqual([100, 100, 100, 50, 50, 50]);
    expect(r.participants.map((p: any) => [p.participant, p.state]).sort()).toEqual([["Abena Student", "not_started"], ["Esi Student", "submitted"], ["Kwame Student", "submitted"]]);
    expect(JSON.stringify(r)).not.toContain("@example.com");                         // names, never contact details
  });

  it("counts a learner who is still working as in progress, and uses the latest finished attempt for the statistics", async () => {
    const x = await assigned();
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT, answers: answers(x.qids, 2), startedAt: "2026-11-20T09:00:00Z" });
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT, answers: answers(x.qids, 6), startedAt: "2026-11-21T09:00:00Z" });
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT2, answers: answers(x.qids, 1), status: "in_progress" });
    await c.as(TEACHER);
    const r = await c.rpc("select public.qb_mock_results($1,null)", [x.id]);
    expect(r.summary).toMatchObject({ started: 2, finished: 1, in_progress: 1, not_started: 1, scored: 1, average_percent: 100 });
    expect(r.participants.filter((p: any) => p.participant === "Esi Student").map((p: any) => p.attempt_no).sort()).toEqual([1, 2]);
  });

  it("is for the owner only: other teachers, learners, sponsors and signed-out callers get nothing", async () => {
    const x = await assigned();
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT, answers: answers(x.qids, 4) });
    for (const u of [TEACHER2, STUDENT, SPONSOR_OK, OWNER]) {
      await c.as(u);
      for (const sql of ["select public.qb_mock_results($1,null)", "select public.qb_mock_result_rows($1)", "select public.qb_mock_export($1)", "select public.qb_mock_exam_assignments($1)"]) await expect(c.db.query(sql, [x.id])).rejects.toThrow(/QB_NOT_FOUND|QB_MOCK_AUTHOR_FORBIDDEN/);
    }
    await c.as(null); await c.fails("select public.qb_mock_results($1,null)", [x.id], /permission denied/);
  });

  it("shows only attempts on the exam's own assignments, never another assessment's", async () => {
    const x = await assigned();
    const y = await assigned();                                                      // a second exam with its own class
    await c.attempt({ assessmentId: y.assessmentId, assignmentId: y.assignmentId, classId: y.classId, student: STUDENT3, answers: answers(y.qids, 6) });
    await c.as(TEACHER);
    const r = await c.rpc("select public.qb_mock_results($1,null)", [x.id]);
    expect(r.summary).toMatchObject({ started: 0, finished: 0 });
    expect((await c.rpc("select public.qb_mock_result_rows($1)", [x.id])).total).toBe(0);
  });

  it("gives the student-by-question review with filters and readable answers", async () => {
    const x = await assigned();
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT, answers: answers(x.qids, 4) });
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT2, answers: answers(x.qids, 6).slice(0, 5) });           // skipped the last question
    await c.as(TEACHER);
    const all = await c.rpc("select public.qb_mock_result_rows($1)", [x.id]);
    expect(all.total).toBe(12);
    const esi = all.rows.filter((r: any) => r.participant === "Esi Student");
    expect(esi.map((r: any) => r.is_correct)).toEqual([true, true, true, true, false, false]);
    expect(esi[0]).toMatchObject({ position: 1, answer: "A: one", correct_answer: "A: one", marks_awarded: 1, marks: 1, group: "JHS 2 Gold", answered: true });
    expect(esi[4]).toMatchObject({ answer: "B: two", correct_answer: "A: one", marks_awarded: 0 });
    expect(esi[0].question_text).toMatch(/^Fractions question [0-9]+ about the topic/);
    expect(esi[0].external_id).toMatch(/^EXT-/);
    const kwame = all.rows.filter((r: any) => r.participant === "Kwame Student");
    expect(kwame[5]).toMatchObject({ answered: false, is_correct: null, answer: null, marks_awarded: 0 });          // an unanswered question is shown as such, not as wrong
    // Filters.
    expect((await c.rpc("select public.qb_mock_result_rows($1,null,null,$2)", [x.id, STUDENT])).total).toBe(6);
    expect((await c.rpc("select public.qb_mock_result_rows($1,null,null,null,$2)", [x.id, x.qids[0]])).total).toBe(2);
    expect((await c.rpc("select public.qb_mock_result_rows($1,null,$2)", [x.id, x.classId])).total).toBe(12);
    expect((await c.rpc("select public.qb_mock_result_rows($1,null,null,null,null,'in_progress')", [x.id])).total).toBe(0);
    expect((await c.rpc("select public.qb_mock_result_rows($1,null,null,null,null,'submitted',5,0)", [x.id])).rows).toHaveLength(5);
    await c.fails("select public.qb_mock_result_rows($1,null,null,null,null,'bogus')", [x.id], /QB_MOCK_INVALID/);
  });

  it("formats typed answers: numbers, fractions, several choices and short text", async () => {
    await c.addQuestions(TOPIC.GEO, 1, "typed numeric", { answerType: "NUMERIC", spec: { value: 42 } });
    const typed = [
      (await c.addQuestions(TOPIC.GEO, 1, "typed numeric two", { answerType: "NUMERIC", spec: { value: 42 } }))[0],
      (await c.addQuestions(TOPIC.GEO, 1, "typed fraction", { answerType: "FRACTION", spec: { numerator: 3, denominator: 4 } }))[0],
      (await c.addQuestions(TOPIC.GEO, 1, "typed multiple", { answerType: "MULTIPLE_CHOICE", spec: { correct_options: ["A", "C"] } }))[0],
      (await c.addQuestions(TOPIC.GEO, 1, "typed short", { answerType: "SHORT_TEXT", spec: { value: "photosynthesis" } }))[0],
      (await c.addQuestions(TOPIC.GEO, 1, "typed true false", { answerType: "TRUE_FALSE", spec: { boolean: true } }))[0],
    ];
    await c.as(TEACHER);
    const e = await c.exam(TEACHER, { title: "Typed answers mock", target_grade: "B9", desired_total: 5 });
    const r = (await c.round(e.id, "B9", "MATH", TOPIC.GEO, 5)).rounds[0];
    await c.rpc("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, r.id, typed]);
    const pub = await c.rpc("select public.qb_mock_exam_publish($1)", [e.id]);
    const review = await c.rpc("select public.qb_mock_exam_review($1)", [e.id]);
    expect(review.scoring.answer_types).toEqual({ NUMERIC: 1, FRACTION: 1, MULTIPLE_CHOICE: 1, SHORT_TEXT: 1, TRUE_FALSE: 1 });
    const cls = await c.makeClass(TEACHER, [STUDENT], { name: "JHS 3 Blue", grade: "B9" });
    await c.as(TEACHER);
    const a = await c.rpc("select public.qb_mock_assign_class($1,$2,now(),null,null)", [e.id, cls]);
    const byOrder = (await c.q<{ question_id: string }>("select question_id from public.assessment_questions where assessment_id = $1 order by question_order", [a.assessment_id])).map((x) => x.question_id);
    const type = async (qid: string) => (await c.q<{ answer_type: string }>("select answer_type from public.questions where id = $1", [qid]))[0].answer_type;
    const given: Record<string, any> = { NUMERIC: { selected_value: { value: 41 }, is_correct: false }, FRACTION: { selected_value: { numerator: 3, denominator: 4 }, is_correct: true },
      MULTIPLE_CHOICE: { selected_value: { options: ["A", "B"] }, is_correct: false }, SHORT_TEXT: { selected_value: { value: "=HYPERLINK(\"http://evil\")" }, is_correct: false }, TRUE_FALSE: { selected_answer: "A", is_correct: true } };
    const ans = []; for (const qid of byOrder) ans.push({ question_id: qid, ...given[await type(qid)] });
    await c.attempt({ assessmentId: a.assessment_id, assignmentId: a.assignment_id, classId: cls, student: STUDENT, answers: ans });
    await c.as(TEACHER);
    const rows = (await c.rpc("select public.qb_mock_result_rows($1,$2)", [e.id, pub.version_id])).rows as any[];
    const by = (t: string) => rows.find((x) => x.answer_type === t);
    expect(by("NUMERIC")).toMatchObject({ answer: "41", correct_answer: "42", is_correct: false });
    expect(by("FRACTION")).toMatchObject({ answer: "3/4", correct_answer: "3/4", is_correct: true });
    expect(by("MULTIPLE_CHOICE")).toMatchObject({ answer: "A: one; B: two", correct_answer: "A: one; C: three" });
    expect(by("SHORT_TEXT")).toMatchObject({ answer: '=HYPERLINK("http://evil")', correct_answer: "photosynthesis" });     // the database returns the text as it is; the export route neutralises it
    expect(by("TRUE_FALSE")).toMatchObject({ answer: "A: one", is_correct: true });
  });
});

describe("mock exams: export", () => {
  it("returns the export dataset with the columns a teacher needs, and audits it", async () => {
    const x = await assigned();
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT, answers: answers(x.qids, 4) });
    await c.as(TEACHER);
    const d = await c.rpc("select public.qb_mock_export($1)", [x.id]);
    expect(d).toMatchObject({ dataset: "mock_exam_results", total: 6, truncated: false });
    expect(d.label).toMatch(/Mock exam results: JHS 2 BECE readiness mock \(version 1\)/);
    expect(d.columns).toEqual(["Exam", "Version", "Purpose", "Target level", "Group", "Participant", "Attempt", "Attempt state", "Started (UTC)", "Submitted (UTC)", "Attempt score", "Attempt total marks", "Attempt percent",
      "Question no.", "Question ID", "Subject", "Level", "Question text", "Student answer", "Correct answer", "Correct", "Marks awarded", "Marks available"]);
    expect(d.rows).toHaveLength(6);
    expect(d.rows[0].length).toBe(d.columns.length);
    const row = d.rows[0];
    expect(row.slice(0, 8)).toEqual(["JHS 2 BECE readiness mock", 1, "bece_readiness", "B8", "JHS 2 Gold", "Esi Student", 1, "submitted"]);
    expect(row[8]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row.slice(13, 16)).toEqual([1, expect.stringMatching(/^EXT-/), "MATH"]);
    expect(row.slice(18)).toEqual(["A: one", "A: one", true, 1, 1]);
    const audit = await c.q("select details from public.audit_logs where action = 'mock_exam.export' and entity_id = $1", [x.id]);
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({ version: 1, rows: 6, total: 6 });
  });

  it("limits the rows, says so, and applies the filters", async () => {
    const x = await assigned();
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT, answers: answers(x.qids, 4) });
    await c.attempt({ assessmentId: x.assessmentId, assignmentId: x.assignmentId, classId: x.classId, student: STUDENT2, answers: answers(x.qids, 2) });
    await c.as(TEACHER);
    const small = await c.rpc("select public.qb_mock_export($1,null,null,null,null,null,5)", [x.id]);
    expect(small).toMatchObject({ total: 12, truncated: true }); expect(small.rows).toHaveLength(5);
    await c.q("update public.platform_settings set value = '3'::jsonb where key = 'mock_exams.export_row_limit'");
    await c.as(TEACHER);
    const capped = await c.rpc("select public.qb_mock_export($1,null,null,null,null,null,50000)", [x.id]);
    expect(capped.rows).toHaveLength(3); expect(capped.truncated).toBe(true);
    await c.q("update public.platform_settings set value = '50000'::jsonb where key = 'mock_exams.export_row_limit'");
    await c.as(TEACHER);
    expect((await c.rpc("select public.qb_mock_export($1,null,null,$2)", [x.id, STUDENT2])).total).toBe(6);
    await c.fails("select public.qb_mock_export($1,$2)", [x.id, "00000000-0000-4000-8000-0000000fffff"], /QB_NOT_FOUND/);
  });

  it("can be rolled back and re-applied", async () => {
    await c.reset();
    await c.db.exec(MIG.delivery);
    await c.db.exec(ROLLBACK);
    expect((await c.db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname in ('qb_mock_results','qb_mock_export','qb_mock_assign_class')")).rows[0].n).toBe(0);
    expect((await c.db.query<{ n: number }>("select count(*)::int as n from pg_tables where tablename in ('mock_exam_assignments','mock_exam_enrolments')")).rows[0].n).toBe(2);     // the records are kept
    await c.db.exec(MIG.delivery);
  });
});
