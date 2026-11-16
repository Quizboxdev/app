import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Family workspace phases 9 and 10 (migration 20261083100000): what a parent can follow, and what staff can see. Runs the real migration SQL.
const MIGS = ["20261079100000_family_workspace", "20261080100000_family_children", "20261081100000_family_assignments", "20261082100000_family_orders", "20261083100000_family_progress_admin"].map((m) => `supabase/migrations/${m}.sql`);
const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000a2", STAFF = "00000000-0000-0000-0000-0000000000a9";
const AMA = "00000000-0000-0000-0000-0000000000c1", KOJO = "00000000-0000-0000-0000-0000000000c2", SENA = "00000000-0000-0000-0000-0000000000c3";
const MKT = "00000000-0000-0000-0000-0000000000d1";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
    create table public.platform_settings (key text, value jsonb, description text, scope_type text not null default 'global');
    create schema quizbox_core; create schema quizbox_market;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select value = 'true'::jsonb from public.platform_settings where key = p_key limit 1), false) $$;
    create function quizbox_core.is_staff() returns boolean language sql as $$ select coalesce(current_setting('test.staff', true), '') = 'on' $$;
    create function quizbox_market.is_super() returns boolean language sql as $$ select false $$;
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
    create table public.classes (id uuid primary key default gen_random_uuid(), join_code text not null unique, class_name text not null, grade public.qb_grade, grade_label text not null, teacher_id uuid not null, teacher_user_id uuid not null, status text not null default 'active', primary_teacher_id uuid, curriculum_id uuid, education_level text, grade_code text);
    create table public.assignments (id uuid primary key default gen_random_uuid(), class_id uuid not null references public.classes(id), title text not null, created_at timestamptz not null default now());
    create table public.assignment_targets (id uuid primary key default gen_random_uuid(), assignment_id uuid not null references public.assignments(id), student_id uuid not null);
    create table public.attempts (id uuid primary key default gen_random_uuid(), assignment_id uuid not null, student_id uuid not null, student_user_id uuid not null, started_at timestamptz default now(), submitted_at timestamptz, percentage numeric);
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
      ('${A}', 'John Mensah', 'john@x.test', 'teacher', 'Ghana', '${MKT}'), ('${B}', 'Efua Boateng', 'efua@x.test', 'sponsor', 'Ghana', '${MKT}'), ('${STAFF}', 'Staff', 's@x.test', 'admin', 'Ghana', '${MKT}'),
      ('${AMA}', 'Ama Mensah', 'ama@x.test', 'student', 'Ghana', '${MKT}'), ('${KOJO}', 'Kojo Mensah', 'kojo@x.test', 'student', 'Ghana', '${MKT}'), ('${SENA}', 'Sena Boateng', 's2@x.test', 'student', 'Ghana', '${MKT}');
    insert into public.student_profiles(user_id, grade, grade_code, status) values ('${AMA}', 'B8', 'B8', 'active'), ('${KOJO}', 'B5', 'B5', 'active'), ('${SENA}', 'B5', 'B5', 'active');
  `);
  for (const m of MIGS) await db.exec(readFileSync(m, "utf8"));
  await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.family_workspace'`);
  const attach = (p: string, s: string, t = "parent") => db.exec(`select public.qb_family_attach_child('${p}', '${s}', '${t}')`);
  await attach(A, AMA); await attach(A, KOJO); await attach(B, SENA, "mentor");
  return db;
}
const as = (db: PGlite, uid: string | null, staff = false) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false), set_config('test.staff', '${staff ? "on" : ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const work = async (db: PGlite, child: string, title: string, source: "school" | "family", pct: number | null, daysAgo = 1) => {
  const cls = (await db.query<{ id: string }>(`insert into public.classes(join_code, class_name, grade_label, teacher_id, teacher_user_id) values ('J' || gen_random_uuid()::text, 'c', 'B5', gen_random_uuid(), '${A}') returning id`)).rows[0].id;
  const a = (await db.query<{ id: string }>(`insert into public.assignments(class_id, title, source_type) values ('${cls}', '${title}', '${source}') returning id`)).rows[0].id;
  const sp = (await db.query<{ id: string }>(`select id from public.student_profiles where user_id = '${child}'`)).rows[0].id;
  await db.exec(`insert into public.assignment_targets(assignment_id, student_id) values ('${a}', '${sp}')`);
  if (pct !== null) await db.exec(`insert into public.attempts(assignment_id, student_id, student_user_id, submitted_at, percentage) values ('${a}', '${sp}', '${child}', now() - interval '${daysAgo} days', ${pct})`);
};

describe("parent progress", () => {
  it("summarises each child the parent may follow: done, average, still to do", async () => {
    const db = await setup();
    await work(db, AMA, "Maths", "school", 80); await work(db, AMA, "Science", "family", 60); await work(db, AMA, "English", "family", null); await work(db, KOJO, "Fractions", "family", 90);
    await as(db, A);
    const rows = await one(db, "select public.qb_family_progress(30) as r");
    expect(rows.map((r: any) => [r.name, Number(r.completed), Number(r.average), Number(r.outstanding)])).toEqual([["Ama Mensah", 2, 70, 1], ["Kojo Mensah", 1, 90, 0]]);
  });
  it("one child: totals, the week-by-week curve, and the latest results with their source", async () => {
    const db = await setup();
    await work(db, AMA, "Maths", "school", 80, 1); await work(db, AMA, "Science", "family", 60, 10);
    await as(db, A);
    const p = await one(db, `select public.qb_family_child_progress('${AMA}', 30) as r`);
    expect([Number(p.completed), Number(p.average), Number(p.best)]).toEqual([2, 70, 80]);
    expect(p.weekly.length).toBeGreaterThanOrEqual(1);
    expect(p.recent.map((x: any) => [x.title, x.source])).toEqual([["Maths", "school"], ["Science", "family"]]);
  });
  it("only counts the window asked for", async () => {
    const db = await setup(); await work(db, AMA, "Old", "school", 50, 40); await work(db, AMA, "New", "school", 100, 2); await as(db, A);
    expect(Number((await one(db, `select public.qb_family_child_progress('${AMA}', 30) as r`)).completed)).toBe(1);
  });
  it("is refused for a child who is not yours, one you may not follow, a revoked child, and a signed-out caller", async () => {
    const db = await setup(); await as(db, A);
    await expect(db.query(`select public.qb_family_child_progress('${SENA}', 30)`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await db.exec(`select public.qb_family_revoke('${KOJO}')`);
    await expect(db.query(`select public.qb_family_child_progress('${KOJO}', 30)`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    expect((await one(db, "select public.qb_family_progress(30) as r")).map((r: any) => r.name)).toEqual(["Ama Mensah"]);
    await as(db, null); await expect(db.query(`select public.qb_family_child_progress('${AMA}', 30)`)).rejects.toThrow(/QB_AUTH_REQUIRED/);
  });
  it("a mentor with view-only access can follow progress, and another family sees nothing of it", async () => {
    const db = await setup(); await work(db, SENA, "Maths", "school", 75); await as(db, B);
    expect(Number((await one(db, `select public.qb_family_child_progress('${SENA}', 30) as r`)).completed)).toBe(1);
    await as(db, A); await expect(db.query(`select public.qb_family_child_progress('${SENA}', 30)`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
});

describe("staff view of families", () => {
  it("shows the totals and one line per family, and works for staff only", async () => {
    const db = await setup(); await work(db, AMA, "Science", "family", 60);
    await db.exec(`update public.assignments set workspace_id = (select id from public.family_workspaces where owner_user_id = '${A}') where source_type = 'family'`);
    await as(db, STAFF, true);
    const s = await one(db, "select public.qb_admin_families() as r");
    expect([Number(s.workspaces), Number(s.children_linked), Number(s.family_assignments)]).toEqual([2, 3, 1]);
    expect(s.families.map((f: any) => [f.owner, Number(f.children), Number(f.assignments)])).toEqual(expect.arrayContaining([["John Mensah", 2, 1], ["Efua Boateng", 1, 0]]));
    await as(db, A); await expect(db.query("select public.qb_admin_families()")).rejects.toThrow(/QB_FORBIDDEN/);
    await as(db, null); await expect(db.query("select public.qb_admin_families()")).rejects.toThrow(/QB_FORBIDDEN/);
  });
  it("one family in detail: children, orders and the parent's recent family actions, without changing anything", async () => {
    const db = await setup(); await as(db, A); await db.exec("select public.qb_family_open('The Mensahs')");
    const ws = await one(db, `select id::text as r from public.family_workspaces where owner_user_id = '${A}'`);
    await as(db, STAFF, true);
    const before = Number((await db.query<{ n: string }>("select count(*) n from public.account_relationships")).rows[0].n);
    const d = await one(db, `select public.qb_admin_family_detail('${ws}') as r`);
    expect(d.owner).toMatchObject({ name: "John Mensah", email: "john@x.test" });
    expect(d.children.map((c: any) => c.name)).toEqual(["Ama Mensah", "Kojo Mensah"]);
    expect(d.activity.map((a: any) => a.action)).toContain("family.child_attach");
    expect(Number((await db.query<{ n: string }>("select count(*) n from public.account_relationships")).rows[0].n)).toBe(before);
    await expect(db.query("select public.qb_admin_family_detail('00000000-0000-0000-0000-000000000000')")).rejects.toThrow(/QB_NOT_FOUND/);
  });
  it("is open to signed-in users only (the function itself checks who)", async () => {
    const db = await setup();
    const can = async (fn: string, role: string) => (await one(db, `select has_function_privilege('${role}', '${fn}', 'execute') as r`)) as boolean;
    for (const f of ["qb_family_progress(integer)", "qb_family_child_progress(uuid, integer)", "qb_admin_families()", "qb_admin_family_detail(uuid)"]) { expect(await can(`public.${f}`, "authenticated")).toBe(true); expect(await can(`public.${f}`, "anon")).toBe(false); }
  });
});
