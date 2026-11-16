import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Family workspace phase 1 (migration 20261079100000): relationship-scoped authorisation. Runs the real migration SQL on a small stand-in schema.
// The tests include the "change the student id" (IDOR) attempts: a parent can only act on a child they are actively linked to, with that permission.
const MIG = "supabase/migrations/20261079100000_family_workspace.sql";
const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000a2", T = "00000000-0000-0000-0000-0000000000a3";
const AMA = "00000000-0000-0000-0000-0000000000c1", KOJO = "00000000-0000-0000-0000-0000000000c2", SENA = "00000000-0000-0000-0000-0000000000c3";

async function setup(flag = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.platform_settings (key text, value jsonb, description text, scope_type text not null default 'global');
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select value = 'true'::jsonb from public.platform_settings where key = p_key limit 1), false) $$;
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb, created_at timestamptz default now());
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql as $$ insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, p_entity_type, p_entity, 'pass', p_details) $$;
    create table public.profiles (id uuid primary key, full_name text, role text);
    create table public.student_profiles (user_id uuid primary key, grade_code text, school_name text);
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
    insert into public.profiles values ('${A}', 'John Mensah', 'teacher'), ('${B}', 'Efua Boateng', 'sponsor'), ('${T}', 'Mr Mensah', 'teacher'),
      ('${AMA}', 'Ama Mensah', 'student'), ('${KOJO}', 'Kojo Mensah', 'student'), ('${SENA}', 'Sena Boateng', 'student');
    insert into public.student_profiles values ('${AMA}', 'B8', 'XYZ Academy'), ('${KOJO}', 'B5', null), ('${SENA}', 'B7', null);
    insert into public.platform_settings(key, value, scope_type) values ('flags.family_workspace_seed', 'false'::jsonb, 'global');
  `);
  await db.exec(readFileSync(MIG, "utf8"));
  if (flag) await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.family_workspace'`);
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const attach = (db: PGlite, parent: string, student: string, type = "parent") => one(db, `select public.qb_family_attach_child('${parent}', '${student}', '${type}') as r`);

describe("family workspace: opening", () => {
  it("opens one workspace for an adult, and again returns the same one", async () => {
    const db = await setup(); await as(db, A);
    const a = await one(db, "select public.qb_family_open('The Mensahs') as r"), b = await one(db, "select public.qb_family_open() as r");
    expect(a.id).toBe(b.id); expect(a.name).toBe("The Mensahs");
    expect((await db.query("select 1 from public.audit_logs where action = 'family.workspace_open'")).rows).toHaveLength(1);
  });
  it("refuses a student, a signed-out caller, and everything while the flag is off", async () => {
    const db = await setup(); await as(db, AMA);
    await expect(db.query("select public.qb_family_open()")).rejects.toThrow(/QB_FAMILY_NOT_ADULT/);
    await as(db, null); await expect(db.query("select public.qb_family_open()")).rejects.toThrow(/QB_AUTH_REQUIRED/);
    const off = await setup(false); await as(off, A);
    await expect(off.query("select public.qb_family_open()")).rejects.toThrow(/QB_FEATURE_DISABLED/);
    await expect(off.query("select public.qb_family_children()")).rejects.toThrow(/QB_FEATURE_DISABLED/);
  });
});

describe("family workspace: linking and listing", () => {
  it("lists only the caller's own children, with names, class and permissions", async () => {
    const db = await setup();
    await attach(db, A, AMA); await attach(db, A, KOJO); await attach(db, B, SENA, "academic_parent");
    await as(db, A);
    const kids = await one(db, "select public.qb_family_children() as r");
    expect(kids.map((k: any) => k.full_name)).toEqual(["Ama Mensah", "Kojo Mensah"]);
    expect(kids[0]).toMatchObject({ grade_code: "B8", school_name: "XYZ Academy", relationship_type: "parent", status: "active" });
    await as(db, B);
    expect((await one(db, "select public.qb_family_children() as r")).map((k: any) => k.full_name)).toEqual(["Sena Boateng"]);
  });
  it("linking twice does not duplicate the relationship, and a student cannot be the parent", async () => {
    const db = await setup(); await attach(db, A, AMA); await attach(db, A, AMA);
    expect((await db.query("select 1 from public.account_relationships")).rows).toHaveLength(1);
    await expect(attach(db, AMA, KOJO)).rejects.toThrow(/QB_FAMILY_NOT_ADULT/);
    await expect(attach(db, A, T)).rejects.toThrow(/QB_FAMILY_INVALID/);
  });
  it("lets the existing checkout work: can_fund mirrors buy_coins, so the payer rule passes for a parent", async () => {
    const db = await setup(); await attach(db, A, AMA); await attach(db, A, KOJO, "parent");
    const r = await db.query<{ can_fund: boolean }>("select can_fund from public.account_relationships where source_user_id = '" + A + "' limit 1");
    expect(r.rows[0].can_fund).toBe(true);
  });
});

describe("family workspace: authorisation (IDOR)", () => {
  it("a parent reads their own child and is refused another family's child", async () => {
    const db = await setup(); await attach(db, A, AMA); await attach(db, B, SENA);
    await as(db, A);
    expect((await one(db, `select public.qb_family_child_summary('${AMA}') as r`)).full_name).toBe("Ama Mensah");
    await expect(db.query(`select public.qb_family_child_summary('${SENA}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    expect(await one(db, `select public.qb_family_can('${SENA}', 'view_progress') as r`)).toBe(false);
    expect(await one(db, `select public.qb_family_can('${AMA}', 'buy_coins') as r`)).toBe(true);
  });
  it("is refused for a signed-out caller, an unknown permission, and a child of nobody", async () => {
    const db = await setup(); await attach(db, A, AMA);
    await as(db, null); await expect(db.query(`select public.qb_family_child_summary('${AMA}')`)).rejects.toThrow(/QB_AUTH_REQUIRED/);
    expect(await one(db, `select public.qb_family_can('${AMA}', 'view_progress') as r`)).toBe(false);
    await as(db, A);
    expect(await one(db, `select public.qb_family_can('${AMA}', 'delete_everything') as r`)).toBe(false);
    await expect(db.query(`select public.qb_family_child_summary('${KOJO}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
  it("permissions are per relationship: a mentor can look but not assign or buy; an academic parent cannot manage access", async () => {
    const db = await setup(); await attach(db, A, AMA, "mentor"); await attach(db, B, AMA, "academic_parent");
    await as(db, A);
    expect(await one(db, `select public.qb_family_can('${AMA}', 'view_progress') as r`)).toBe(true);
    for (const p of ["assign", "buy_coins", "buy_subscription", "buy_questions"]) expect(await one(db, `select public.qb_family_can('${AMA}', '${p}') as r`)).toBe(false);
    await as(db, B);
    expect(await one(db, `select public.qb_family_can('${AMA}', 'assign') as r`)).toBe(true);
    expect(await one(db, `select public.qb_family_can('${AMA}', 'manage_access') as r`)).toBe(false);
  });
  it("an old-style guardian or sponsor relationship (no family workspace) gives no family access", async () => {
    const db = await setup();
    await db.exec(`insert into public.account_relationships(source_user_id, target_user_id, relationship_type, status, can_fund, can_view_progress, consent_status, verified_by) values ('${T}', '${AMA}', 'guardian', 'active', true, true, 'granted', '${T}')`);
    await as(db, T);
    expect(await one(db, `select public.qb_family_can('${AMA}', 'view_progress') as r`)).toBe(false);
    await expect(db.query(`select public.qb_family_child_summary('${AMA}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
  it("a pending, suspended or expired link grants nothing", async () => {
    const db = await setup(); await attach(db, A, AMA); await as(db, A);
    for (const sql of ["status = 'pending_verification'", "status = 'suspended'", "status = 'active', valid_until = now() + interval '1 second', valid_from = now() - interval '1 day'", "status = 'active', consent_status = 'withdrawn'"]) {
      await db.exec(`update public.account_relationships set status = 'active', consent_status = 'granted', valid_until = null`);
      await db.exec(`update public.account_relationships set ${sql}`);
      if (sql.includes("valid_until")) await db.exec(`update public.account_relationships set valid_from = now() - interval '2 days', valid_until = now() - interval '1 day'`);
      expect(await one(db, `select public.qb_family_can('${AMA}', 'view_progress') as r`)).toBe(false);
    }
  });
});

describe("family workspace: revoking", () => {
  it("ends the parent's access at once and leaves the student account and other links intact", async () => {
    const db = await setup(); await attach(db, A, AMA); await attach(db, B, AMA, "academic_parent");
    await as(db, A);
    expect((await one(db, `select public.qb_family_revoke('${AMA}') as r`)).revoked).toBe(1);
    await expect(db.query(`select public.qb_family_child_summary('${AMA}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    expect((await db.query(`select 1 from public.profiles where id = '${AMA}'`)).rows).toHaveLength(1);
    await as(db, B);
    expect((await one(db, `select public.qb_family_child_summary('${AMA}') as r`)).full_name).toBe("Ama Mensah");
    expect((await db.query("select 1 from public.audit_logs where action = 'family.child_unlink'")).rows).toHaveLength(1);
  });
  it("cannot be used on a child you are not linked to", async () => {
    const db = await setup(); await attach(db, B, SENA); await as(db, A);
    await expect(db.query(`select public.qb_family_revoke('${SENA}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
});

describe("family workspace: privileges", () => {
  it("the attach function is for the server only; the parent-facing ones are open to signed-in users", async () => {
    const db = await setup();
    const can = async (fn: string) => (await one(db, `select has_function_privilege('authenticated', '${fn}', 'execute') as r`)) as boolean;
    expect(await can("public.qb_family_attach_child(uuid, uuid, text)")).toBe(false);
    expect(await can("quizbox_core.family_can(uuid, uuid, text)")).toBe(false);
    for (const f of ["qb_family_open(text)", "qb_family_children()", "qb_family_child_summary(uuid)", "qb_family_revoke(uuid)", "qb_family_can(uuid, text)"]) expect(await can(`public.${f}`)).toBe(true);
    expect(await one(db, "select has_function_privilege('anon', 'public.qb_family_children()', 'execute') as r")).toBe(false);
  });
});
