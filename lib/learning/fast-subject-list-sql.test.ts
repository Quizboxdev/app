import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const QUICK = read("../../supabase/migrations/20261012200000_quick_practice.sql");
const STAFF = read("../../supabase/migrations/20261012210000_practice_for_staff.sql");
const ACCESS = read("../../supabase/migrations/20261018100000_access_gate_standalone.sql");
const LABELS = read("../../supabase/migrations/20261018110000_readable_topic_labels.sql");
const STUDY = read("../../supabase/migrations/20261019140000_study_mode.sql");
const FAST = read("../../supabase/migrations/20261053100000_fast_subject_list.sql");
const ROLLBACK = read("../../supabase/rollback/fast_subject_list.sql");
const LEGACY = read("../../supabase/migrations/20261054100000_practice_legacy_grade.sql");
const LEGACY_ROLLBACK = read("../../supabase/rollback/practice_legacy_grade.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number) => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const calls = async () => Number((await one("select count(*) n from public.avail_calls")).n);
const reset = () => db.exec("truncate public.avail_calls");
const TOPIC = id(302), BIG = id(305), SHS = id(331);
const pick = (count: number, topic = BIG) => one("select public.qb_start_quick_practice(array[$1]::uuid[], $2, null) v", [topic, count]);

// The full availability check is replaced by a stand-in that counts its calls and refuses the questions listed in public.bad_questions.
// B4 Computing: topic "Slides" holds 12 questions, topic "Pool" holds 400. Learner 1 is B4.
describe("subject list and practice builders no longer run the full check on every question (isolated PostgreSQL)", () => {
  let menuBefore: unknown;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema quizbox_sme; create schema quizbox_market;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select false $$;
      create function quizbox_market.is_super() returns boolean language sql stable as $$ select false $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create type public.qb_grade as enum ('B7','B8','B9');
      create type public.qb_role as enum ('student','teacher','admin','sponsor');
      create table public.profiles(id uuid primary key, default_market_id uuid, role text);
      create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique, grade text, grade_code text);
      create table public.curriculum_nodes(id uuid primary key, curriculum_id uuid, parent_id uuid, node_type text, title text, subject_code text, grade_code text,
        canonical_grade_code text, sort_order integer default 0, is_active boolean default true);
      create table public.market_curricula(curriculum_id uuid primary key, market_id uuid, active boolean default true);
      create table public.questions(id uuid primary key default gen_random_uuid(), version integer default 1, curriculum_node_id uuid, status text default 'active',
        validation_status text default 'approved', source_type text, tenant_id uuid, question_text text, option_a text, option_b text, option_c text, option_d text,
        correct_answer text, marks integer default 1, question_content jsonb, answer_type text default 'SINGLE_CHOICE', answer_spec jsonb, difficulty_label text);
      create table public.avail_calls(n bigserial primary key);
      create table public.bad_questions(id uuid primary key);
      create function public.qb_question_is_available(q public.questions) returns boolean language plpgsql volatile as $$
        begin insert into public.avail_calls default values; return (q.tenant_id is null or q.tenant_id = public.qb_public_tenant_id()) and not exists (select 1 from public.bad_questions b where b.id = q.id); end $$;
      create function public.qb_public_tenant_id() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
      create function public.qb_is_tenant_member(t uuid) returns boolean language sql as $$ select false $$;
      create function public.qb_is_platform_admin() returns boolean language sql as $$ select false $$;
      create table public.assessments(id uuid primary key default gen_random_uuid(), assessment_type text, owner_role public.qb_role, owner_user_id uuid, subject_code text,
        subject_name text, grade public.qb_grade, grade_code text, question_count integer, difficulty text, time_limit_minutes integer, max_attempts integer,
        allow_resume boolean, auto_submit boolean, pass_percent numeric, expires_at timestamptz, instructions text, tenant_id uuid, reference_type text);
      create table public.assessment_questions(assessment_id uuid, question_id uuid, question_order integer, question_text_snapshot text, option_a_snapshot text,
        option_b_snapshot text, option_c_snapshot text, option_d_snapshot text, correct_answer_snapshot text, marks_snapshot integer, question_content_snapshot jsonb,
        answer_type_snapshot text, answer_spec_snapshot jsonb);
      create table public.attempts(id uuid primary key default gen_random_uuid(), student_user_id uuid);
      create table public.responses(id uuid primary key default gen_random_uuid(), attempt_id uuid, question_id uuid, is_correct boolean);
      insert into public.profiles values('${id(1)}','${id(100)}','STUDENT'),('${id(2)}','${id(100)}','STUDENT'),('${id(5)}','${id(100)}','STUDENT'),('${id(6)}','${id(100)}','STUDENT');
      insert into public.student_profiles(user_id,grade,grade_code) values('${id(1)}','B4','B4'),('${id(2)}','B7','B7'),('${id(5)}','B10','B10'),('${id(6)}','SHS1','SHS1');
      insert into public.market_curricula values('${id(200)}','${id(100)}',true);
      insert into public.curriculum_nodes(id,curriculum_id,parent_id,node_type,title,subject_code,grade_code,canonical_grade_code,sort_order) values
        ('${id(300)}','${id(200)}',null,'subject','Computing','Computing','B4','B4',0),
        ('${TOPIC}','${id(200)}','${id(300)}','sub_strand','Slides',null,null,null,0),
        ('${id(304)}','${id(200)}','${TOPIC}','learning_indicator','Add a slide',null,null,null,0),
        ('${BIG}','${id(200)}','${id(300)}','sub_strand','Pool',null,null,null,1),
        ('${id(306)}','${id(200)}','${BIG}','learning_indicator','Many questions',null,null,null,0),
        ('${id(330)}','${id(200)}',null,'subject','Mathematics','Mathematics','B10','SHS1',0),
        ('${SHS}','${id(200)}','${id(330)}','sub_strand','Algebra',null,null,null,0),
        ('${id(332)}','${id(200)}','${SHS}','learning_indicator','Solve equations',null,null,null,0);
      insert into public.questions(curriculum_node_id, question_text, option_a, option_b, correct_answer, difficulty_label)
        select '${id(304)}', d || ' ' || g, 'A', 'B', 'A', d from unnest(array['hard','easy','medium']) d, generate_series(1,4) g;
      insert into public.questions(curriculum_node_id, question_text, option_a, option_b, correct_answer, difficulty_label) select '${id(332)}', 'shs ' || g, 'A', 'B', 'A', 'easy' from generate_series(1,20) g;
      insert into public.questions(curriculum_node_id, question_text, option_a, option_b, correct_answer, difficulty_label) select '${id(306)}', 'pool ' || g, 'A', 'B', 'A', 'easy' from generate_series(1,400) g;
      -- not servable, so no version of the menu may count them: archived, in review, and one owned by a tenant the learner does not belong to
      insert into public.questions(curriculum_node_id, question_text, status) values ('${id(306)}', 'archived', 'archived');
      insert into public.questions(curriculum_node_id, question_text, validation_status) values ('${id(306)}', 'in review', 'review');
      insert into public.questions(curriculum_node_id, question_text, tenant_id) values ('${id(306)}', 'other tenant', '${id(901)}');
    `);
    await db.exec(QUICK); await db.exec(STAFF);
    await db.exec(ACCESS.slice(ACCESS.indexOf("create table if not exists public.qb_access_settings"), ACCESS.indexOf("create or replace function public.qb_start_quick_practice")));
    await db.exec(LABELS); await db.exec(STUDY);
    await db.exec("grant select on all tables in schema public to authenticated");
    await as(1);
    menuBefore = (await one("select public.qb_practice_menu() v")).v;      // what the learner was shown before the change
    await db.exec(FAST);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("shows the learner the same subjects, topics and counts, without running the full check on any question", async () => {
    await as(1); await reset();
    const menu = (await one("select public.qb_practice_menu() v")).v;
    expect(await calls()).toBe(0);
    expect(menu).toEqual(menuBefore);
    expect(menu.subjects[0].available).toBe(412);                              // 12 + 400; the archived, in-review and other-tenant questions are not counted
  });

  it("counts topic progress without the full check", async () => {
    await as(1); await reset();
    expect((await one("select public.qb_topic_progress($1::uuid[]) v", [[TOPIC, BIG]])).v).toEqual(
      [{ topic_id: TOPIC, total: 12, answered: 0, correct: 0 }, { topic_id: BIG, total: 400, answered: 0, correct: 0 }].sort((a, b) => a.topic_id.localeCompare(b.topic_id)));
    expect(await calls()).toBe(0);
  });

  it("builds a practice set from a 400-question topic by checking only a few more questions than the set needs", async () => {
    await as(1); await reset();
    const s = (await pick(10)).v;
    expect(s).toMatchObject({ subject: "Computing", question_count: 10, requested: 10, short: false });
    expect(await calls()).toBeLessThanOrEqual(10 * 3 + 10);
    expect((await one("select count(distinct question_id)::int n from public.assessment_questions where assessment_id = $1", [s.assessment_id])).n).toBe(10);
  });

  it("never gives the learner a question the full check refuses, and fills the set from the other candidates", async () => {
    await as(1);
    await db.exec(`insert into public.bad_questions select id from public.questions where curriculum_node_id = '${id(306)}' and question_text like 'pool %' and right(question_text, 1) in ('1','2')`);   // about 20% refused
    for (let i = 0; i < 3; i++) {
      const s = (await pick(10)).v;
      expect(s.question_count).toBe(10);
      const bad = (await one("select count(*)::int n from public.assessment_questions aq join public.bad_questions b on b.id = aq.question_id where aq.assessment_id = $1", [s.assessment_id])).n;
      expect(bad).toBe(0);
    }
  });

  it("refuses with the usual message when none of the candidates passes the full check", async () => {
    await as(1);
    await db.exec(`insert into public.bad_questions select id from public.questions where curriculum_node_id = '${id(306)}' on conflict do nothing`);
    await expect(pick(10)).rejects.toThrow("QB_PRACTICE_NO_QUESTIONS");
  });

  it("keeps study sessions in learning order and checks only the candidates", async () => {
    await as(1); await reset();
    const s = (await one("select public.qb_start_study_session($1, 12) v", [TOPIC])).v;
    expect(s).toMatchObject({ question_count: 12, new_questions: 12, short: false });
    expect(await calls()).toBeLessThanOrEqual(12 * 3 + 10);
    const d = (await db.query<{ d: string }>(`select q.difficulty_label d from public.assessment_questions aq join public.questions q on q.id = aq.question_id where aq.assessment_id = $1 order by aq.question_order`, [s.assessment_id])).rows.map((r) => r.d);
    expect(d).toEqual([...Array(4).fill("easy"), ...Array(4).fill("medium"), ...Array(4).fill("hard")]);
  });

  it("keeps the learner to their own grade", async () => {
    await as(2);
    await expect(pick(5)).rejects.toThrow("QB_PRACTICE_NO_QUESTIONS");
  });

  it("a learner stored with the legacy code B10 saw nothing; after the alias they see what an SHS1 learner sees and can build a practice", async () => {
    await as(5);
    expect(((await one("select public.qb_practice_menu() v")).v).subjects).toEqual([]);
    await db.exec(LEGACY);
    await as(5); const legacy = (await one("select public.qb_practice_menu() v")).v;
    await as(6); const shs = (await one("select public.qb_practice_menu() v")).v;
    expect(legacy.subjects.map((x: any) => [x.name, x.available])).toEqual([["Mathematics", 20]]);
    expect(legacy).toEqual({ ...shs, grade: "SHS1" });
    await as(5);
    expect((await pick(5, SHS)).v).toMatchObject({ subject: "Mathematics", question_count: 5, short: false });
    expect((await one("select public.qb_start_study_session($1, 5) v", [SHS])).v).toMatchObject({ subject: "Mathematics", question_count: 5 });
    await as(1);
    expect((await one("select public.qb_practice_menu() v")).v).toEqual(menuBefore);   // other learners are unaffected
  });

  it("rolls the alias back to the previous functions", async () => {
    await db.exec(LEGACY_ROLLBACK);
    await as(5);
    expect(((await one("select public.qb_practice_menu() v")).v).subjects).toEqual([]);
    await as(6);
    expect(((await one("select public.qb_practice_menu() v")).v).subjects).toHaveLength(1);
  });

  it("rolls back to the full check on every question, and removes the helper", async () => {
    await db.exec(ROLLBACK);
    expect((await one("select to_regprocedure('public.qb_question_is_listable(public.questions)') f")).f).toBeNull();
    await as(1); await reset();
    await db.exec("truncate public.bad_questions");
    expect(((await one("select public.qb_practice_menu() v")).v).subjects[0].available).toBe(412);
    expect(await calls()).toBeGreaterThanOrEqual(412);
  });
});
