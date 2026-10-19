import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const QUICK = read("../../supabase/migrations/20261012200000_quick_practice.sql");
const STAFF = read("../../supabase/migrations/20261012210000_practice_for_staff.sql");
const ACCESS = read("../../supabase/migrations/20261018100000_access_gate_standalone.sql");
const STUDY = read("../../supabase/migrations/20261019140000_study_mode.sql");
const ROLLBACK = read("../../supabase/rollback/study_mode.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const TOPIC = id(302), OTHER = id(312);
const study = (count = 6, topic = TOPIC) => one("select public.qb_start_study_session($1, $2) v", [topic, count]);
const order = async (assessment: string) => (await db.query<{ t: string; d: string }>(`select aq.question_text_snapshot t, q.difficulty_label d from public.assessment_questions aq join public.questions q on q.id = aq.question_id
  where aq.assessment_id = $1 order by aq.question_order`, [assessment])).rows;

// B4 Computing topic "Slides" holds 12 approved questions (4 easy, 4 medium, 4 hard); "Fonts" holds 3. Learner 1 is B4, learner 2 is B7, 3 is a teacher.
describe("topic study mode (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema quizbox_sme; create schema quizbox_market;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select position(p in coalesce(current_setting('test.caps',true),'')) > 0 $$;
      create function quizbox_market.is_super() returns boolean language sql stable as $$ select quizbox_sme.has_capability('super_admin') $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create type public.qb_grade as enum ('B7','B8','B9');
      create type public.qb_role as enum ('student','teacher','admin','sponsor');
      create table public.profiles(id uuid primary key, default_market_id uuid, role text);
      create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique, grade text, grade_code text);
      create table public.curriculum_nodes(id uuid primary key, curriculum_id uuid, parent_id uuid, node_type text, title text, subject_code text, grade_code text,
        canonical_grade_code text, sort_order integer default 0, is_active boolean default true);
      create table public.market_curricula(curriculum_id uuid primary key, market_id uuid, active boolean default true);
      create table public.questions(id uuid primary key default gen_random_uuid(), version integer default 1, curriculum_node_id uuid, status text default 'active',
        validation_status text default 'approved', source_type text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text,
        marks integer default 1, question_content jsonb, answer_type text default 'SINGLE_CHOICE', answer_spec jsonb, difficulty_label text);
      create function public.qb_question_is_available(q public.questions) returns boolean language sql as $$ select true $$;
      create function public.qb_public_tenant_id() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
      create table public.assessments(id uuid primary key default gen_random_uuid(), assessment_type text, owner_role public.qb_role, owner_user_id uuid, subject_code text,
        subject_name text, grade public.qb_grade, grade_code text, question_count integer, difficulty text, time_limit_minutes integer, max_attempts integer,
        allow_resume boolean, auto_submit boolean, pass_percent numeric, expires_at timestamptz, instructions text, tenant_id uuid, reference_type text);
      create table public.assessment_questions(assessment_id uuid, question_id uuid, question_order integer, question_text_snapshot text, option_a_snapshot text,
        option_b_snapshot text, option_c_snapshot text, option_d_snapshot text, correct_answer_snapshot text, marks_snapshot integer, question_content_snapshot jsonb,
        answer_type_snapshot text, answer_spec_snapshot jsonb);
      create table public.attempts(id uuid primary key default gen_random_uuid(), student_user_id uuid);
      create table public.responses(id uuid primary key default gen_random_uuid(), attempt_id uuid, question_id uuid, is_correct boolean);
      insert into public.profiles values('${id(1)}','${id(100)}','STUDENT'),('${id(2)}','${id(100)}','STUDENT'),('${id(3)}','${id(100)}','TEACHER');
      insert into public.student_profiles(user_id,grade,grade_code) values('${id(1)}','B4','B4'),('${id(2)}','B7','B7');
      insert into public.market_curricula values('${id(200)}','${id(100)}',true);
      insert into public.curriculum_nodes(id,curriculum_id,parent_id,node_type,title,subject_code,grade_code,canonical_grade_code,sort_order) values
        ('${id(300)}','${id(200)}',null,'subject','Computing','Computing','B4','B4',0),
        ('${TOPIC}','${id(200)}','${id(300)}','sub_strand','Slides',null,null,null,0),
        ('${id(303)}','${id(200)}','${TOPIC}','content_standard','Use slides',null,null,null,0),
        ('${id(304)}','${id(200)}','${id(303)}','learning_indicator','Add a slide',null,null,null,0),
        ('${id(305)}','${id(200)}','${id(300)}','sub_strand','Fonts',null,null,null,1),
        ('${id(306)}','${id(200)}','${id(305)}','learning_indicator','Bold text',null,null,null,0),
        ('${id(310)}','${id(200)}',null,'subject','Mathematics','Mathematics','B7','B7',0),
        ('${OTHER}','${id(200)}','${id(310)}','sub_strand','Fractions',null,null,null,0),
        ('${id(313)}','${id(200)}','${OTHER}','learning_indicator','Add fractions',null,null,null,0);
      insert into public.questions(curriculum_node_id, question_text, option_a, option_b, correct_answer, difficulty_label)
        select '${id(304)}', d || ' question ' || g, 'A', 'B', 'A', d from unnest(array['hard','easy','medium']) d, generate_series(1,4) g;     -- inserted out of order on purpose
      insert into public.questions(curriculum_node_id, question_text, option_a, option_b, correct_answer, difficulty_label) select '${id(306)}', 'font ' || g, 'A', 'B', 'A', 'easy' from generate_series(1,3) g;
      insert into public.questions(curriculum_node_id, question_text, option_a, option_b, correct_answer, difficulty_label) select '${id(313)}', 'fraction ' || g, 'A', 'B', 'A', 'easy' from generate_series(1,5) g;
    `);
    await db.exec(QUICK); await db.exec(STAFF);
    await db.exec(ACCESS.slice(ACCESS.indexOf("create table if not exists public.qb_access_settings"), ACCESS.indexOf("create or replace function public.qb_start_quick_practice")));
    await db.exec(STUDY);
    await db.exec("grant select on all tables in schema public to authenticated");
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("builds an ordered session: easy first, then medium, then hard", async () => {
    await as(1);
    const s = (await study(12)).v;
    expect(s).toMatchObject({ subject: "Computing", question_count: 12, short: false, new_questions: 12 });
    const rows = await order(s.assessment_id);
    expect(rows.map((r) => r.d)).toEqual([...Array(4).fill("easy"), ...Array(4).fill("medium"), ...Array(4).fill("hard")]);
    expect(await one("select assessment_type, reference_type, grade_code, instructions like 'Study session%' as study from public.assessments where id = $1", [s.assessment_id])).toEqual({ assessment_type: "PRACTICE", reference_type: "SELF_PRACTICE", grade_code: "B4", study: true });
  });

  it("reports progress per topic from the learner's own answers only", async () => {
    await as(1);
    const none = (await one("select public.qb_topic_progress($1::uuid[]) v", [[TOPIC]])).v;
    expect(none).toEqual([{ topic_id: TOPIC, total: 12, answered: 0, correct: 0 }]);
    // learner 1 answers 5 questions (3 right, 2 wrong); learner 2's answers must not count for learner 1
    await db.exec(`insert into public.attempts(id, student_user_id) values ('${id(700)}','${id(1)}'), ('${id(701)}','${id(2)}')`);
    await db.exec(`insert into public.responses(attempt_id, question_id, is_correct) select '${id(700)}', q.id, (row_number() over (order by q.question_text)) <= 3
                     from (select id, question_text from public.questions where curriculum_node_id = '${id(304)}' order by question_text limit 5) q`);
    await db.exec(`insert into public.responses(attempt_id, question_id, is_correct) select '${id(701)}', id, true from public.questions where curriculum_node_id = '${id(304)}'`);
    expect((await one("select public.qb_topic_progress($1::uuid[]) v", [[TOPIC, id(305)]])).v).toEqual([
      { topic_id: TOPIC, total: 12, answered: 5, correct: 3 }, { topic_id: id(305), total: 3, answered: 0, correct: 0 }].sort((a, b) => a.topic_id.localeCompare(b.topic_id)));
  });

  it("puts questions the learner has not seen first, then wrong ones, then right ones", async () => {
    await as(1);
    const s = (await study(7)).v;                                         // 7 unseen questions exist (12 - 5 answered): all 7 must be unseen
    expect(s.new_questions).toBe(7);
    const seen = (await db.query<{ n: number }>(`select count(*)::int n from public.assessment_questions aq join public.responses r on r.question_id = aq.question_id and r.attempt_id = '${id(700)}' where aq.assessment_id = $1`, [s.assessment_id])).rows[0].n;
    expect(seen).toBe(0);
    const more = (await study(10)).v;                                      // 10 asked: 7 unseen + the 3 wrong ones before any correct one
    const picked = (await db.query<{ ok: boolean | null }>(`select r.is_correct ok from public.assessment_questions aq left join public.responses r on r.question_id = aq.question_id and r.attempt_id = '${id(700)}' where aq.assessment_id = $1`, [more.assessment_id])).rows;
    expect(picked.filter((p) => p.ok === null)).toHaveLength(7);
    expect(picked.filter((p) => p.ok === false)).toHaveLength(2);          // the learner got 2 wrong: they come next
    expect(picked.filter((p) => p.ok === true)).toHaveLength(1);
  });

  it("keeps the learner to their own grade and one topic, and says so when a topic is small", async () => {
    await as(1);
    await expect(study(5, OTHER)).rejects.toThrow("QB_PRACTICE_NO_QUESTIONS");                       // a B7 topic is not available to a B4 learner
    await expect(one("select public.qb_start_study_session($1, 2) v", [TOPIC])).rejects.toThrow("QB_PRACTICE_COUNT_INVALID");
    expect((await study(10, id(305))).v).toMatchObject({ question_count: 3, requested: 10, short: true });
    await as(2);
    expect((await study(5, OTHER)).v).toMatchObject({ subject: "Mathematics", question_count: 5 });
  });

  it("applies the free allowance, and lets a teacher build a session for a grade they choose", async () => {
    await as(9, "super_admin");
    await db.exec(`insert into public.profiles values('${id(9)}','${id(100)}','ADMIN') on conflict do nothing`);
    await one("select public.qb_admin_set_free_allowance(1) v");
    await as(1);
    await expect(study(5)).rejects.toThrow("QB_FREE_ALLOWANCE_EXHAUSTED");
    await as(3);
    await expect(one("select public.qb_start_study_session($1, 5) v", [TOPIC])).rejects.toThrow("QB_PRACTICE_GRADE_REQUIRED");
    expect((await one("select public.qb_start_study_session($1, 5, 'B4') v", [TOPIC])).v.question_count).toBe(5);
  });

  it("rolls back cleanly", async () => {
    await db.exec(ROLLBACK);
    expect((await one("select to_regprocedure('public.qb_start_study_session(uuid,integer,text)') f")).f).toBeNull();
  });
});
