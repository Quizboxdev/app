import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const QUICK = read("../../supabase/migrations/20261012200000_quick_practice.sql");
const STAFF = read("../../supabase/migrations/20261012210000_practice_for_staff.sql");
const LABELS = read("../../supabase/migrations/20261018110000_readable_topic_labels.sql");
const ROLLBACK = read("../../supabase/rollback/readable_topic_labels.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const one = async (sql: string) => (await db.query<Record<string, any>>(sql)).rows[0] ?? {};

// B9 Social Studies loaded with codes as titles: strand "B9.1", sub-strand "B9.1.1" and a placeholder "Sub-strand"; one proper sub-strand.
describe("readable topic labels in the practice builder (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select '${id(1)}'::uuid $$;
      create type public.qb_grade as enum ('B7','B8','B9');
      create type public.qb_role as enum ('student','teacher','admin','sponsor');
      create table public.profiles(id uuid primary key, default_market_id uuid, role text);
      create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid unique, grade text, grade_code text);
      create table public.curriculum_nodes(id uuid primary key, curriculum_id uuid, parent_id uuid, node_type text, title text, subject_code text, grade_code text,
        canonical_grade_code text, sort_order integer default 0, is_active boolean default true);
      create table public.market_curricula(curriculum_id uuid primary key, market_id uuid, active boolean default true);
      create table public.questions(id uuid primary key default gen_random_uuid(), version integer default 1, curriculum_node_id uuid, status text default 'active',
        validation_status text default 'approved', source_type text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text,
        marks integer default 1, question_content jsonb, answer_type text default 'SINGLE_CHOICE', answer_spec jsonb);
      create function public.qb_question_is_available(q public.questions) returns boolean language sql as $$ select true $$;
      create function public.qb_public_tenant_id() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
      create table public.assessments(id uuid primary key default gen_random_uuid(), assessment_type text, owner_role public.qb_role, owner_user_id uuid, subject_code text,
        subject_name text, grade public.qb_grade, grade_code text, question_count integer, difficulty text, time_limit_minutes integer, max_attempts integer,
        allow_resume boolean, auto_submit boolean, pass_percent numeric, expires_at timestamptz, instructions text, tenant_id uuid, reference_type text);
      create table public.assessment_questions(assessment_id uuid, question_id uuid, question_order integer, question_text_snapshot text, option_a_snapshot text,
        option_b_snapshot text, option_c_snapshot text, option_d_snapshot text, correct_answer_snapshot text, marks_snapshot integer, question_content_snapshot jsonb,
        answer_type_snapshot text, answer_spec_snapshot jsonb);
      insert into public.profiles values('${id(1)}','${id(100)}','STUDENT');
      insert into public.student_profiles(user_id,grade,grade_code) values('${id(1)}','B9','B9');
      insert into public.market_curricula values('${id(200)}','${id(100)}',true);
      insert into public.curriculum_nodes(id,curriculum_id,parent_id,node_type,title,subject_code,grade_code,canonical_grade_code,sort_order) values
        ('${id(300)}','${id(200)}',null,'subject','Social Studies','SOC','B9','B9',0),
        ('${id(301)}','${id(200)}','${id(300)}','strand','B9.1',null,null,null,0),
        ('${id(302)}','${id(200)}','${id(301)}','sub_strand','B9.1.1',null,null,null,0),
        ('${id(303)}','${id(200)}','${id(302)}','content_standard','B9.1.1.1',null,null,null,0),
        ('${id(304)}','${id(200)}','${id(303)}','learning_indicator','Explain the causes of rural-urban migration in Ghana',null,null,null,0),
        ('${id(305)}','${id(200)}','${id(301)}','sub_strand','Sub-strand',null,null,null,1),
        ('${id(306)}','${id(200)}','${id(305)}','learning_indicator','Describe the roles of traditional leaders',null,null,null,0),
        ('${id(307)}','${id(200)}','${id(301)}','sub_strand','Our Environment',null,null,null,2),
        ('${id(308)}','${id(200)}','${id(307)}','learning_indicator','Identify major landforms',null,null,null,0);
      insert into public.questions(curriculum_node_id,question_text,option_a,option_b,correct_answer)
        select n, 'Q '||g, 'A','B','A' from unnest(array['${id(304)}','${id(306)}','${id(308)}']::uuid[]) n, generate_series(1,3) g;
    `);
    await db.exec(QUICK); await db.exec(STAFF);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("before the fix, a learner sees codes as topic names (the reported problem)", async () => {
    const titles = (await one("select public.qb_practice_menu() v")).v.subjects[0].topics.map((t: any) => t.title);
    expect(titles).toEqual(["B9.1.1", "Sub-strand", "Our Environment"]);
  });

  it("after the fix, codes and placeholders are replaced by the first indicator's wording; real names stay; strand codes are hidden", async () => {
    await db.exec(LABELS);
    const topics = (await one("select public.qb_practice_menu() v")).v.subjects[0].topics;
    expect(topics.map((t: any) => t.title)).toEqual(["Explain the causes of rural-urban migration in Ghana", "Describe the roles of traditional leaders", "Our Environment"]);
    expect(topics.every((t: any) => t.strand === "")).toBe(true);
    expect(topics.map((t: any) => t.available)).toEqual([3, 3, 3]);
  });

  it("recognises codes without hiding real names", async () => {
    const is = async (t: string) => (await one(`select public.qb_label_is_code('${t}') v`)).v;
    for (const code of ["B9.1", "B9.1.1", "Sub-strand", "strand 2", "SHS1.2.3", ""]) expect(await is(code)).toBe(true);
    for (const name of ["Our Environment", "Algebra 2", "Fractions", "Counting, Representation & Cardinality"]) expect(await is(name)).toBe(false);
  });

  it("rolls back to raw titles", async () => {
    await db.exec(ROLLBACK);
    expect((await one("select public.qb_practice_menu() v")).v.subjects[0].topics[0].title).toBe("B9.1.1");
  });
});
