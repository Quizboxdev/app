import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CUR, MIG, OTHER_CUR, TOPIC, U, makeCtx, read, type Ctx } from "./mock-exams-fixture";

// Mock exams, authoring (migration 20261122100000). Isolated PostgreSQL; see mock-exams-fixture.ts for what is real and what is a stand-in.
const ROLLBACK = read("supabase/rollback/mock_exams_authoring.sql");
const { TEACHER, TEACHER2, STUDENT, SPONSOR_OK, SPONSOR_NEW, SPONSOR_IND, OWNER, DORMANT } = U;
let c: Ctx, db: Ctx["db"], as: Ctx["as"], rpc: Ctx["rpc"], fails: Ctx["fails"], exam: Ctx["exam"], round: Ctx["round"], addQuestions: Ctx["addQuestions"], readyExam: Ctx["readyExam"];
const MIGRATION = MIG.authoring;
const flag = (on: boolean) => c.setFlag("flags.mock_exams", on);
beforeAll(async () => { c = await makeCtx("authoring"); ({ db, as, rpc, fails, exam, round, addQuestions, readyExam } = c); });
afterAll(async () => { await c.close(); });

describe("mock exams: flag, access and authors", () => {
  it("is off by default and every function refuses while it is off", async () => {
    await db.exec("reset role");
    expect((await db.query<{ v: any }>("select value as v from public.platform_settings where key = 'flags.mock_exams'")).rows).toHaveLength(1);
    await flag(false);
    await as(TEACHER);
    await fails("select public.qb_mock_exam_list()", [], /QB_FEATURE_DISABLED/);
    await fails("select public.qb_mock_curricula()", [], /QB_FEATURE_DISABLED/);
    expect(await rpc("select public.qb_mock_author_status()")).toMatchObject({ enabled: false, can_author: false, reason: "QB_FEATURE_DISABLED" });
    expect(await rpc("select public.qb_mock_enabled()")).toBe(false);
    await flag(true);
  });
  it("re-applies cleanly and every table is closed to browser roles", async () => {
    await db.exec("reset role"); await db.exec(MIGRATION); await flag(true);
    await as(TEACHER);
    for (const t of ["mock_exams", "mock_exam_rounds", "mock_exam_questions", "mock_exam_versions", "mock_exam_version_questions"]) await fails(`select * from public.${t}`, [], /permission denied/);
    await as(null); await fails("select public.qb_mock_exam_list()", [], /permission denied/);
  });
  it("lets an active teacher, a verified organisation sponsor and staff author, and nobody else", async () => {
    for (const [u, kind] of [[TEACHER, "teacher"], [SPONSOR_OK, "sponsor"], [OWNER, "staff"]] as const) { await as(u); expect(await rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: true, kind }); }
    await as(STUDENT); expect(await rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: false, reason: "QB_MOCK_AUTHOR_FORBIDDEN" });
    await as(SPONSOR_NEW); expect(await rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: false, reason: "QB_MOCK_SPONSOR_NOT_VERIFIED" });
    await as(SPONSOR_IND); expect(await rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: false, reason: "QB_MOCK_SPONSOR_NOT_VERIFIED" });
    await as(DORMANT); expect(await rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: false });
    await as(STUDENT); await fails("select public.qb_mock_exam_create('{}'::jsonb)", [], /QB_MOCK_AUTHOR_FORBIDDEN/);
  });
  it("shows only the curricula of the author's market", async () => {
    await as(TEACHER); const c = await rpc("select public.qb_mock_curricula()");
    expect(c.map((x: any) => x.id)).toEqual([CUR]);
  });
  it("offers only levels in the same stage up to the target year", async () => {
    await as(TEACHER);
    expect(await rpc("select public.qb_mock_grades('B8')")).toEqual(["B7", "B8"]);
    expect(await rpc("select public.qb_mock_grades('B6')")).toEqual(["B1", "B2", "B3", "B4", "B5", "B6"]);
    expect(await rpc("select public.qb_mock_grades('SHS2')")).toEqual(["SHS1", "SHS2"]);
    expect(await rpc("select public.qb_mock_grades('B10')")).toEqual(["SHS1"]);
    expect(await rpc("select public.qb_mock_grades('B9')")).not.toContain("B6");
  });
});

describe("mock exams: building across levels", () => {
  it("validates the exam fields", async () => {
    await as(TEACHER);
    await fails("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "x", curriculum_id: CUR, target_grade: "B8", desired_total: 12 })], /QB_MOCK_INVALID/);
    await fails("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "A proper title", curriculum_id: CUR, target_grade: "B8", desired_total: 2 })], /QB_MOCK_INVALID/);
    await fails("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "A proper title", curriculum_id: CUR, target_grade: "B8", desired_total: 500 })], /QB_MOCK_INVALID/);
    await fails("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "A proper title", curriculum_id: OTHER_CUR, target_grade: "B8", desired_total: 12 })], /QB_MOCK_INVALID/);
    await fails("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "A proper title", curriculum_id: "not-a-uuid", target_grade: "B8", desired_total: 12 })], /QB_MOCK_INVALID/);
    await fails("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "A proper title", curriculum_id: CUR, target_grade: "B8", desired_total: 12, purpose: "fun" })], /QB_MOCK_INVALID/);
  });

  it("allocates rounds across years and subjects with a running tally, then picks only from each round's own topic", async () => {
    const e = await exam(TEACHER);
    expect(e.totals).toEqual({ desired: 12, allocated: 0, selected: 0, remaining_to_allocate: 12, remaining_to_select: 0 });
    const a = await round(e.id, "B7", "MATH", TOPIC.FRAC, 4);
    expect(a.totals).toMatchObject({ allocated: 4, remaining_to_allocate: 8 });
    await round(e.id, "B8", "MATH", TOPIC.ALG, 5);
    const c = await round(e.id, "B8", "SCI", TOPIC.CELLS, 3);
    expect(c.totals).toEqual({ desired: 12, allocated: 12, selected: 0, remaining_to_allocate: 0, remaining_to_select: 12 });
    expect(c.rounds.map((r: any) => [r.grade_code, r.subject_label, r.requested, r.selected, r.available])).toEqual([["B7", "Mathematics", 4, 0, 9], ["B8", "Mathematics", 5, 0, 9], ["B8", "Integrated Science", 3, 0, 6]]);
    for (const r of c.rounds) { const p = await rpc("select public.qb_mock_round_pick($1,$2)", [e.id, r.id]); expect(p.added).toBe(r.requested); }
    const got = await rpc("select public.qb_mock_exam_get($1)", [e.id]);
    expect(got.totals).toEqual({ desired: 12, allocated: 12, selected: 12, remaining_to_allocate: 0, remaining_to_select: 0 });
    expect(got.rounds.map((r: any) => r.selected)).toEqual([4, 5, 3]);
    await db.exec("reset role");
    const stray = await db.query<{ n: number }>(`select count(*)::int as n from public.mock_exam_questions s join public.mock_exam_rounds r on r.id = s.round_id
      left join public.question_topic_links l on l.question_id = s.question_id and l.topic_id = r.topic_id where s.exam_id = $1 and l.question_id is null`, [e.id]);
    expect(stray.rows[0].n).toBe(0);                                              // nothing was taken from another topic or level
    const review = await (async () => { await as(TEACHER); return rpc("select public.qb_mock_exam_review($1)", [e.id]); })();
    expect(review.readiness.ready).toBe(true);
    expect(review.scoring).toMatchObject({ total_marks: 12, answer_types: { SINGLE_CHOICE: 12 } });
    expect(review.questions).toHaveLength(12);
  });

  it("refuses a level above the target, a topic of another level or subject, a reused topic and an over-allocation", async () => {
    const e = await exam(TEACHER);
    await fails("select public.qb_mock_round_save($1,null,'B9','MATH',$2,3)", [e.id, TOPIC.GEO], /QB_MOCK_LEVEL_NOT_ELIGIBLE/);
    await fails("select public.qb_mock_round_save($1,null,'B7','MATH',$2,3)", [e.id, TOPIC.ALG], /QB_MOCK_TOPIC_INVALID/);          // ALG is a B8 topic
    await fails("select public.qb_mock_round_save($1,null,'B8','SCI',$2,3)", [e.id, TOPIC.ALG], /QB_MOCK_TOPIC_INVALID/);          // wrong subject
    await fails("select public.qb_mock_round_save($1,null,'B8','MATH',$2,0)", [e.id, TOPIC.ALG], /QB_MOCK_INVALID/);
    await round(e.id, "B8", "MATH", TOPIC.ALG, 5);
    await fails("select public.qb_mock_round_save($1,null,'B8','MATH',$2,3)", [e.id, TOPIC.ALG], /QB_MOCK_TOPIC_IN_USE/);
    await expect(round(e.id, "B7", "MATH", TOPIC.FRAC, 8)).rejects.toThrow(/QB_MOCK_OVER_ALLOCATED: 5 of 12 questions are already allocated, so at most 7 can be added/);
  });

  it("lets one topic give at most 10 questions to an exam, and an exam hold at most 100", async () => {
    const e = await exam(TEACHER, { desired_total: 40 });
    await expect(round(e.id, "B7", "MATH", TOPIC.FRAC, 11)).rejects.toThrow(/QB_MOCK_TOPIC_CAP: a topic can give at most 10 questions/);
    const ok = await round(e.id, "B7", "MATH", TOPIC.FRAC, 10);
    expect(ok.rounds[0]).toMatchObject({ requested: 10 });
    await as(TEACHER); await fails("select public.qb_mock_round_save($1,$2,'B7','MATH',$3,11)", [e.id, ok.rounds[0].id, TOPIC.FRAC], /QB_MOCK_TOPIC_CAP/);   // editing a round obeys the same cap
    await fails("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "Too big an exam", curriculum_id: CUR, target_grade: "B8", desired_total: 101 })], /QB_MOCK_INVALID/);
    expect(await rpc("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "A full hundred", curriculum_id: CUR, target_grade: "B8", desired_total: 100 })])).toMatchObject({ desired_total: 100 });
  });

  it("never drops questions silently: a short topic raises QB_TOPIC_SHORT, nothing is added, and the shortfall shows", async () => {
    const e = await exam(TEACHER, { desired_total: 5 });
    const r = (await round(e.id, "B8", "MATH", TOPIC.FEW, 5)).rounds[0];
    expect(r).toMatchObject({ requested: 5, selected: 0, available: 2, available_to_add: 2, shortfall: 3 });
    await fails("select public.qb_mock_round_pick($1,$2)", [e.id, r.id], /QB_TOPIC_SHORT/);
    const after = await rpc("select public.qb_mock_exam_get($1)", [e.id]);
    expect(after.totals.selected).toBe(0);
    const review = await rpc("select public.qb_mock_exam_review($1)", [e.id]);
    expect(review.readiness.ready).toBe(false);
    expect(review.readiness.issues.map((i: any) => i.code)).toContain("ROUND_NOT_FILLED");
    await fails("select public.qb_mock_exam_publish($1)", [e.id], /QB_MOCK_NOT_READY/);
    // Recovery 1: lower the count to what exists.
    const fixed = await round(e.id, "B8", "MATH", TOPIC.FEW, 2, r.id);
    expect(fixed.rounds[0]).toMatchObject({ requested: 2, shortfall: 0 });
    expect((await rpc("select public.qb_mock_round_pick($1,$2)", [e.id, r.id])).added).toBe(2);
    // Recovery 2: add another topic for the rest; the exam is then fully allocated and selected.
    await round(e.id, "B8", "MATH", TOPIC.ALG, 3);
    const rounds = (await rpc("select public.qb_mock_exam_get($1)", [e.id])).rounds;
    await rpc("select public.qb_mock_round_pick($1,$2)", [e.id, rounds[1].id]);
    expect((await rpc("select public.qb_mock_exam_review($1)", [e.id])).readiness.ready).toBe(true);
  });

  it("keeps a question out of the exam twice, including a duplicate loaded under another topic", async () => {
    const e = await exam(TEACHER, { desired_total: 6, target_grade: "B9" });
    const dupA = await addQuestions(TOPIC.ALG, 1, "Duplicate pair", { hash: "same-hash-1" });
    const dupB = await addQuestions(TOPIC.GEO, 1, "Duplicate pair", { hash: "same-hash-1" });
    await as(TEACHER);
    const first = (await round(e.id, "B8", "MATH", TOPIC.ALG, 3)).rounds[0];
    // Choose by hand: the duplicate pair's first copy goes in.
    await rpc("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, first.id, [dupA[0]]]);
    const after = (await rpc("select public.qb_mock_exam_get($1)", [e.id])).rounds[0];
    expect(after.selected).toBe(1);
    // Add a Geometry round. Its copy of the duplicate may not be chosen by hand and is not counted as available to add.
    const geo = (await round(e.id, "B9", "MATH", TOPIC.GEO, 3)).rounds[1];
    expect(geo.available).toBe(7);
    expect(geo.available_to_add).toBe(6);
    await fails("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, geo.id, [dupB[0]]], /QB_MOCK_QUESTION_INVALID/);
    const cands = await rpc("select public.qb_mock_round_candidates($1,$2,60,0)", [e.id, geo.id]);
    expect(cands.find((c: any) => c.id === dupB[0])).toMatchObject({ blocked: true });
    // The automatic picker never chooses it either, however many times it runs.
    for (let i = 0; i < 3; i++) { await rpc("select public.qb_mock_round_clear($1,$2)", [e.id, geo.id]); await rpc("select public.qb_mock_round_pick($1,$2)", [e.id, geo.id]); }
    await db.exec("reset role");
    const picked = await db.query<{ question_id: string }>("select question_id from public.mock_exam_questions where exam_id = $1", [e.id]);
    expect(picked.rows.map((r) => r.question_id)).not.toContain(dupB[0]);
    expect(new Set(picked.rows.map((r) => r.question_id)).size).toBe(picked.rows.length);
  });

  it("treats questions in the same duplicate group as one, even when their wording differs", async () => {
    const e = await exam(TEACHER, { desired_total: 6, target_grade: "B9" });
    const gA = await addQuestions(TOPIC.ALG, 1, "Group member one", { dupGroup: "dup-group-9" }), gB = await addQuestions(TOPIC.GEO, 1, "Group member two", { dupGroup: "dup-group-9" });
    await as(TEACHER);
    const r1 = (await round(e.id, "B8", "MATH", TOPIC.ALG, 3)).rounds[0], r2 = (await round(e.id, "B9", "MATH", TOPIC.GEO, 3)).rounds[1];
    await rpc("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, r1.id, [gA[0]]]);
    await fails("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, r2.id, [gB[0]]], /QB_MOCK_QUESTION_INVALID/);
    expect((await rpc("select public.qb_mock_round_candidates($1,$2,60,0)", [e.id, r2.id])).find((c: any) => c.id === gB[0])).toMatchObject({ blocked: true });
    for (let i = 0; i < 3; i++) { await rpc("select public.qb_mock_round_clear($1,$2)", [e.id, r2.id]); await rpc("select public.qb_mock_round_pick($1,$2)", [e.id, r2.id]); }
    expect((await c.q("select 1 from public.mock_exam_questions where exam_id = $1 and question_id = $2", [e.id, gB[0]]))).toEqual([]);
  });

  it("lets the author choose questions by hand, but only eligible ones of the round's topic, once each, and no more than wanted", async () => {
    const e = await exam(TEACHER, { desired_total: 6 });
    const r1 = (await round(e.id, "B7", "MATH", TOPIC.FRAC, 3)).rounds[0];
    const cands = await rpc("select public.qb_mock_round_candidates($1,$2,60,0)", [e.id, r1.id]);
    expect(cands.length).toBeGreaterThanOrEqual(9);
    const ids = cands.slice(0, 3).map((c: any) => c.id);
    await fails("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, r1.id, cands.slice(0, 4).map((c: any) => c.id)], /QB_MOCK_QUESTION_INVALID/);       // more than wanted
    await fails("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, r1.id, [ids[0], ids[0]]], /QB_MOCK_QUESTION_INVALID|duplicate key/);                  // twice
    await db.exec("reset role"); const other = (await db.query<{ question_id: string }>("select question_id from public.question_topic_links where topic_id = $1 limit 1", [TOPIC.ALG])).rows[0].question_id; await as(TEACHER);
    await fails("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, r1.id, [other]], /QB_MOCK_QUESTION_INVALID/);                                          // another topic
    const set = await rpc("select public.qb_mock_round_set_questions($1,$2,$3::uuid[])", [e.id, r1.id, ids]);
    expect(set.rounds[0].selected).toBe(3);
    const marked = await rpc("select public.qb_mock_round_candidates($1,$2,60,0)", [e.id, r1.id]);
    expect(marked.filter((c: any) => c.in_round).map((c: any) => c.id).sort()).toEqual([...ids].sort());
    // A round that wants fewer keeps the first ones chosen; changing topic clears the choice.
    const trimmed = await round(e.id, "B7", "MATH", TOPIC.FRAC, 2, r1.id);
    expect(trimmed.rounds[0].selected).toBe(2);
  });

  it("changes to the exam keep the tally honest", async () => {
    const e = await exam(TEACHER);
    await round(e.id, "B8", "MATH", TOPIC.ALG, 8);
    await fails("select public.qb_mock_exam_update($1,$2::jsonb)", [e.id, JSON.stringify({ desired_total: 6 })], /QB_MOCK_BELOW_ALLOCATED/);
    await fails("select public.qb_mock_exam_update($1,$2::jsonb)", [e.id, JSON.stringify({ target_grade: "B7" })], /QB_MOCK_ROUNDS_INELIGIBLE/);
    await fails("select public.qb_mock_exam_update($1,$2::jsonb)", [e.id, JSON.stringify({ curriculum_id: OTHER_CUR })], /QB_MOCK_CURRICULUM_LOCKED|QB_MOCK_INVALID/);
    const up = await rpc("select public.qb_mock_exam_update($1,$2::jsonb)", [e.id, JSON.stringify({ desired_total: 20, time_limit_minutes: 90, attempts_allowed: 2, shuffle_questions: true })]);
    expect(up).toMatchObject({ desired_total: 20, time_limit_minutes: 90, attempts_allowed: 2, shuffle_questions: true });
    expect(up.totals.remaining_to_allocate).toBe(12);
    const gone = await rpc("select public.qb_mock_round_delete($1,$2)", [e.id, up.rounds[0].id]);
    expect(gone.rounds).toEqual([]);
  });
});

describe("mock exams: ownership, publishing and versions", () => {
  const ready = async (u = TEACHER) => { await as(u); return readyExam(u); };

  it("shows an exam only to its owner", async () => {
    const id1 = await ready();
    await as(TEACHER2);
    expect(await rpc("select public.qb_mock_exam_list()")).toEqual([]);
    for (const sql of ["select public.qb_mock_exam_get($1)", "select public.qb_mock_exam_review($1)", "select public.qb_mock_exam_publish($1)", "select public.qb_mock_exam_archive($1)", "select public.qb_mock_exam_delete($1)"]) await fails(sql, [id1], /QB_NOT_FOUND/);
    await fails("select public.qb_mock_round_save($1,null,'B7','MATH',$2,1)", [id1, TOPIC.FRAC], /QB_NOT_FOUND/);
    await fails("select public.qb_mock_topics($1,'B7','MATH',$2)", [CUR, id1], /QB_NOT_FOUND/);
    await as(OWNER); await fails("select public.qb_mock_exam_get($1)", [id1], /QB_NOT_FOUND/);       // staff authors their own, they do not read other people's drafts here
  });

  it("publishes an immutable version and keeps it readable whatever happens to the live questions", async () => {
    const id1 = await ready(); await as(TEACHER);
    const pub = await rpc("select public.qb_mock_exam_publish($1)", [id1]);
    expect(pub).toMatchObject({ version_no: 1, question_count: 6 });
    expect(pub.exam).toMatchObject({ status: "published", dirty: false, version_count: 1, current_version_no: 1 });
    await fails("select public.qb_mock_exam_publish($1)", [id1], /QB_MOCK_NO_CHANGES/);
    await db.exec("reset role");
    const vq = await db.query<{ question_id: string; question_text: string; subject_code: string; grade_code: string; external_id: string; question_version: number }>(
      "select vq.* from public.mock_exam_version_questions vq join public.mock_exam_versions v on v.id = vq.version_id where v.exam_id = $1 order by position", [id1]);
    expect(vq.rows).toHaveLength(6);
    expect(vq.rows.map((r) => r.grade_code)).toEqual(["B7", "B7", "B7", "B8", "B8", "B8"]);
    expect(vq.rows.every((r) => r.external_id && r.question_version === 1)).toBe(true);            // linked to the source question and its version
    const first = vq.rows[0];
    await db.query("update public.questions set question_text = 'REWRITTEN after publishing', version = 2 where id = $1", [first.question_id]);
    const again = await db.query<{ question_text: string }>("select question_text from public.mock_exam_version_questions where question_id = $1", [first.question_id]);
    expect(again.rows[0].question_text).toBe(first.question_text);                                  // the version still says what was published
    await expect(db.query("update public.mock_exam_versions set title = 'x' where exam_id = $1", [id1])).rejects.toThrow(/QB_MOCK_VERSION_IMMUTABLE/);
    await expect(db.query("delete from public.mock_exam_version_questions where question_id = $1", [first.question_id])).rejects.toThrow(/QB_MOCK_VERSION_IMMUTABLE/);
    await expect(db.query("delete from public.mock_exams where id = $1", [id1])).rejects.toThrow(/foreign key|violates/);
  });

  it("treats an edit after publishing as a draft change and publishes it as the next version without touching the first", async () => {
    const id1 = await ready(); await as(TEACHER);
    await rpc("select public.qb_mock_exam_publish($1)", [id1]);
    const edited = await rpc("select public.qb_mock_exam_update($1,$2::jsonb)", [id1, JSON.stringify({ title: "A new title for version two", time_limit_minutes: 45 })]);
    expect(edited).toMatchObject({ status: "published", dirty: true, current_version_no: 1 });
    const v2 = await rpc("select public.qb_mock_exam_publish($1)", [id1]);
    expect(v2.version_no).toBe(2);
    const got = await rpc("select public.qb_mock_exam_get($1)", [id1]);
    expect(got.versions.map((v: any) => v.version_no)).toEqual([2, 1]);
    await db.exec("reset role");
    const rows = await db.query<{ version_no: number; title: string; time_limit_minutes: number }>("select version_no, title, time_limit_minutes from public.mock_exam_versions where exam_id = $1 order by version_no", [id1]);
    expect(rows.rows[0]).toMatchObject({ version_no: 1, title: "JHS 2 BECE readiness mock", time_limit_minutes: 60 });
    expect(rows.rows[1]).toMatchObject({ version_no: 2, title: "A new title for version two", time_limit_minutes: 45 });
  });

  it("will not publish when a chosen question has since been withdrawn, and says how many", async () => {
    const id1 = await ready(); await db.exec("reset role");
    await db.query("update public.questions set validation_status = 'review' where id = (select question_id from public.mock_exam_questions where exam_id = $1 limit 1)", [id1]);
    await as(TEACHER);
    const review = await rpc("select public.qb_mock_exam_review($1)", [id1]);
    expect(review.readiness.issues).toContainEqual({ code: "QUESTION_UNAVAILABLE", count: 1 });
    await fails("select public.qb_mock_exam_publish($1)", [id1], /QB_MOCK_NOT_READY: QUESTION_UNAVAILABLE/);
  });

  it("archives a published exam, refuses further edits, deletes only a never-published draft, and audits each step", async () => {
    const id1 = await ready(); await as(TEACHER);
    await rpc("select public.qb_mock_exam_publish($1)", [id1]);
    await fails("select public.qb_mock_exam_delete($1)", [id1], /QB_MOCK_NOT_DELETABLE/);
    expect((await rpc("select public.qb_mock_exam_archive($1)", [id1])).status).toBe("archived");
    await fails("select public.qb_mock_round_save($1,null,'B7','MATH',$2,1)", [id1, TOPIC.GEO], /QB_MOCK_ARCHIVED/);
    await fails("select public.qb_mock_exam_update($1,'{}'::jsonb)", [id1], /QB_MOCK_ARCHIVED/);
    await fails("select public.qb_mock_exam_publish($1)", [id1], /QB_MOCK_ARCHIVED/);
    const d = await exam(TEACHER); await as(TEACHER); await rpc("select public.qb_mock_exam_delete($1)", [d.id]);
    await fails("select public.qb_mock_exam_get($1)", [d.id], /QB_NOT_FOUND/);
    await db.exec("reset role");
    const actions = (await db.query<{ action: string }>("select distinct action from public.audit_logs where entity_type = 'mock_exams'")).rows.map((r) => r.action).sort();
    expect(actions).toEqual(["mock_exam.archive", "mock_exam.create", "mock_exam.delete", "mock_exam.publish"]);
  });

  it("lists the exam menu: subjects of a level, then topics with what each can still give", async () => {
    await as(TEACHER);
    expect((await rpc("select public.qb_mock_subjects($1,'B8')", [CUR])).map((s: any) => [s.subject_code, s.label])).toEqual([["SCI", "Integrated Science"], ["MATH", "Mathematics"]].sort((a, b) => a[1].localeCompare(b[1])));
    const topics = await rpc("select public.qb_mock_topics($1,'B8','MATH',null)", [CUR]);
    expect(topics.find((t: any) => t.title === "Thin topic")).toMatchObject({ available: 2, in_exam: false });
    await fails("select public.qb_mock_subjects($1,'X1')", [CUR], /QB_MOCK_INVALID/);
  });

  it("can be rolled back and re-applied", async () => {
    await db.exec("reset role");
    await db.exec(ROLLBACK);
    expect((await db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname like 'qb_mock_%'")).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select count(*)::int as n from pg_tables where tablename like 'mock_exam%'")).rows[0].n).toBe(5);   // the records are kept
    await db.exec(MIGRATION);
    expect((await db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname like 'qb_mock_%'")).rows[0].n).toBeGreaterThan(15);
  });
});
