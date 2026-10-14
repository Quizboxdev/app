import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const QUICK = read("../../supabase/migrations/20261012200000_quick_practice.sql");
const STAFF = read("../../supabase/migrations/20261012210000_practice_for_staff.sql");
const GATE = read("../../supabase/migrations/20261014100000_free_allowance_gate.sql");
const GATE_ROLLBACK = read("../../supabase/rollback/free_allowance_gate.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const start = (topics: string[]) => one("select public.qb_start_quick_practice($1::uuid[], 5) v", [topics]);

// users: 1 B4 learner, 2 B4 learner with a subscription, 3 teacher
describe("free allowance gate (isolated PostgreSQL; production triggers are not modelled)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema quizbox_core;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
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
        marks integer default 1, question_content jsonb, answer_type text default 'SINGLE_CHOICE', answer_spec jsonb);
      create function public.qb_question_is_available(q public.questions) returns boolean language sql as $$ select true $$;
      create function public.qb_public_tenant_id() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
      create table public.assessments(id uuid primary key default gen_random_uuid(), assessment_type text, owner_role public.qb_role, owner_user_id uuid, subject_code text,
        subject_name text, grade public.qb_grade, grade_code text, question_count integer, difficulty text, time_limit_minutes integer, max_attempts integer,
        allow_resume boolean, auto_submit boolean, pass_percent numeric, expires_at timestamptz, instructions text, tenant_id uuid, reference_type text);
      create table public.assessment_questions(assessment_id uuid, question_id uuid, question_order integer, question_text_snapshot text, option_a_snapshot text,
        option_b_snapshot text, option_c_snapshot text, option_d_snapshot text, correct_answer_snapshot text, marks_snapshot integer, question_content_snapshot jsonb,
        answer_type_snapshot text, answer_spec_snapshot jsonb);
      create table public.platform_settings(key text, scope_type text default 'global', scope_id uuid, value jsonb);
      create function quizbox_core.setting(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns jsonb language sql stable as
        $$ select value from public.platform_settings where key = p_key and scope_type = 'global' $$;
      create table public.access_entitlements(id uuid primary key default gen_random_uuid(), user_id uuid, kind text, status text default 'active',
        valid_from timestamptz default now(), valid_until timestamptz);
      insert into public.profiles values('${id(1)}','${id(100)}','STUDENT'),('${id(2)}','${id(100)}','STUDENT'),('${id(3)}','${id(100)}','TEACHER');
      insert into public.student_profiles(user_id,grade,grade_code) values('${id(1)}','B4','B4'),('${id(2)}','B4','B4');
      insert into public.market_curricula values('${id(200)}','${id(100)}',true);
      insert into public.curriculum_nodes(id,curriculum_id,parent_id,node_type,title,subject_code,grade_code,canonical_grade_code) values
        ('${id(300)}','${id(200)}',null,'subject','Computing','Computing','B4','B4'),
        ('${id(302)}','${id(200)}','${id(300)}','sub_strand','Slides',null,null,null),
        ('${id(304)}','${id(200)}','${id(302)}','learning_indicator','Add a slide',null,null,null);
      insert into public.questions(curriculum_node_id,question_text,option_a,option_b,correct_answer)
        select '${id(304)}','Question '||g,'A','B','A' from generate_series(1,12) g;
    `);
    await db.exec(QUICK); await db.exec(STAFF); await db.exec(GATE);
    await db.exec("grant select on all tables in schema public to authenticated");
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("is OFF while no allowance is configured: unlimited sessions, nothing gated", async () => {
    await as(1);
    for (let i = 0; i < 3; i++) await start([id(302)]);
    expect(await one("select public.qb_my_access() v").then((r) => r.v)).toMatchObject({ gated: false, free_limit: null, used: 3, exhausted: false });
  });

  it("lets a learner use the configured allowance, then refuses with the code the app redirects on", async () => {
    await db.exec(`insert into public.platform_settings(key,value) values('access.free_practice_sessions','5')`);
    await as(1);
    expect((await one("select public.qb_my_access() v")).v).toMatchObject({ gated: true, free_limit: 5, used: 3, remaining: 2, exhausted: false });
    await start([id(302)]); await start([id(302)]);
    expect((await one("select public.qb_my_access() v")).v).toMatchObject({ remaining: 0, exhausted: true, subscribed: false });
    await expect(start([id(302)])).rejects.toThrow("QB_FREE_ALLOWANCE_EXHAUSTED");
    expect((await one("select count(*)::int n from public.assessments where owner_user_id=$1", [id(1)])).n).toBe(5);   // the refused call created nothing
  });

  it("does not gate a learner with an active subscription, but gates again once it expires", async () => {
    await as(2);
    await db.exec(`insert into public.assessments(owner_user_id,reference_type) select '${id(2)}','SELF_PRACTICE' from generate_series(1,6)`);
    await expect(start([id(302)])).rejects.toThrow("QB_FREE_ALLOWANCE_EXHAUSTED");
    await db.exec(`insert into public.access_entitlements(user_id,kind,valid_until) values('${id(2)}','subscription', now() + interval '30 days')`);
    expect((await one("select public.qb_my_access() v")).v).toMatchObject({ subscribed: true, exhausted: false });
    expect((await start([id(302)])).v).toMatchObject({ question_count: 5 });
    await db.exec(`update public.access_entitlements set valid_until = now() - interval '1 day' where user_id='${id(2)}'`);
    await expect(start([id(302)])).rejects.toThrow("QB_FREE_ALLOWANCE_EXHAUSTED");
  });

  it("never gates a teacher, and rolls back cleanly", async () => {
    await as(3);
    expect((await one("select public.qb_my_access() v")).v).toMatchObject({ gated: false, exhausted: false });
    const r = (await one("select public.qb_start_quick_practice($1::uuid[], 5, 'B4') v", [[id(302)]])).v;
    expect(r.question_count).toBe(5);
    await db.exec(GATE_ROLLBACK);
    expect((await db.query("select to_regprocedure('public.qb_my_access()') f")).rows[0]).toEqual({ f: null });
    await as(1);
    await start([id(302)]);   // the previous behaviour is back: no gate
  });
});
