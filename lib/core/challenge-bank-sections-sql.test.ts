import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Challenge and competition content from the bank across subjects and topics (isolated PostgreSQL; the Challenges migrations, learner limits and this one applied in order).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CHAIN = ["20261021100000_challenges_foundation", "20261022100000_challenges_extensions", "20261023100000_challenges_moderation", "20261027100000_competitions_and_sharing", "20261029100000_quiz_studio", "20261034100000_student_academic_limits"].map((n) => read(`../../supabase/migrations/${n}.sql`));
const FAST = read("../../supabase/migrations/20261053100000_fast_subject_list.sql");
const BLUEPRINT = read("../../supabase/migrations/20261055100000_assessment_blueprint.sql");
const MIGRATION = read("../../supabase/migrations/20261059100000_challenge_bank_sections.sql");
const LEVELS = read("../../supabase/migrations/20261060100000_challenge_bank_levels_with_questions.sql");
const ROLLBACK = read("../../supabase/rollback/challenge_bank_sections.sql");
const LEVELS_ROLLBACK = read("../../supabase/rollback/challenge_bank_levels_with_questions.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, LEARNER, SPONSOR, YOUNG] = [1, 2, 3, 4, 5];
let db: PGlite;
const as = async (n: number) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
  await db.exec("set role authenticated");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
// Reads for the assertions run as the table owner, then the signed-in role is put back.
const asOwner = async <T>(work: () => Promise<T>) => { await db.exec("reset role"); try { return await work(); } finally { await db.exec("set role authenticated"); } };
const calls = () => asOwner(async () => Number(await rpc("select count(*) from public.avail_calls")));
const resetCalls = () => asOwner(() => db.exec("truncate public.avail_calls"));
const create = (title: string, fmt = "CHALLENGE") => rpc("select public.challenge_create($1,'x','general_knowledge','PUBLIC',3,300,1,null,null,null,null,$2)", [title, fmt]);
const qsOf = (campaign: string) => asOwner(async () => (await db.query<{ position: number; question_text: string; source_question_id: string; stage_no: number }>("select position, question_text, source_question_id, stage_no from public.challenge_questions where campaign_id = $1 order by position", [campaign])).rows);

// Primary (B4): Computing and Science. JHS (B7): Mathematics. Senior High (SHS1): Mathematics and Physics.
const SUBJECTS = [
  { base: 300, name: "Computing", grade: "B4", topics: [["Slides", 30], ["Fonts", 30]] },
  { base: 320, name: "Science", grade: "B4", topics: [["Plants", 30], ["Rocks", 3]] },
  { base: 340, name: "Mathematics", grade: "B7", topics: [["Fractions", 20]] },
  { base: 380, name: "Mathematics", grade: "SHS1", topics: [["Algebra", 20]] },
  { base: 400, name: "Physics", grade: "SHS1", topics: [["Motion", 20]] },
] as const;
const S = (base: number) => id(base);
const T = (base: number, i: number) => id(base + 1 + i * 2);
const sec = (subject: number, quota: number, topics?: number[]) => ({ subject: S(subject), quota, ...(topics ? { topic_ids: topics.map((i) => T(subject, i)) } : {}) });
const pull = (campaign: string, sections: unknown[], grade: string | null = "B4", stage = 1) => rpc("select public.challenge_pull_bank_sections($1,$2::jsonb,$3,$4)", [campaign, JSON.stringify(sections), grade, stage]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema quizbox_topic;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public, quizbox_topic to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text, default_market_id uuid);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid, grade text, grade_code text);
    create table public.user_capabilities(user_id uuid not null, capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin')), active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.curriculum_nodes(id uuid primary key, curriculum_id uuid, parent_id uuid, node_type text, title text, subject_code text, grade_code text, canonical_grade_code text, sort_order integer default 0, is_active boolean default true);
    create table public.market_curricula(curriculum_id uuid primary key, market_id uuid, active boolean default true);
    create table public.questions(id uuid primary key default gen_random_uuid(), curriculum_node_id uuid, subject_code text, grade text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text,
      status text default 'active', validation_status text default 'approved', source_type text, tenant_id uuid, answer_type text default 'SINGLE_CHOICE');
    create table public.avail_calls(n bigserial primary key);
    create table public.bad_questions(id uuid primary key);
    create function public.qb_question_is_available(q public.questions) returns boolean language plpgsql volatile as $$
      begin insert into public.avail_calls default values; return (q.tenant_id is null) and not exists (select 1 from public.bad_questions b where b.id = q.id); end $$;
    create function public.qb_public_tenant_id() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
    create function public.qb_is_tenant_member(t uuid) returns boolean language sql as $$ select false $$;
    create function public.qb_is_platform_admin() returns boolean language sql as $$ select false $$;
    create function public.qb_topic_label(n uuid) returns text language sql stable as $$ select title from public.curriculum_nodes where id = n $$;
    create function public.qb_label_is_code(t text) returns boolean language sql immutable as $$ select false $$;
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text not null, type text not null, title text not null, message text not null,
      entity_type text, entity_id uuid, created_at timestamptz not null default now(), read_at timestamptz, market_id uuid, link text, category text not null default 'system');
    create table public.institutions(id uuid primary key, name text);
    create table public.institution_memberships(institution_id uuid, user_id uuid, role text, status text);
    create table public.classes(id uuid primary key, class_name text, status text default 'active', teacher_user_id uuid, institution_id uuid);
    create table public.class_memberships(class_id uuid, student_user_id uuid, status text default 'active');
    create table public.assessments(id uuid primary key default gen_random_uuid(), owner_user_id uuid, reference_type text);
    create table public.qb_access_settings(key text primary key, value jsonb not null);
    create table public.learner_subscriptions(user_id uuid, status text default 'active', valid_from timestamptz default now(), valid_until timestamptz);
    create function public.qb_access_free_limit() returns integer language sql stable as $$ select null::integer $$;
    create function public.qb_has_subscription(p_user uuid) returns boolean language sql stable as $$ select false $$;
    insert into public.profiles values ('${id(OWNER)}','OWNER','active','Owner','o@example.com','${id(100)}'),('${id(TEACHER)}','TEACHER','active','Teacher','t@example.com','${id(100)}'),
      ('${id(LEARNER)}','STUDENT','active','Kofi','k@example.com','${id(100)}'),('${id(SPONSOR)}','SPONSOR','active','Sponsor','s@example.com','${id(100)}'),('${id(YOUNG)}','STUDENT','active','Ama','a@example.com','${id(100)}');
    insert into public.student_profiles(user_id, managed_by, grade, grade_code) values ('${id(LEARNER)}', null, 'B4', 'B4'), ('${id(YOUNG)}', '${id(OWNER)}', 'B4', 'B4');
    insert into public.market_curricula values ('${id(200)}','${id(100)}',true);
  `);
  for (const { base, name, grade, topics } of SUBJECTS) {
    await db.exec(`insert into public.curriculum_nodes(id, curriculum_id, node_type, title, subject_code, grade_code, canonical_grade_code) values ('${S(base)}','${id(200)}','subject','${name}','${name}','${grade}','${grade}')`);
    for (let i = 0; i < topics.length; i++) {
      const [title, count] = topics[i];
      await db.exec(`
        insert into public.curriculum_nodes(id, curriculum_id, parent_id, node_type, title) values ('${T(base, i)}','${id(200)}','${S(base)}','sub_strand','${title}'), ('${id(base + 2 + i * 2)}','${id(200)}','${T(base, i)}','learning_indicator','${title} indicator');
        insert into public.questions(curriculum_node_id, question_text, option_a, option_b, option_c, option_d, correct_answer, explanation) select '${id(base + 2 + i * 2)}', '${name} ${title} ' || g, 'A', 'B', 'C', 'D', 'A', 'because' from generate_series(1, ${count}) g;`);
    }
  }
  // Computing / Slides also holds questions that must never reach a challenge: not approved, a development question, and one with only two options.
  await db.exec(`
    insert into public.questions(curriculum_node_id, question_text, option_a, option_b, option_c, option_d, correct_answer, validation_status) select '${id(302)}', 'Computing Slides unapproved ' || g, 'A', 'B', 'C', 'D', 'A', 'draft' from generate_series(1, 3) g;
    insert into public.questions(curriculum_node_id, question_text, option_a, option_b, option_c, option_d, correct_answer, source_type) select '${id(302)}', 'Computing Slides dev ' || g, 'A', 'B', 'C', 'D', 'A', 'DEV_SEED' from generate_series(1, 2) g;
    insert into public.questions(curriculum_node_id, question_text, option_a, option_b, correct_answer) select '${id(302)}', 'Computing Slides two options ' || g, 'A', 'B', 'A' from generate_series(1, 2) g;
    -- the older subject-code pull: five good questions and some that must be left out
    insert into public.questions(subject_code, grade, question_text, option_a, option_b, option_c, option_d, correct_answer) select 'MATH', 'B5', 'Code pull good ' || g, 'A', 'B', 'C', 'D', 'A' from generate_series(1, 5) g;
    insert into public.questions(subject_code, grade, question_text, option_a, option_b, option_c, option_d, correct_answer, validation_status) select 'MATH', 'B5', 'Code pull unapproved ' || g, 'A', 'B', 'C', 'D', 'A', 'draft' from generate_series(1, 3) g;
    insert into public.questions(subject_code, grade, question_text, option_a, option_b, option_c, option_d, correct_answer, source_type) select 'MATH', 'B5', 'Code pull dev ' || g, 'A', 'B', 'C', 'D', 'A', 'DEV_SEED' from generate_series(1, 2) g;`);
  // the helper functions this migration relies on, taken verbatim from the migrations that introduced them
  await db.exec(FAST.slice(FAST.indexOf("create or replace function public.qb_question_is_listable"), FAST.indexOf("revoke all on function public.qb_question_is_listable")));
  await db.exec(BLUEPRINT.slice(BLUEPRINT.indexOf("create or replace function quizbox_topic.class_level"), BLUEPRINT.indexOf("-- Questions of a topic by plain column checks")));
  for (const sql of CHAIN) await db.exec(sql);
  await db.exec(MIGRATION);
  await db.exec(LEVELS);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("what a creator can pick from", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); await db.exec(LEVELS); await db.exec(LEVELS); });

  it("a teacher or sponsor chooses a grade; the list counts only usable questions", async () => {
    await as(TEACHER);
    expect((await rpc("select public.qb_challenge_bank_menu()")).grades).toEqual(["B4", "B7", "SHS1"]);
    const menu = await rpc("select public.qb_challenge_bank_menu('B4')");
    expect(menu.grade).toBe("B4");
    expect(menu.subjects.map((s: any) => [s.name, s.available])).toEqual([["Computing", 60], ["Science", 33]]);   // unapproved, development and two-option questions are not counted
    expect(menu.subjects[0].topics.map((t: any) => [t.title, t.available])).toEqual([["Fonts", 30], ["Slides", 30]]);
    await as(SPONSOR);
    expect((await rpc("select public.qb_challenge_bank_menu('SHS1')")).subjects.map((s: any) => s.name)).toEqual(["Mathematics", "Physics"]);
  });

  it("only class levels that have usable questions are offered, and the choice goes back when rolled back", async () => {
    await asOwner(() => db.exec(`insert into public.curriculum_nodes(id, curriculum_id, node_type, title, subject_code, grade_code, canonical_grade_code) values ('${id(990)}','${id(200)}','subject','Art','ART','B9','B9')`));   // a level whose subject has no questions at all
    await as(TEACHER);
    expect((await rpc("select public.qb_challenge_bank_menu()")).grades).toEqual(["B4", "B7", "SHS1"]);
    await asOwner(() => db.exec(LEVELS_ROLLBACK));
    expect((await rpc("select public.qb_challenge_bank_menu()")).grades).toEqual(["B4", "B7", "B9", "SHS1"]);
    await asOwner(async () => { await db.exec(LEVELS); await db.exec(`delete from public.curriculum_nodes where id = '${id(990)}'`); });
    expect((await rpc("select public.qb_challenge_bank_menu()")).grades).toEqual(["B4", "B7", "SHS1"]);
  });

  it("a learner sees their own grade whatever the screen asks for; a young learner managed by an adult is refused", async () => {
    await as(LEARNER);
    expect((await rpc("select public.qb_challenge_bank_menu('SHS1')")).grade).toBe("B4");
    await as(YOUNG);
    await fails("select public.qb_challenge_bank_menu('B4')", [], /NOT_AUTHORIZED/);
  });
});

describe("copying questions from several subjects into a draft", () => {
  it("takes each subject's quota, spreads them over topics, keeps only usable questions and checks few candidates", async () => {
    await as(TEACHER);
    const c = await create("Mixed paper");
    await resetCalls();
    const r = await pull(c.id, [sec(300, 6), sec(320, 4, [0])]);
    expect(r).toMatchObject({ ok: true, added: 10, total: 10, requested: 10 });
    expect(r.sections).toEqual([{ subject: "Computing", requested: 6, given: 6 }, { subject: "Science", requested: 4, given: 4 }]);
    const qs = await qsOf(c.id);
    expect(qs.map((q) => q.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(qs.filter((q) => q.question_text.startsWith("Computing"))).toHaveLength(6);
    expect(qs.filter((q) => q.question_text.startsWith("Science Plants"))).toHaveLength(4);
    expect(qs.every((q) => !/unapproved|dev|two options/.test(q.question_text) && q.source_question_id)).toBe(true);
    expect(await calls()).toBeLessThanOrEqual(50);                       // 93 usable questions in these subjects
    const row = await asOwner(() => rpc("select options from public.challenge_questions where campaign_id = $1 limit 1", [c.id]));
    expect(row).toEqual(["A", "B", "C", "D"]);
  });

  it("a second pull adds different questions and never repeats one", async () => {
    await as(TEACHER);
    const c = await create("Two pulls");
    expect((await pull(c.id, [sec(300, 30)])).added).toBe(30);
    expect((await pull(c.id, [sec(300, 30)])).added).toBe(30);
    const qs = await qsOf(c.id);
    expect(qs).toHaveLength(60);
    expect(new Set(qs.map((q) => q.source_question_id)).size).toBe(60);
    expect((await pull(c.id, [sec(300, 5)])).added).toBe(0);              // Computing has no usable question left
  });

  it("a subject with fewer questions than asked gives what it has, and says so", async () => {
    await as(TEACHER);
    const c = await create("Thin topic");
    const r = await pull(c.id, [sec(320, 5, [1]), sec(300, 2)]);
    expect(r.sections).toEqual([{ subject: "Science", requested: 5, given: 3 }, { subject: "Computing", requested: 2, given: 2 }]);
    expect(r).toMatchObject({ added: 5, requested: 7 });
  });

  it("puts the questions in the round asked for", async () => {
    await as(TEACHER);
    const c = await create("Rounds", "COMPETITION");
    await rpc("select public.challenge_set_stages($1,$2)", [c.id, JSON.stringify([{ stage_no: 1, title: "One", question_count: 3, time_limit_seconds: 300, pass_percent: 50 }, { stage_no: 2, title: "Two", question_count: 3, time_limit_seconds: 300, pass_percent: 50 }])]);
    await pull(c.id, [sec(300, 3)], "B4", 2);
    expect((await qsOf(c.id)).map((q) => q.stage_no)).toEqual([2, 2, 2]);
    await fails("select public.challenge_pull_bank_sections($1,$2::jsonb,'B4',3)", [c.id, JSON.stringify([sec(300, 3)])], /INVALID_QUESTIONS/);
  });

  it("several subjects are for Primary and JHS only; one subject works at every level", async () => {
    await as(TEACHER);
    const c = await create("Senior");
    await fails("select public.challenge_pull_bank_sections($1,$2::jsonb,'SHS1',1)", [c.id, JSON.stringify([sec(380, 3), sec(400, 3)])], /BANK_COMBINED_LEVEL_NOT_ALLOWED/);
    expect((await pull(c.id, [sec(400, 3)], "SHS1")).added).toBe(3);
    expect((await pull(c.id, [sec(340, 2)], "B7")).added).toBe(2);        // a competition can take questions from another grade by pulling again
  });

  it("refuses a bad request in plain codes", async () => {
    await as(TEACHER);
    const c = await create("Bad requests");
    const call = (s: unknown, g: string | null = "B4") => pull(c.id, s as unknown[], g);
    await expect(call([])).rejects.toThrow(/BANK_PICK_INVALID/);
    await expect(call([sec(300, 3), sec(300, 3)])).rejects.toThrow(/BANK_PICK_INVALID/);          // the same subject twice
    await expect(call([sec(300, 60), sec(320, 41)])).rejects.toThrow(/BANK_PICK_INVALID/);        // more than 100 in all
    await expect(call([{ subject: S(300), quota: 0 }])).rejects.toThrow(/BANK_PICK_INVALID/);
    await expect(call([sec(340, 3)])).rejects.toThrow(/BANK_SUBJECT_UNAVAILABLE/);                // a JHS subject for a Primary grade
    await expect(call([sec(300, 3)], null)).rejects.toThrow(/BANK_GRADE_REQUIRED/);
    expect(await qsOf(c.id)).toHaveLength(0);
  });

  it("only the owner can add to a draft, and not after it goes live", async () => {
    await as(TEACHER);
    const c = await create("Mine");
    await as(SPONSOR);
    await expect(pull(c.id, [sec(300, 3)])).rejects.toThrow(/NOT_AUTHORIZED/);
    await as(TEACHER);
    await pull(c.id, [sec(300, 3)]);
    await rpc("select public.challenge_publish($1)", [c.id]);
    await expect(pull(c.id, [sec(300, 3)])).rejects.toThrow(/ONLY_DRAFT_EDITABLE/);
  });

  it("a learner builds a quiz from their own grade, several subjects allowed at Primary, and the bank-only rule still holds", async () => {
    await as(LEARNER);
    const c = await create("Quiz for friends");
    const r = await pull(c.id, [sec(300, 3), sec(320, 3)], "SHS1");       // the grade asked for is ignored
    expect(r).toMatchObject({ added: 6 });
    expect((await qsOf(c.id)).every((q) => q.source_question_id)).toBe(true);
    await expect(pull(c.id, [sec(400, 3)], "SHS1")).rejects.toThrow(/BANK_SUBJECT_UNAVAILABLE/);
  });
});

describe("the older pull by subject code", () => {
  it("copies approved questions only and never a development one", async () => {
    await as(TEACHER);
    const c = await create("By code");
    await resetCalls();
    const r = await rpc("select public.challenge_pull_bank($1,'MATH','B5',10)", [c.id]);
    expect(r).toMatchObject({ added: 5, total: 5 });
    expect((await qsOf(c.id)).every((q) => q.question_text.startsWith("Code pull good"))).toBe(true);
    expect(await calls()).toBeLessThanOrEqual(5 * 3 + 10);
  });
});

describe("rollback", () => {
  it("removes the picker and brings back the old pull, then the migration applies again", async () => {
    await db.exec("reset role");
    await db.exec(ROLLBACK);
    await as(TEACHER);
    await expect(rpc("select public.qb_challenge_bank_menu('B4')")).rejects.toThrow(/does not exist/);
    const c = await create("After rollback");
    expect((await rpc("select public.challenge_pull_bank($1,'MATH','B5',20)", [c.id])).added).toBe(10);   // the old rule: every question marked active
    await db.exec("reset role");
    await db.exec(MIGRATION);
    await as(TEACHER);
    expect((await rpc("select public.qb_challenge_bank_menu('B4')")).grade).toBe("B4");
  });
});
