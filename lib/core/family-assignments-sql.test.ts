import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Family workspace phase 4a (migration 20261081100000): the hidden family class, the family stamp on assignments, and the parent's progress view. Runs the real migration SQL.
const MIGS = ["supabase/migrations/20261079100000_family_workspace.sql", "supabase/migrations/20261080100000_family_children.sql", "supabase/migrations/20261081100000_family_assignments.sql"];
const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000a2", T = "00000000-0000-0000-0000-0000000000a3";
const AMA = "00000000-0000-0000-0000-0000000000c1", KOJO = "00000000-0000-0000-0000-0000000000c2", SENA = "00000000-0000-0000-0000-0000000000c3", SIS = "00000000-0000-0000-0000-0000000000c4";
const MKT = "00000000-0000-0000-0000-0000000000d1", CUR = "00000000-0000-0000-0000-0000000000e1";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
    create table public.platform_settings (key text, value jsonb, description text, scope_type text not null default 'global');
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select value = 'true'::jsonb from public.platform_settings where key = p_key limit 1), false) $$;
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb, created_at timestamptz default now());
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql as $$ insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, p_entity_type, p_entity, 'pass', p_details) $$;
    create table public.markets (id uuid primary key, configuration jsonb);
    create type public.qb_grade as enum ('B5', 'B8');
    create table public.profiles (id uuid primary key, full_name text, email text, role text, status text default 'active', country text, school_name text, default_market_id uuid, primary_market_id uuid, onboarding_completed_at timestamptz);
    create table public.student_profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, grade public.qb_grade, grade_code text, education_level text, school_name text, country text, status text, managed_by uuid, is_minor boolean default false, archived_at timestamptz, subjects text[]);
    create table public.user_market_memberships (user_id uuid, market_id uuid, active boolean, primary key (user_id, market_id));
    create table public.learner_consent (user_id uuid primary key, status text, policy_ref text, decided_by uuid, decided_at timestamptz, updated_at timestamptz default now());
    create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_role text, type text, title text, message text, entity_type text, entity_id uuid);
    create table public.teacher_profiles (id uuid primary key default gen_random_uuid(), user_id uuid not null unique, school_name text not null, country text not null default 'Ghana', status text default 'active');
    create table public.curriculum_nodes (id uuid primary key default gen_random_uuid(), curriculum_id uuid, canonical_grade_code text, grade_code text);
    create table public.market_curricula (curriculum_id uuid primary key, market_id uuid not null, active boolean not null default true);
    create table public.classes (id uuid primary key default gen_random_uuid(), join_code text not null unique, class_name text not null, school_name text, grade public.qb_grade, grade_label text not null, teacher_id uuid not null, teacher_user_id uuid not null, status text not null default 'active', primary_teacher_id uuid, curriculum_id uuid, education_level text, grade_code text);
    create table public.class_memberships (id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id), student_id uuid not null, student_user_id uuid not null, student_email text not null, student_name text not null, grade public.qb_grade, status text not null default 'active', joined_at timestamptz default now(), approved_at timestamptz, left_at timestamptz);
    create table public.assignments (id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id), teacher_user_id uuid, title text not null, grade public.qb_grade, grade_code text, due_at timestamptz, published_at timestamptz default now(), question_count integer default 10, mode text default 'ASSESSMENT', created_at timestamptz not null default now());
    create table public.assignment_targets (id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments(id), class_id uuid not null, student_id uuid not null, membership_id uuid not null);
    create table public.attempts (id uuid primary key default gen_random_uuid(), assignment_id uuid not null, student_id uuid not null, submitted_at timestamptz, percentage numeric);
    create table public.account_relationships (
      id uuid primary key default gen_random_uuid(),
      source_user_id uuid not null references public.profiles(id), target_user_id uuid not null references public.profiles(id),
      relationship_type text not null check (relationship_type in ('guardian','sponsor','institutional')),
      status text not null default 'requested' check (status in ('requested','pending_verification','active','suspended','revoked')),
      can_fund boolean not null default false, can_view_progress boolean not null default false, can_manage_account boolean not null default false,
      consent_status text not null default 'pending' check (consent_status in ('not_required','pending','granted','withdrawn')),
      verified_by uuid, verified_at timestamptz, valid_from timestamptz not null default now(), valid_until timestamptz,
      created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      check (source_user_id <> target_user_id), check (valid_until is null or valid_until > valid_from), check (status <> 'active' or verified_by is not null)
    );
    insert into public.markets values ('${MKT}', '{}');
    insert into public.profiles(id, full_name, email, role, country, primary_market_id) values
      ('${A}', 'John Mensah', 'john@x.test', 'teacher', 'Ghana', '${MKT}'), ('${B}', 'Efua Boateng', 'efua@x.test', 'sponsor', 'Ghana', '${MKT}'), ('${T}', 'Mr Mensah', 't@x.test', 'teacher', 'Ghana', '${MKT}'),
      ('${AMA}', 'Ama Mensah', 'ama@x.test', 'student', 'Ghana', '${MKT}'), ('${KOJO}', 'Kojo Mensah', 'kojo@x.test', 'student', 'Ghana', '${MKT}'), ('${SENA}', 'Sena Boateng', 's@x.test', 'student', 'Ghana', '${MKT}'), ('${SIS}', 'Yaa Mensah', 'y@x.test', 'student', 'Ghana', '${MKT}');
    insert into public.student_profiles(user_id, grade, grade_code, education_level, status) values
      ('${AMA}', 'B8', 'B8', 'jhs', 'active'), ('${KOJO}', 'B5', 'B5', 'primary', 'active'), ('${SENA}', 'B5', 'B5', 'primary', 'active'), ('${SIS}', 'B5', 'B5', 'primary', 'active');
    insert into public.curriculum_nodes(curriculum_id, canonical_grade_code, grade_code) values ('${CUR}', 'B5', 'B5'), ('${CUR}', 'B8', 'B8');
    insert into public.market_curricula values ('${CUR}', '${MKT}', true);
  `);
  for (const m of MIGS) await db.exec(readFileSync(m, "utf8"));
  await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.family_workspace'`);
  const attach = (p: string, s: string, t = "parent") => db.exec(`select public.qb_family_attach_child('${p}', '${s}', '${t}')`);
  await attach(A, AMA); await attach(A, KOJO); await attach(A, SIS); await attach(B, SENA, "academic_parent");
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const publish = async (db: PGlite, classId: string, title: string, userIds: string[]) => {
  const a = (await db.query<{ id: string }>(`insert into public.assignments(class_id, teacher_user_id, title, grade_code) select id, teacher_user_id, '${title}', grade_code from public.classes where id = '${classId}' returning id`)).rows[0].id;
  await db.exec(`insert into public.assignment_targets(assignment_id, class_id, student_id, membership_id) select '${a}', m.class_id, m.student_id, m.id from public.class_memberships m where m.class_id = '${classId}' and m.student_user_id = any(array[${userIds.map((u) => `'${u}'::uuid`).join(",")}])`);
  return a;
};

describe("the family class", () => {
  it("is made once per grade, owned by the parent, with only the parent's children of that grade", async () => {
    const db = await setup(); await as(db, A);
    const c5 = await one(db, "select public.qb_family_class('B5') as r"), again = await one(db, "select public.qb_family_class('B5') as r"), c8 = await one(db, "select public.qb_family_class('B8') as r");
    expect(again.class_id).toBe(c5.class_id); expect(c8.class_id).not.toBe(c5.class_id);
    expect(c5.learners.map((l: any) => l.name)).toEqual(["Kojo Mensah", "Yaa Mensah"]); expect(c8.learners.map((l: any) => l.name)).toEqual(["Ama Mensah"]);
    expect(c5.curriculum_id).toBe(CUR);
    const row = (await db.query<any>(`select teacher_user_id, class_name, family_workspace_id is not null as fam from public.classes where id = '${c5.class_id}'`)).rows[0];
    expect(row).toEqual({ teacher_user_id: A, class_name: "Family · B5", fam: true });
    expect((await db.query(`select 1 from public.class_memberships where class_id = '${c5.class_id}'`)).rows).toHaveLength(2);
    expect((await db.query(`select 1 from public.teacher_profiles where user_id = '${A}'`)).rows).toHaveLength(1);
  });
  it("another family cannot use it, and a grade with none of your children is refused", async () => {
    const db = await setup(); await as(db, B);
    await expect(db.query("select public.qb_family_class('B8')")).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    const mine = await one(db, "select public.qb_family_class('B5') as r");
    expect(mine.learners.map((l: any) => l.name)).toEqual(["Sena Boateng"]);
    await as(db, A); const own = await one(db, "select public.qb_family_class('B5') as r");
    expect(own.class_id).not.toBe(mine.class_id);
  });
  it("needs the assign permission: a mentor who may only look cannot start a family class", async () => {
    const db = await setup();
    await db.exec(`select public.qb_family_attach_child('${T}', '${SENA}', 'mentor')`); await as(db, T);
    await expect(db.query("select public.qb_family_class('B5')")).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
  it("is refused while the flag is off and for a signed-out caller", async () => {
    const db = await setup(); await as(db, null);
    await expect(db.query("select public.qb_family_class('B5')")).rejects.toThrow(/QB_AUTH_REQUIRED/);
    await db.exec("update public.platform_settings set value = 'false'::jsonb where key = 'flags.family_workspace'"); await as(db, A);
    await expect(db.query("select public.qb_family_class('B5')")).rejects.toThrow(/QB_FEATURE_DISABLED/);
  });
  it("picks up a child who is linked later, and drops nobody who was already there", async () => {
    const db = await setup(); await as(db, A);
    const first = await one(db, "select public.qb_family_class('B5') as r");
    await db.exec(`insert into public.profiles(id, full_name, email, role, country, primary_market_id) values ('00000000-0000-0000-0000-0000000000c9', 'Efe Mensah', 'e@x.test', 'student', 'Ghana', '${MKT}')`);
    await db.exec(`insert into public.student_profiles(user_id, grade, grade_code, education_level, status) values ('00000000-0000-0000-0000-0000000000c9', 'B5', 'B5', 'primary', 'active')`);
    await db.exec(`select public.qb_family_attach_child('${A}', '00000000-0000-0000-0000-0000000000c9', 'parent')`);
    const second = await one(db, "select public.qb_family_class('B5') as r");
    expect(second.class_id).toBe(first.class_id); expect(second.learners).toHaveLength(3);
  });
});

describe("family assignments", () => {
  it("an assignment made in a family class is stamped as family work from this workspace; a school class is not", async () => {
    const db = await setup(); await as(db, A);
    const c = await one(db, "select public.qb_family_class('B5') as r");
    const a = await publish(db, c.class_id, "Fractions", [KOJO]);
    expect((await db.query<any>(`select source_type, workspace_id is not null as fam from public.assignments where id = '${a}'`)).rows[0]).toEqual({ source_type: "family", fam: true });
    await db.exec(`insert into public.teacher_profiles(user_id, school_name) values ('${T}', 'XYZ')`);
    const school = (await db.query<{ id: string }>(`insert into public.classes(join_code, class_name, grade_label, teacher_id, teacher_user_id, grade_code) select 'JOIN1', 'JHS 2A', 'B8', id, user_id, 'B8' from public.teacher_profiles where user_id = '${T}' returning id`)).rows[0].id;
    const s = (await db.query<{ id: string }>(`insert into public.assignments(class_id, title) values ('${school}', 'Maths homework') returning id`)).rows[0].id;
    expect((await db.query<any>(`select source_type, workspace_id from public.assignments where id = '${s}'`)).rows[0]).toEqual({ source_type: "school", workspace_id: null });
  });
  it("a child who is in a school class and a family class keeps both, and school work is not changed", async () => {
    const db = await setup();
    await db.exec(`insert into public.teacher_profiles(user_id, school_name) values ('${T}', 'XYZ')`);
    const school = (await db.query<{ id: string }>(`insert into public.classes(join_code, class_name, grade_label, teacher_id, teacher_user_id, grade_code, grade) select 'JOIN1', 'JHS 2A', 'B8', id, user_id, 'B8', 'B8' from public.teacher_profiles where user_id = '${T}' returning id`)).rows[0].id;
    await db.exec(`insert into public.class_memberships(class_id, student_id, student_user_id, student_email, student_name, status) select '${school}', id, user_id, 'a', 'Ama', 'active' from public.student_profiles where user_id = '${AMA}'`);
    await as(db, A); await db.exec("select public.qb_family_class('B8')");
    expect((await db.query(`select 1 from public.class_memberships where student_user_id = '${AMA}' and status = 'active'`)).rows).toHaveLength(2);
    expect((await db.query<any>(`select school_name from public.student_profiles where user_id = '${AMA}'`)).rows[0].school_name).toBeNull();
  });
  it("the parent sees progress for their own children's assignments only", async () => {
    const db = await setup(); await as(db, A);
    const c = await one(db, "select public.qb_family_class('B5') as r"), a = await publish(db, c.class_id, "Fractions", [KOJO, SIS]);
    await db.exec(`insert into public.attempts(assignment_id, student_id, submitted_at, percentage) select '${a}', id, now(), 80 from public.student_profiles where user_id = '${KOJO}'`);
    await db.exec(`insert into public.attempts(assignment_id, student_id) select '${a}', id from public.student_profiles where user_id = '${SIS}'`);
    const list = await one(db, "select public.qb_family_assignments() as r");
    expect(list).toHaveLength(1);
    expect(list[0].children.map((k: any) => [k.name, k.status, k.percentage === null ? null : Number(k.percentage)])).toEqual([["Kojo Mensah", "done", 80], ["Yaa Mensah", "started", null]]);
    await as(db, B); expect(await one(db, "select public.qb_family_assignments() as r")).toEqual([]);
  });
  it("revoking a child removes their progress from the parent's list at once", async () => {
    const db = await setup(); await as(db, A);
    const c = await one(db, "select public.qb_family_class('B5') as r"); await publish(db, c.class_id, "Fractions", [KOJO, SIS]);
    await db.exec(`select public.qb_family_revoke('${SIS}')`);
    const list = await one(db, "select public.qb_family_assignments() as r");
    expect(list[0].children.map((k: any) => k.name)).toEqual(["Kojo Mensah"]);
  });
  it("is for signed-in users only", async () => {
    const db = await setup();
    const can = async (fn: string, role: string) => (await one(db, `select has_function_privilege('${role}', '${fn}', 'execute') as r`)) as boolean;
    for (const f of ["public.qb_family_class(text)", "public.qb_family_assignments()"]) { expect(await can(f, "authenticated")).toBe(true); expect(await can(f, "anon")).toBe(false); }
  });
});
