import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261012200000_quick_practice.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../../supabase/rollback/quick_practice.sql", import.meta.url), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number | null) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [n === null ? "" : id(n)]);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};

// Curriculum fixture (market M1): Primary subject "Computing" B4 with two sub-strands, a B5 subject, and a market the learner is not in.
// users: 1 B4 learner in M1, 2 B7 learner, 3 teacher (no student profile)
describe("quick practice RPCs (isolated PostgreSQL; production triggers are not modelled)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create type public.qb_grade as enum ('B7','B8','B9');
      create type public.qb_role as enum ('student','teacher','admin','sponsor');
      create table public.profiles(id uuid primary key, default_market_id uuid);
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
      insert into public.profiles values('${id(1)}','${id(100)}'),('${id(2)}','${id(100)}'),('${id(3)}','${id(100)}');
      insert into public.student_profiles(user_id,grade,grade_code) values('${id(1)}','B4','B4'),('${id(2)}','B7','B7');
      insert into public.market_curricula values('${id(200)}','${id(100)}',true),('${id(201)}','${id(101)}',true);
      -- Computing B4: strand 1 > sub-strand A (indicator i1) and sub-strand B (indicator i2)
      insert into public.curriculum_nodes(id,curriculum_id,parent_id,node_type,title,subject_code,grade_code,canonical_grade_code,sort_order) values
        ('${id(300)}','${id(200)}',null,'subject','Computing','Computing','B4','B4',0),
        ('${id(301)}','${id(200)}','${id(300)}','strand','PRESENTATION',null,null,null,0),
        ('${id(302)}','${id(200)}','${id(301)}','sub_strand','Slides',null,null,null,0),
        ('${id(303)}','${id(200)}','${id(302)}','content_standard','Use slides',null,null,null,0),
        ('${id(304)}','${id(200)}','${id(303)}','learning_indicator','Add a slide',null,null,null,0),
        ('${id(305)}','${id(200)}','${id(301)}','sub_strand','Fonts',null,null,null,1),
        ('${id(306)}','${id(200)}','${id(305)}','content_standard','Use fonts',null,null,null,0),
        ('${id(307)}','${id(200)}','${id(306)}','learning_indicator','Bold text',null,null,null,0),
        ('${id(310)}','${id(200)}',null,'subject','Mathematics','Mathematics','B7','B7',0),
        ('${id(311)}','${id(200)}','${id(310)}','sub_strand','Fractions',null,null,null,0),
        ('${id(312)}','${id(200)}','${id(311)}','learning_indicator','Add fractions',null,null,null,0),
        ('${id(320)}','${id(201)}',null,'subject','Science','Science','B4','B4',0),
        ('${id(321)}','${id(201)}','${id(320)}','sub_strand','Plants',null,null,null,0),
        ('${id(322)}','${id(201)}','${id(321)}','learning_indicator','Parts of a plant',null,null,null,0);
    `);
    const q = (node: number, n: number, extra = "") => db.exec(`insert into public.questions(curriculum_node_id,question_text,option_a,option_b,correct_answer${extra ? "," + extra.split("|")[0] : ""})
      select ${id(node) ? `'${id(node)}'` : "null"}, 'Question ' || g, 'A','B','A'${extra ? "," + extra.split("|")[1] : ""} from generate_series(1,${n}) g`);
    await q(304, 6); await q(307, 4); await q(312, 5); await q(322, 5);
    await db.exec(`insert into public.questions(curriculum_node_id,question_text,validation_status) values('${id(304)}','Draft one','review'),('${id(307)}','Archived','approved')`);
    await db.exec(`update public.questions set status='archived' where question_text='Archived'`);
    await db.exec(MIGRATION);
    await db.exec("grant select on all tables in schema public to authenticated");
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("shows a learner only their own grade, in their market, with topic names and counts of approved questions", async () => {
    await as(1);
    const menu = (await one("select public.qb_practice_menu() v")).v;
    expect(menu.grade).toBe("B4");
    expect(menu.subjects.map((s: any) => s.name)).toEqual(["Computing"]);                      // not Mathematics (B7) and not the other market's Science
    expect(menu.subjects[0].topics.map((t: any) => [t.title, t.available])).toEqual([["Slides", 6], ["Fonts", 4]]);   // drafts and archived questions are not offered
    expect(menu.subjects[0].available).toBe(10);
    expect(menu.subjects[0].topics[0].strand).toBe("PRESENTATION");
  });

  it("builds a private practice set spread evenly across the ticked topics", async () => {
    await as(1);
    const menu = (await one("select public.qb_practice_menu() v")).v;
    const ids = menu.subjects[0].topics.map((t: any) => t.id);
    const r = (await one("select public.qb_start_quick_practice($1::uuid[], 8) v", [ids])).v;
    expect(r).toMatchObject({ subject: "Computing", question_count: 8, requested: 8, short: false });
    const a = await one("select * from public.assessments where id=$1", [r.assessment_id]);
    expect(a).toMatchObject({ assessment_type: "PRACTICE", owner_user_id: id(1), grade_code: "B4", grade: null, reference_type: "SELF_PRACTICE", question_count: 8 });
    const rows = (await db.query<{ topic: string; n: number }>(`select n.title topic, count(*)::int n from public.assessment_questions aq join public.questions q on q.id=aq.question_id
      join public.curriculum_nodes i on i.id=q.curriculum_node_id join public.curriculum_nodes cs on cs.id=i.parent_id join public.curriculum_nodes n on n.id=cs.parent_id
      where aq.assessment_id=$1 group by 1 order by 1`, [r.assessment_id])).rows;
    expect(rows).toEqual([{ topic: "Fonts", n: 4 }, { topic: "Slides", n: 4 }]);
  });

  it("gives what exists and says so when fewer questions are available than asked", async () => {
    await as(1);
    const fonts = (await one("select public.qb_practice_menu() v")).v.subjects[0].topics.find((t: any) => t.title === "Fonts").id;
    const r = (await one("select public.qb_start_quick_practice($1::uuid[], 12) v", [[fonts]])).v;
    expect(r).toMatchObject({ question_count: 4, requested: 12, short: true });
  });

  it("refuses topics of another grade or market, a teacher, bad counts and an empty selection", async () => {
    await as(1);
    await expect(one("select public.qb_start_quick_practice($1::uuid[], 5) v", [[id(311)]])).rejects.toThrow("QB_PRACTICE_NO_QUESTIONS");   // B7 topic
    await expect(one("select public.qb_start_quick_practice($1::uuid[], 5) v", [[id(321)]])).rejects.toThrow("QB_PRACTICE_NO_QUESTIONS");   // other market
    await expect(one("select public.qb_start_quick_practice($1::uuid[], 2) v", [[id(302)]])).rejects.toThrow("QB_PRACTICE_COUNT_INVALID");
    await expect(one("select public.qb_start_quick_practice('{}'::uuid[], 5) v")).rejects.toThrow("QB_PRACTICE_TOPICS_REQUIRED");
    await as(3);
    await expect(one("select public.qb_practice_menu() v")).rejects.toThrow("QB_STUDENT_REQUIRED");
    await as(null);
    await expect(one("select public.qb_practice_menu() v")).rejects.toThrow("QB_AUTHENTICATION_REQUIRED");
    await as(2);
    const menu = (await one("select public.qb_practice_menu() v")).v;
    expect(menu.subjects.map((s: any) => s.name)).toEqual(["Mathematics"]);   // the B7 learner sees only the B7 subject
  });

  it("is not executable by anon and rolls back cleanly", async () => {
    await db.exec("set role anon");
    await expect(one("select public.qb_practice_menu() v")).rejects.toThrow();
    await db.exec("reset role");
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regprocedure('public.qb_practice_menu()') f")).rows[0]).toEqual({ f: null });
  });
});
