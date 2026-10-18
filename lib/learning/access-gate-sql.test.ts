import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const QUICK = read("../../supabase/migrations/20261012200000_quick_practice.sql");
const STAFF = read("../../supabase/migrations/20261012210000_practice_for_staff.sql");
const GATE = read("../../supabase/migrations/20261018100000_access_gate_standalone.sql");
const ROLLBACK = read("../../supabase/rollback/access_gate_standalone.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const start = () => one("select public.qb_start_quick_practice($1::uuid[], 5) v", [[id(302)]]);
const access = async () => (await one("select public.qb_my_access() v")).v;

// No quizbox_core schema and no access_entitlements table, exactly like production.
// users: 1 learner, 2 learner, 3 teacher, 9 owner (super_admin)
describe("standalone free allowance and subscriptions (isolated PostgreSQL; production triggers are not modelled)", () => {
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
      create table public.profiles(id uuid primary key, default_market_id uuid, role text, email text, full_name text);
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
      insert into public.profiles values('${id(1)}','${id(100)}','STUDENT','ama@example.com','Ama'),('${id(2)}','${id(100)}','STUDENT','kofi@example.com','Kofi'),('${id(3)}','${id(100)}','TEACHER','t@example.com','Teacher'),('${id(9)}','${id(100)}','ADMIN','owner@example.com','Owner');
      insert into public.student_profiles(user_id,grade,grade_code) values('${id(1)}','B4','B4'),('${id(2)}','B4','B4');
      insert into public.market_curricula values('${id(200)}','${id(100)}',true);
      insert into public.curriculum_nodes(id,curriculum_id,parent_id,node_type,title,subject_code,grade_code,canonical_grade_code) values
        ('${id(300)}','${id(200)}',null,'subject','Computing','Computing','B4','B4'),
        ('${id(302)}','${id(200)}','${id(300)}','sub_strand','Slides',null,null,null),
        ('${id(304)}','${id(200)}','${id(302)}','learning_indicator','Add a slide',null,null,null);
      insert into public.questions(curriculum_node_id,question_text,option_a,option_b,correct_answer) select '${id(304)}','Question '||g,'A','B','A' from generate_series(1,12) g;
    `);
    await db.exec(QUICK); await db.exec(STAFF); await db.exec(GATE);
    await db.exec("grant select on all tables in schema public to authenticated");
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("installs without quizbox_core and is OFF until the owner sets a number", async () => {
    await as(1);
    for (let i = 0; i < 3; i++) await start();
    expect(await access()).toMatchObject({ gated: false, free_limit: null, used: 3, exhausted: false, subscribed: false });
  });

  it("only a super admin sets the allowance; then a learner is stopped with the code the app redirects on", async () => {
    await as(3);
    await expect(one("select public.qb_admin_set_free_allowance(4) v")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(9, "super_admin");
    await expect(one("select public.qb_admin_set_free_allowance(-1) v")).rejects.toThrow("QB_INVALID_ALLOWANCE");
    expect((await one("select public.qb_admin_set_free_allowance(4) v")).v).toMatchObject({ free_practice_sessions: 4, gate: "on" });
    await as(1);
    expect(await access()).toMatchObject({ gated: true, free_limit: 4, used: 3, remaining: 1, exhausted: false });
    await start();
    expect(await access()).toMatchObject({ remaining: 0, exhausted: true });
    await expect(start()).rejects.toThrow("QB_FREE_ALLOWANCE_EXHAUSTED");
  });

  it("a granted subscription lifts the gate; a revoked one restores it; extensions stack", async () => {
    await as(9, "super_admin");
    await expect(one("select public.qb_admin_grant_subscription($1, 30, 'learner_monthly', 'x') v", [id(1)])).rejects.toThrow("QB_SUBSCRIPTION_NOTE_REQUIRED");
    const s1 = (await one("select public.qb_admin_grant_subscription($1, 30, 'learner_monthly', 'Paid by MoMo ref 123') v", [id(1)])).v;
    const s2 = (await one("select public.qb_admin_grant_subscription($1, 30, 'learner_monthly', 'Second month paid') v", [id(1)])).v;
    expect(new Date(s2.valid_from).getTime()).toBe(new Date(s1.valid_until).getTime());   // the second month starts when the first ends
    await as(1);
    expect(await access()).toMatchObject({ subscribed: true, exhausted: false });
    expect((await start()).v).toMatchObject({ question_count: 5 });
    expect((await db.query("select count(*)::int n from public.learner_subscriptions")).rows[0]).toEqual({ n: 2 });   // a learner reads their own rows
    await as(9, "super_admin");
    await one("select public.qb_admin_revoke_subscription($1, 'Refunded in full') v", [s1.id]);
    await one("select public.qb_admin_revoke_subscription($1, 'Refunded in full') v", [s2.id]);
    await expect(one("select public.qb_admin_revoke_subscription($1, 'Refunded in full') v", [s2.id])).rejects.toThrow("QB_SUBSCRIPTION_NOT_FOUND");
    await as(1);
    await expect(start()).rejects.toThrow("QB_FREE_ALLOWANCE_EXHAUSTED");
  });

  it("never gates a teacher, null switches the gate off, and anon cannot call it", async () => {
    await as(3);
    expect(await access()).toMatchObject({ gated: false, exhausted: false });
    expect((await one("select public.qb_start_quick_practice($1::uuid[], 5, 'B4') v", [[id(302)]])).v.question_count).toBe(5);
    await as(9, "super_admin");
    expect((await one("select public.qb_admin_set_free_allowance(null) v")).v).toMatchObject({ gate: "off" });
    await as(1);
    expect((await start()).v.question_count).toBe(5);
    await db.exec("set role anon");
    await expect(one("select public.qb_my_access() v")).rejects.toThrow();
    await db.exec("reset role");
  });

  it("gives the owner an overview and grants by email (what the admin screen uses)", async () => {
    await as(1);
    await expect(one("select public.qb_admin_access_overview() v")).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(9, "super_admin");
    await expect(one("select public.qb_admin_grant_subscription_email('nobody@example.com', 30, 'learner_monthly', 'Paid cash') v")).rejects.toThrow("QB_USER_NOT_FOUND");
    expect((await one("select public.qb_admin_grant_subscription_email(' KOFI@example.com ', 30, 'learner_monthly', 'Paid cash at school') v")).v.plan).toBe("learner_monthly");
    const o = (await one("select public.qb_admin_access_overview() v")).v;
    expect(o).toMatchObject({ learners: 2, subscribed_now: 1 });
    expect(o.subscriptions[0]).toMatchObject({ email: "kofi@example.com", status: "active", source: "manual" });
  });

  it("rolls back cleanly to the ungated builder", async () => {
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regclass('public.learner_subscriptions') t")).rows[0]).toEqual({ t: null });
    await as(1);
    expect((await start()).v.question_count).toBe(5);
  });
});
