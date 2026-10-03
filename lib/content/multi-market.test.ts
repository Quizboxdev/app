import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryFixture } from "../competition/fixtures/database";

// Ghana (fixture market) and the fictional, test-only TESTLAND market (XT / TST).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite, ghana: string, testland: string;
const owner = id(2);
const u = { ghStudent: id(41), tlStudent: id(42), ghTeacher: id(43), tlTeacher: id(44), smeGh: id(45), smeBoth: id(46), sponsor: id(47), b7: id(48) };
const q = { gh: randomUUID(), tl: randomUUID(), fixture: randomUUID() };

async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  if (user) await db.exec("set role authenticated");
}
async function rpc<T = unknown>(sql: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ v: T }>(`select ${sql} v`, args)).rows[0].v;
}
const admin = <T = Record<string, unknown>>(action: string, data: Record<string, unknown> = {}) => rpc<T>("public.qb_market_admin($1,$2::jsonb)", [action, JSON.stringify(data)]);
const allowed = async (user: string, question: string) => { await as(user); return rpc<boolean>("quizbox_market.question_allowed($1)", [question]); };

const TL_CONFIG = { education_levels: [{ code: "TL-PRI", label: "Primary" }], grades: [{ code: "TL7", label: "Year 7", level: "TL-PRI" }], subjects: [{ code: "TL-MATH", label: "Mathematics" }], grade_policy: { self_practice: "STRICT_GRADE" } };
const GH_CONFIG = { education_levels: [{ code: "JHS", label: "JHS" }, { code: "SHS", label: "SHS" }], grades: [{ code: "B7", label: "Basic 7", level: "JHS" }, { code: "SHS1", label: "SHS 1", level: "SHS" }], subjects: [{ code: "Science", label: "Science" }], grade_policy: { self_practice: "STRICT_GRADE" } };

describe("multi-country platform over the isolated governance SQL", () => {
  beforeAll(async () => {
    ({ db, market: ghana } = await createDeliveryFixture());
    await db.exec("reset role");
    await db.query("update markets set configuration=$2::jsonb where id=$1", [ghana, JSON.stringify(GH_CONFIG)]);
    await db.query("insert into auth.users(id,email,email_confirmed_at) select x,'mm-'||x||'@example.test',now() from unnest($1::uuid[]) x", [Object.values(u)]);
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("creates a test market in DRAFT and reports exact readiness blockers", async () => {
    await as(owner);
    const m = await admin<{ id: string; status: string; readiness: { blockers: string[] } }>("save_market", { country_code: "XT", country_iso3: "TST", country_name: "Testland", name: "Testland", currency_code: "TSD", currency_name: "Testland dollar", timezone: "UTC", locale: "en-XT", is_test: true, configuration: TL_CONFIG });
    testland = m.id;
    expect(m.status).toBe("DRAFT");
    expect(m.readiness.blockers).toEqual(expect.arrayContaining(["CURRICULUM_AUTHORITY_MISSING", "ACTIVE_CURRICULUM_MISSING", "APPROVED_SOURCE_MISSING", "MARKET_ADMIN_MISSING"]));
    expect(m.readiness.blockers).not.toContain("GRADES_MISSING");
  });

  it("refuses activation until minimum configuration is satisfied, then activates", async () => {
    await as(owner);
    await admin("set_status", { market_id: testland, status: "CONFIGURING" });
    expect(await admin("set_status", { market_id: testland, status: "READY" })).toMatchObject({ changed: false, blockers: expect.arrayContaining(["CURRICULUM_AUTHORITY_MISSING"]) });
    await expect(admin("set_status", { market_id: testland, status: "ACTIVE" })).rejects.toThrow("INVALID_MARKET_TRANSITION");
    const authority = await rpc<{ id: string }>("public.qb_market_configure('curriculum_authorities',$1::jsonb)", [JSON.stringify({ market_id: testland, code: "TLEA", name: "Testland Education Authority", active: true })]);
    const cur = await admin<{ id: string }>("save_curriculum", { market_id: testland, authority_id: authority.id, code: "TL-CORE", name: "Testland Core", version: "2026", effective_from: "2026-01-01", source_name: "Testland Education Authority syllabus 2026 (fictional)", source_hash: "b".repeat(64) });
    expect((await admin<{ blockers: string[] }>("readiness", { market_id: testland })).blockers).toContain("ACTIVE_CURRICULUM_MISSING");
    await rpc("public.qb_market_configure('market_curricula',$1::jsonb)", [JSON.stringify({ curriculum_id: cur.id, market_id: testland, authority_id: authority.id, active: true })]);
    await db.exec("reset role");
    const node = randomUUID();
    await db.query("insert into curriculum_nodes(id,curriculum_id,education_level,is_active,source_grade_code,canonical_grade_code,subject_code,grade_code) values($1,$2,'TL-PRI',true,'TL7','TL7','TL-MATH','TL7')", [node, cur.id]);
    await db.query("insert into source_documents(id,title,checksum,rights_confirmed,market_id,curriculum_id,authority_id,source_kind,validation_status,approved_by,content_text) values($1,'Testland syllabus',repeat('a',64),true,$2,$3,$4,'CURRICULUM','approved',$5,'Fictional Testland Year 7 mathematics syllabus.')", [randomUUID(), testland, cur.id, authority.id, owner]);
    await db.query("insert into user_market_memberships(user_id,market_id,active) values($1,$2,true)", [owner, testland]);
    await db.exec("alter table questions disable trigger user");
    for (const [qid, n, g, src] of [[q.tl, node, "TL7", "MANUAL"], [q.fixture, null, "SHS1", "DEV_ACCEPTANCE_FIXTURE"]] as const)
      await db.query(`insert into questions(id,subject_code,subject_name,grade,canonical_grade_code,question_text,option_a,option_b,option_c,option_d,correct_answer,curriculum_node_id,validation_status,source_type)
        values($1,'X','X','B7',$3,'Q','A','B','C','D','A',$2,'approved',$4)`, [qid, n, g, src]);
    const ghAuthority = (await db.query<{ id: string }>("select id from curriculum_authorities where market_id=$1 limit 1", [ghana])).rows[0].id;
    const ghCurriculum = randomUUID(), ghNode = randomUUID();
    await db.query("insert into curricula(id,code,country,market_id) values($1,'GH-TEST-CCP','Ghana',$2)", [ghCurriculum, ghana]);
    await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [ghCurriculum, ghana, ghAuthority]);
    await db.query("insert into curriculum_nodes(id,curriculum_id,education_level,is_active,source_grade_code,canonical_grade_code,subject_code,grade_code) values($1,$2,'SHS',true,'B10','SHS1','Science','B10')", [ghNode, ghCurriculum]);
    await db.query(`insert into questions(id,subject_code,subject_name,grade,canonical_grade_code,question_text,option_a,option_b,option_c,option_d,correct_answer,curriculum_node_id,validation_status,source_type)
      values($1,'Science','Science','B10','SHS1','Q','A','B','C','D','A',$2,'approved','MANUAL')`, [q.gh, ghNode]);
    await db.exec("alter table questions enable trigger user; select quizbox_market.attribute_legacy_by_node();");
    await as(owner);
    expect(await admin("set_status", { market_id: testland, status: "READY" })).toMatchObject({ changed: true });
    expect(await admin("set_status", { market_id: testland, status: "ACTIVE" })).toMatchObject({ changed: true, status: "ACTIVE" });
  });

  it("hides test markets from signup unless explicitly enabled, and onboards country-first", async () => {
    await as(null);
    const list = await rpc<Array<{ country_code: string; available: boolean }>>("public.qb_signup_markets()");
    expect(list.find(x => x.country_code === "GH")?.available).toBe(true);
    expect(list.some(x => x.country_code === "XT")).toBe(false);
    await as(u.tlStudent);
    await expect(rpc("public.qb_complete_onboarding($1::jsonb)", [JSON.stringify({ country_code: "XT", role: "student", grade_code: "TL7" })])).rejects.toThrow("QB_COUNTRY_NOT_AVAILABLE");
    await db.exec("reset role"); await db.query("insert into feature_flags(feature_code,enabled) values('TEST_MARKETS_VISIBLE',true)");
    const onboard = (user: string, data: Record<string, unknown>) => as(user).then(() => rpc("public.qb_complete_onboarding($1::jsonb)", [JSON.stringify(data)]));
    expect(await onboard(u.tlStudent, { country_code: "XT", role: "student", grade_code: "TL7", full_name: "Tia Lander" })).toMatchObject({ role: "student", market: "Testland" });
    await onboard(u.ghStudent, { country_code: "GH", role: "student", grade_code: "SHS1", full_name: "Kofi Mensah" });
    await onboard(u.b7, { country_code: "GH", role: "student", grade_code: "B7", full_name: "Ama B" });
    await onboard(u.ghTeacher, { country_code: "GH", role: "teacher", subjects: ["Science"], grade_codes: ["SHS1"], school_name: "Accra Academy" });
    await expect(onboard(u.tlTeacher, { country_code: "XT", role: "teacher", subjects: ["TL-MATH"], grade_codes: ["TL7"] })).rejects.toThrow("QB_SCHOOL_REQUIRED");
    await onboard(u.tlTeacher, { country_code: "XT", role: "teacher", subjects: ["TL-MATH"], grade_codes: ["TL7"], school_name: "Testland Central" });
    await onboard(u.smeGh, { country_code: "GH", role: "teacher", apply_sme: true, subjects: ["Science"], qualifications: "BSc", school_name: "Kumasi High" });
    expect(await onboard(u.sponsor, { country_code: "GH", role: "sponsor", organization_name: "Acme", contact_email: "a@example.test" })).toMatchObject({ role: "sponsor", sponsor_id: expect.any(String) });
    await expect(onboard(u.tlStudent, { country_code: "GH", role: "student", grade_code: "SHS1" })).rejects.toThrow("ONBOARDING_ALREADY_COMPLETE");
    await expect(onboard(u.smeBoth, { country_code: "XT", role: "student", grade_code: "SHS1" })).rejects.toThrow("QB_GRADE_REQUIRED");
    await db.exec("reset role");
    const sme = (await db.query<{ reviewer_status: string; active: boolean }>("select reviewer_status,active from sme_profiles where user_id=$1", [u.smeGh])).rows[0];
    expect(sme).toEqual({ reviewer_status: "pending", active: false });
  });

  it("keeps national curricula isolated for students and teachers", async () => {
    expect(await allowed(u.ghStudent, q.gh)).toBe(true);
    expect(await allowed(u.ghStudent, q.tl)).toBe(false);
    expect(await allowed(u.tlStudent, q.tl)).toBe(true);
    expect(await allowed(u.tlStudent, q.gh)).toBe(false);
    expect(await allowed(u.ghTeacher, q.tl)).toBe(false);
    expect(await allowed(u.tlTeacher, q.tl)).toBe(true);
    expect(await allowed(u.tlTeacher, q.gh)).toBe(false);
  });

  it("denies cross-market switching unless the user holds that market, and keeps the primary market", async () => {
    await as(u.ghTeacher); await expect(rpc("public.qb_select_content_market($1)", [testland])).rejects.toThrow("QB_CONTENT_MARKET_DENIED");
    await db.exec("reset role"); await db.query("insert into profiles(id,role,status,full_name,default_market_id,primary_market_id,onboarding_completed_at) values($1,'teacher','active','Both Markets',$2,$2,now())", [u.smeBoth, ghana]);
    await db.query("insert into user_market_memberships(user_id,market_id,active) values($1,$2,true),($1,$3,true)", [u.smeBoth, ghana, testland]);
    expect(await allowed(u.smeBoth, q.tl)).toBe(false);
    await as(u.smeBoth); await rpc("public.qb_select_content_market($1)", [testland]);
    expect(await allowed(u.smeBoth, q.tl)).toBe(true);
    expect(await allowed(u.smeBoth, q.gh)).toBe(false);
    await as(u.smeBoth); const account = await rpc<{ primary_market: { name: string }; active_market: { name: string }; authorized_markets: unknown[] }>("public.qb_my_account()");
    expect(account).toMatchObject({ primary_market: { name: "Ghana" }, active_market: { name: "Testland" } }); expect(account.authorized_markets).toHaveLength(2);
  });

  it("requires a curriculum source in every market for multi-market curriculum-aligned contexts", async () => {
    await as(owner); await db.exec("reset role");
    const tlSource = (await db.query<{ id: string }>("select id from source_documents where market_id=$1", [testland])).rows[0].id;
    await as(owner);
    await expect(rpc("public.qb_create_content_context('MULTI_MARKET','CURRICULUM_ALIGNED',$1::uuid[],$2::uuid[])", [[ghana, testland], [tlSource]])).rejects.toThrow("QB_MARKET_CURRICULUM_SOURCE_REQUIRED");
  });

  it("hides release fixtures from non-acceptance users", async () => {
    await db.exec("reset role"); await db.query("insert into legacy_content_attributions(question_id,curriculum_id,market_id,reason) select $1,mc.curriculum_id,$2,'test' from market_curricula mc where mc.market_id=$2 and mc.authority_id is not null limit 1", [q.fixture, ghana]);
    await db.exec("set session_replication_role=replica; update questions set curriculum_id=(select curriculum_id from legacy_content_attributions where question_id=questions.id) where source_type='DEV_ACCEPTANCE_FIXTURE'; set session_replication_role=origin;");
    expect(await allowed(u.ghStudent, q.fixture)).toBe(false);
  });

  it("applies STRICT_GRADE to self-practice, allows an audited teacher override, and OPEN_LEVEL only when configured", async () => {
    await db.exec("reset role");
    const assessment = randomUUID(), practice = randomUUID(), cls = randomUUID(), membership = randomUUID(), assignment = randomUUID();
    await db.exec("set session_replication_role=replica"); // seed rows only; checks below run with all triggers
    for (const a of [assessment, practice]) {
      await db.query("insert into assessments(id,owner_role,owner_user_id,subject_code,subject_name,grade,question_count) values($1,'teacher',$2,'Science','Science','B10',1)", [a, u.ghTeacher]);
      await db.query("insert into assessment_questions(assessment_id,question_id,question_order) values($1,$2,1)", [a, q.gh]);
    }
    await db.query("insert into classes(id,curriculum_id,teacher_user_id) values($1,null,$2)", [cls, u.ghTeacher]);
    await db.query("insert into class_memberships(id,class_id,student_user_id,status) values($1,$2,$3,'active')", [membership, cls, u.b7]);
    await db.query("insert into assignments(id,class_id,assessment_id,status,teacher_user_id) values($1,$2,$3,'published',$4)", [assignment, cls, assessment, u.ghTeacher]);
    await db.query("insert into assignment_targets(assignment_id,student_user_id,membership_id,status) values($1,$2,$3,'active')", [assignment, u.b7, membership]);
    await db.exec("set session_replication_role=origin");
    // Internal predicate (not API-executable): evaluate with the student's identity as the database owner.
    const check = async (user: string, a: string) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); return rpc<boolean>("quizbox_market.assessment_allowed($1)", [a]); };
    const can = (a: string) => check(u.b7, a);
    expect(await can(practice)).toBe(false);
    expect(await can(assessment)).toBe(false);
    expect(await check(u.ghStudent, practice)).toBe(true);
    await as(u.tlTeacher); await expect(rpc("public.qb_set_assignment_grade_override($1,$2)", [assignment, "Extension work"])).rejects.toThrow("QB_ASSIGNMENT_ACCESS_DENIED");
    await as(u.ghTeacher); await expect(rpc("public.qb_set_assignment_grade_override($1,$2)", [assignment, ""])).rejects.toThrow("QB_OVERRIDE_REASON_REQUIRED");
    await rpc("public.qb_set_assignment_grade_override($1,$2)", [assignment, "Stretch work for a strong B7 learner"]);
    expect(await can(assessment)).toBe(true);
    expect(await can(practice)).toBe(false);
    await db.exec("reset role"); expect((await db.query("select 1 from audit_logs where action='QB_ASSIGNMENT_GRADE_OVERRIDE' and entity_id=$1", [assignment])).rows).toHaveLength(1);
    await db.query("update markets set configuration=jsonb_set(configuration,'{grade_policy,self_practice}','\"OPEN_LEVEL\"') where id=$1", [ghana]);
    expect(await can(practice)).toBe(true);
    await db.exec("reset role"); await db.query("update markets set configuration=jsonb_set(configuration,'{grade_policy,self_practice}','\"STRICT_GRADE\"') where id=$1", [ghana]);
  });

  it("changes a student's primary market only through an approved request", async () => {
    await as(u.ghStudent);
    const req = await rpc<{ id: string }>("public.qb_request_market_change($1,$2)", [testland, "Family relocated"]);
    await expect(rpc("public.qb_request_market_change($1,$2)", [testland, "again"])).rejects.toThrow();
    await expect(admin("change_requests")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(owner); expect(await admin<unknown[]>("change_requests")).toEqual(expect.arrayContaining([expect.objectContaining({ id: req.id, status: "PENDING" })]));
    await admin("decide_change", { request_id: req.id, decision: "APPROVED" });
    await as(u.ghStudent); const account = await rpc<{ primary_market: { name: string }; authorized_markets: unknown[] }>("public.qb_my_account()");
    expect(account.primary_market.name).toBe("Testland"); expect(account.authorized_markets).toHaveLength(1);
  });

  it("stores market grade codes and derives the legacy enum only for its own values", async () => {
    await db.exec("reset role"); const a = randomUUID(), b = randomUUID();
    const guards = (await db.query<{ t: string }>("select tgname t from pg_trigger where tgrelid='classes'::regclass and not tgisinternal and tgname<>'class_grade_code'")).rows.map(r => r.t);
    for (const t of guards) await db.exec(`alter table classes disable trigger "${t}"`); // isolate the grade-code trigger under test
    await db.query("insert into classes(id,curriculum_id,grade_code) values($1,null,'TL7'),($2,null,'B7')", [a, b]);
    for (const t of guards) await db.exec(`alter table classes enable trigger "${t}"`);
    const rows = (await db.query<{ id: string; grade: string | null; grade_code: string }>("select id,grade::text grade,grade_code from classes where id=any($1::uuid[])", [[a, b]])).rows;
    expect(rows.find(r => r.id === a)).toMatchObject({ grade: null, grade_code: "TL7" });
    expect(rows.find(r => r.id === b)).toMatchObject({ grade: "B7", grade_code: "B7" });
  });
  it("resolves grade aliases from market configuration", async () => {
    await db.exec("reset role");
    await db.query("update markets set configuration=jsonb_set(configuration,'{grades}',(configuration->'grades')||'[{\"code\":\"Y7\",\"label\":\"Year 7\",\"canonical\":\"B7\"}]'::jsonb) where id=$1", [ghana]);
    await db.query("update student_profiles set grade_code='Y7' where user_id=$1", [u.b7]);
    expect((await db.query<{ g: string }>("select quizbox_market.student_grade_code($1) g", [u.b7])).rows[0].g).toBe("B7");
  });
  it("attributes new governed content continuously, without touching the question row", async () => {
    await db.exec("reset role; select set_config('request.jwt.claim.sub','',false); alter table questions disable trigger qb_question_editorial_guard");
    const qid = randomUUID(); const node = (await db.query<{ id: string; c: string }>("select n.id,n.curriculum_id c from curriculum_nodes n join curricula c on c.id=n.curriculum_id where c.code='TL-CORE' limit 1")).rows[0];
    await db.query("insert into questions(id,subject_code,subject_name,canonical_grade_code,question_text,option_a,option_b,option_c,option_d,correct_answer,curriculum_id,curriculum_node_id,validation_status) values($1,'TL-MATH','Mathematics','TL7','New','A','B','C','D','A',$2,$3,'approved')", [qid, node.c, node.id]);
    await db.exec("alter table questions enable trigger qb_question_editorial_guard");
    expect((await db.query("select 1 from legacy_content_attributions where question_id=$1 and market_id=$2", [qid, testland])).rows).toHaveLength(1);
    expect(await allowed(u.tlTeacher, qid)).toBe(true); expect(await allowed(u.ghTeacher, qid)).toBe(false);
  });
  it("serves the platform dashboard to Super Admin only", async () => {
    await as(u.ghTeacher); await expect(admin("dashboard")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(owner); const d = await admin<{ markets: Array<{ market: string; students: number; is_test: boolean }> }>("dashboard");
    expect(d.markets.find(m => m.market === "Testland")).toMatchObject({ is_test: true, students: 2 });
  });
});
