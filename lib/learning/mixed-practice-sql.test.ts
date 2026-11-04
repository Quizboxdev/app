import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const FAST = read("../../supabase/migrations/20261053100000_fast_subject_list.sql");
const BLUEPRINT = read("../../supabase/migrations/20261055100000_assessment_blueprint.sql");
const MIGRATION = read("../../supabase/migrations/20261057100000_mixed_practice.sql");
const ROLLBACK = read("../../supabase/rollback/mixed_practice.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number, exhausted = false) => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false), set_config('test.exhausted','${exhausted ? "on" : "off"}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const calls = async () => Number((await one("select count(*) n from public.avail_calls")).n);
const reset = () => db.exec("truncate public.avail_calls");

// Learners: 1 is B4 (Primary), 2 is B7 (JHS), 5 is stored as the legacy B10 (SHS 1), 6 as SHS1.
const L_PRIMARY = 1, L_JHS = 2, L_LEGACY = 5, L_SHS = 6;
const SUBJECTS = [
  { base: 300, name: "Computing", grade: "B4", topics: [["Slides", 30], ["Fonts", 30]] },
  { base: 320, name: "Science", grade: "B4", topics: [["Plants", 30], ["Rocks", 3]] },
  { base: 340, name: "Mathematics", grade: "B7", topics: [["Fractions", 20]] },
  { base: 360, name: "English", grade: "B7", topics: [["Reading", 20]] },
  { base: 380, name: "Mathematics", grade: "SHS1", topics: [["Algebra", 20]] },
  { base: 400, name: "Physics", grade: "SHS1", topics: [["Motion", 20]] },
] as const;
const S = (base: number) => id(base);                    // a subject's node id
const T = (base: number, i: number) => id(base + 1 + i * 2);   // its i-th topic (sub-strand) id
const sec = (subject: number, quota: number, topics?: number[]) => ({ subject: S(subject), quota, ...(topics ? { topic_ids: topics.map((i) => T(subject, i)) } : {}) });
const mix = (sections: unknown[], order = "MIXED") => one("select public.qb_start_mixed_practice($1::jsonb, null, $2) v", [JSON.stringify(sections), order]).then((r) => r.v);
const questionsOf = async (assessment: string) => (await db.query<{ t: string; o: number }>("select question_text_snapshot t, question_order o from public.assessment_questions where assessment_id = $1 order by question_order", [assessment])).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema quizbox_topic;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create type public.qb_grade as enum ('B7','B8','B9');
    create type public.qb_role as enum ('student','teacher','admin','sponsor');
    create table public.profiles(id uuid primary key, default_market_id uuid, role text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique, grade text, grade_code text);
    create table public.curriculum_nodes(id uuid primary key, curriculum_id uuid, parent_id uuid, node_type text, title text, subject_code text, grade_code text, canonical_grade_code text, sort_order integer default 0, is_active boolean default true);
    create table public.market_curricula(curriculum_id uuid primary key, market_id uuid, active boolean default true);
    create table public.questions(id uuid primary key default gen_random_uuid(), version integer default 1, curriculum_node_id uuid, status text default 'active', validation_status text default 'approved',
      source_type text, tenant_id uuid, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, marks integer default 1, question_content jsonb, answer_type text default 'SINGLE_CHOICE', answer_spec jsonb);
    create table public.avail_calls(n bigserial primary key);
    create table public.bad_questions(id uuid primary key);
    create function public.qb_question_is_available(q public.questions) returns boolean language plpgsql volatile as $$
      begin insert into public.avail_calls default values; return (q.tenant_id is null) and not exists (select 1 from public.bad_questions b where b.id = q.id); end $$;
    create function public.qb_public_tenant_id() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
    create function public.qb_is_tenant_member(t uuid) returns boolean language sql as $$ select false $$;
    create function public.qb_is_platform_admin() returns boolean language sql as $$ select false $$;
    create function public.qb_free_allowance_exhausted(u uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.exhausted', true), 'off') = 'on' $$;
    create table public.assessments(id uuid primary key default gen_random_uuid(), assessment_type text, owner_role public.qb_role, owner_user_id uuid, subject_code text, subject_name text, grade public.qb_grade,
      grade_code text, question_count integer, difficulty text, time_limit_minutes integer, max_attempts integer, allow_resume boolean, auto_submit boolean, pass_percent numeric, expires_at timestamptz, instructions text, tenant_id uuid, reference_type text);
    create table public.assessment_questions(assessment_id uuid, question_id uuid, question_order integer, question_text_snapshot text, option_a_snapshot text, option_b_snapshot text, option_c_snapshot text,
      option_d_snapshot text, correct_answer_snapshot text, marks_snapshot integer, question_content_snapshot jsonb, answer_type_snapshot text, answer_spec_snapshot jsonb);
    insert into public.profiles values ${[L_PRIMARY, L_JHS, L_LEGACY, L_SHS].map((n) => `('${id(n)}','${id(100)}','STUDENT')`).join(",")};
    insert into public.student_profiles(user_id, grade, grade_code) values ('${id(L_PRIMARY)}','B4','B4'),('${id(L_JHS)}','B7','B7'),('${id(L_LEGACY)}','B10','B10'),('${id(L_SHS)}','SHS1','SHS1');
    insert into public.market_curricula values ('${id(200)}','${id(100)}',true);
  `);
  for (const { base, name, grade, topics } of SUBJECTS) {
    await db.exec(`insert into public.curriculum_nodes(id, curriculum_id, node_type, title, subject_code, grade_code, canonical_grade_code) values ('${S(base)}','${id(200)}','subject','${name}','${name}','${grade}','${grade}')`);
    for (let i = 0; i < topics.length; i++) {
      const [title, count] = topics[i];
      await db.exec(`
        insert into public.curriculum_nodes(id, curriculum_id, parent_id, node_type, title) values ('${T(base, i)}','${id(200)}','${S(base)}','sub_strand','${title}'), ('${id(base + 2 + i * 2)}','${id(200)}','${T(base, i)}','learning_indicator','${title} indicator');
        insert into public.questions(curriculum_node_id, question_text, option_a, option_b, correct_answer) select '${id(base + 2 + i * 2)}', '${name} ${title} ' || g, 'A', 'B', 'A' from generate_series(1, ${count}) g;`);
    }
  }
  // the helper functions this migration relies on, taken verbatim from the migrations that introduced them
  await db.exec(FAST.slice(FAST.indexOf("create or replace function public.qb_question_is_listable"), FAST.indexOf("revoke all on function public.qb_question_is_listable")));
  await db.exec(BLUEPRINT.slice(BLUEPRINT.indexOf("create or replace function quizbox_topic.class_level"), BLUEPRINT.indexOf("-- Questions of a topic by plain column checks")));
  await db.exec(MIGRATION);
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("practice across several subjects", () => {
  it("builds one set from two subjects with their own quotas, checking only a few candidates", async () => {
    await as(L_PRIMARY); await reset();
    const r = await mix([sec(300, 6), sec(320, 4, [0])]);
    expect(r).toMatchObject({ subject: "Mixed practice", question_count: 10, requested: 10, short: false });
    expect(r.sections).toEqual([{ subject: "Computing", requested: 6, given: 6 }, { subject: "Science", requested: 4, given: 4 }]);
    const qs = await questionsOf(r.assessment_id);
    expect(qs.filter((q) => q.t.startsWith("Computing"))).toHaveLength(6);
    expect(qs.filter((q) => q.t.startsWith("Science Plants"))).toHaveLength(4);
    expect(new Set(qs.map((q) => q.t)).size).toBe(10);
    expect(await calls()).toBeLessThanOrEqual(50);                              // 93 questions are in these subjects
    expect(await one("select subject_code, subject_name, question_count, reference_type from public.assessments where id = $1", [r.assessment_id])).toEqual(
      { subject_code: "MIXED", subject_name: "Mixed practice", question_count: 10, reference_type: "SELF_PRACTICE" });
  });

  it("spreads a subject's questions across its topics, and keeps to the topics the learner named", async () => {
    await as(L_PRIMARY);
    const both = await questionsOf((await mix([sec(300, 10)])).assessment_id);
    expect(both.filter((q) => q.t.includes("Slides"))).toHaveLength(5);          // one from each topic before a second from any
    expect(both.filter((q) => q.t.includes("Fonts"))).toHaveLength(5);
    const named = await questionsOf((await mix([sec(300, 8, [1])])).assessment_id);
    expect(named.every((q) => q.t.includes("Fonts"))).toBe(true);
  });

  it("can group the paper by subject", async () => {
    await as(L_PRIMARY);
    const qs = await questionsOf((await mix([sec(300, 4), sec(320, 3, [0])], "BY_SUBJECT")).assessment_id);
    expect(qs.map((q) => q.t.split(" ")[0])).toEqual([...Array(4).fill("Computing"), ...Array(3).fill("Science")]);
  });

  it("gives what a thin section holds and says so, and refuses only when nothing is available", async () => {
    await as(L_PRIMARY);
    const r = await mix([sec(300, 5), sec(320, 5, [1])]);                         // Rocks holds only 3
    expect(r).toMatchObject({ question_count: 8, requested: 10, short: true });
    expect(r.sections).toEqual([{ subject: "Computing", requested: 5, given: 5 }, { subject: "Science", requested: 5, given: 3 }]);
    await db.exec("insert into public.bad_questions select id from public.questions");
    await expect(mix([sec(300, 5), sec(320, 5)])).rejects.toThrow("QB_PRACTICE_NO_QUESTIONS");
    await db.exec("truncate public.bad_questions");
  });

  it("never hands out a question the full check refuses", async () => {
    await as(L_PRIMARY);
    await db.exec("insert into public.bad_questions select id from public.questions where question_text ~ '^Computing Slides [1-5]$'");
    const r = await mix([sec(300, 10, [0])]);
    expect(r.question_count).toBe(10);
    expect((await one("select count(*)::int n from public.assessment_questions aq join public.bad_questions b on b.id = aq.question_id where aq.assessment_id = $1", [r.assessment_id])).n).toBe(0);
    await db.exec("truncate public.bad_questions");
  });
});

describe("who may mix subjects", () => {
  it("allows a JHS learner, refuses a Senior High learner (including the legacy B10 code) but allows them one subject", async () => {
    await as(L_JHS);
    expect((await mix([sec(340, 3), sec(360, 3)])).question_count).toBe(6);
    for (const learner of [L_SHS, L_LEGACY]) {
      await as(learner);
      await expect(mix([sec(380, 3), sec(400, 3)])).rejects.toThrow("QB_COMBINED_LEVEL_NOT_ALLOWED");
      expect(await mix([sec(380, 5)])).toMatchObject({ subject: "Mathematics", question_count: 5 });
    }
  });
  it("keeps a learner to the subjects of their own level", async () => {
    await as(L_PRIMARY);
    await expect(mix([sec(300, 3), sec(340, 3)])).rejects.toThrow("QB_PRACTICE_SUBJECT_UNAVAILABLE");   // a B7 subject
  });
  it("applies the free allowance", async () => {
    await as(L_PRIMARY, true);
    await expect(mix([sec(300, 3)])).rejects.toThrow("QB_FREE_ALLOWANCE_EXHAUSTED");
  });
});

describe("what is refused", () => {
  it("names the problem for a bad request", async () => {
    await as(L_PRIMARY);
    await expect(mix([])).rejects.toThrow("QB_BLUEPRINT_SECTIONS_INVALID");
    await expect(mix([sec(300, 3), sec(300, 3)])).rejects.toThrow("QB_BLUEPRINT_DUPLICATE_SUBJECT");
    await expect(mix([sec(300, 2)])).rejects.toThrow("QB_PRACTICE_COUNT_INVALID");
    await expect(mix([sec(300, 20), sec(320, 20)])).rejects.toThrow("QB_PRACTICE_COUNT_INVALID");
    await expect(mix([{ subject: "not-an-id", quota: 5 }])).rejects.toThrow("QB_BLUEPRINT_INVALID");
    await expect(mix([sec(300, 0)])).rejects.toThrow("QB_BLUEPRINT_INVALID");
    await expect(mix([sec(300, 5)], "SIDEWAYS")).rejects.toThrow("QB_BLUEPRINT_INVALID");
  });
});

describe("rollback", () => {
  it("removes the function", async () => {
    await db.exec(ROLLBACK);
    expect((await one("select to_regprocedure('public.qb_start_mixed_practice(jsonb,text,text)') f")).f).toBeNull();
  });
});
