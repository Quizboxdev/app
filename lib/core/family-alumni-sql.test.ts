import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Alumni sponsors (migration 20261117150000): an ALUMNI sponsor cannot open a family workspace until an application is approved by staff or by the
// administrator of the named school. Parents and organizations are not affected. Runs the real migration on stand-in tables.
const MIG = "supabase/migrations/20261117150000_family_alumni_applications.sql";
const ALUM = "00000000-0000-0000-0000-0000000000a1", PARENT = "00000000-0000-0000-0000-0000000000a2", STAFF = "00000000-0000-0000-0000-0000000000a3", HEAD = "00000000-0000-0000-0000-0000000000a4", OTHER = "00000000-0000-0000-0000-0000000000a5";
const SCHOOL = "00000000-0000-0000-0000-0000000000b1", SCHOOL2 = "00000000-0000-0000-0000-0000000000b2";
const NOTE = "I attended from 1998 to 2004 and lead the old students association.", WHO = "Five pupils in Basic 9 who need support with Mathematics.";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema quizbox_core; create schema quizbox_market; create schema quizbox_ops;
    create table public.platform_settings (key text, value jsonb);
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select value = 'true'::jsonb from public.platform_settings where key = p_key limit 1), false) $$;
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, details jsonb);
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql as $$ insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, details) values (auth.uid(), p_action, p_entity_type, p_entity, p_details) $$;
    create function quizbox_core.is_staff() returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.uid', true), '') = '${STAFF}', false) $$;
    create function quizbox_market.is_super() returns boolean language sql stable as $$ select false $$;
    create function quizbox_ops.school_admin(p_inst uuid) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('test.uid', true), '') = '${HEAD}' and p_inst = '${SCHOOL}'::uuid, false) $$;
    create table public.profiles (id uuid primary key, full_name text, email text, role text);
    create table public.sponsor_profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, organization_name text, sponsor_type text);
    create table public.institutions (id uuid primary key, name text, status text default 'active');
    create table public.family_workspaces (id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.profiles(id), name text default 'My family');
    create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_role text, type text, title text, message text, entity_type text, entity_id uuid);
    insert into public.platform_settings values ('flags.family_workspace', 'true'::jsonb);
    insert into public.profiles values ('${ALUM}', 'Kojo Alumni', 'kojo@x.test', 'sponsor'), ('${PARENT}', 'Ama Parent', 'ama@x.test', 'sponsor'), ('${STAFF}', 'Staff', 's@x.test', 'admin'), ('${HEAD}', 'Head', 'h@x.test', 'teacher'), ('${OTHER}', 'Other', 'o@x.test', 'teacher');
    insert into public.sponsor_profiles(user_id, organization_name, sponsor_type) values ('${ALUM}', 'Old Students of Mfantsipim', 'ALUMNI'), ('${PARENT}', 'Ama Parent', 'INDIVIDUAL');
    insert into public.institutions values ('${SCHOOL}', 'Mfantsipim School', 'active'), ('${SCHOOL2}', 'Wesley Girls', 'active');
  `);
  await db.exec(readFileSync(MIG, "utf8"));
  return db;
}
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const apply = (db: PGlite, school = "Mfantsipim School") => one(db, `select public.qb_family_apply('${school}', '${NOTE}', '${WHO}') as r`);
const open = (db: PGlite, uid: string) => db.exec(`insert into public.family_workspaces(owner_user_id) values ('${uid}')`);

describe("alumni family applications", () => {
  it("an alumni sponsor cannot open a family workspace before approval, but a parent can", async () => {
    const db = await setup();
    await expect(open(db, ALUM)).rejects.toThrow(/QB_FAMILY_APPROVAL_REQUIRED/);
    await open(db, PARENT);
    expect((await db.query("select 1 from public.family_workspaces")).rows).toHaveLength(1);
  });

  it("only an alumni sponsor applies; a parent is told no application is needed; one open application at a time", async () => {
    const db = await setup();
    await as(db, PARENT);
    await expect(db.query(`select public.qb_family_apply('X School', '${NOTE}', '${WHO}')`)).rejects.toThrow(/QB_FAMILY_APPLICATION_NOT_NEEDED/);
    await as(db, ALUM);
    expect(await apply(db)).toMatchObject({ matched_school: true });
    await expect(apply(db)).rejects.toThrow(/QB_FAMILY_APPLICATION_EXISTS/);
    await expect(db.query(`select public.qb_family_apply('X School', 'short', '${WHO}')`)).rejects.toThrow();
  });

  it("an unknown school is accepted but not matched, so only staff can decide it", async () => {
    const db = await setup(); await as(db, ALUM);
    expect(await apply(db, "A School Not Listed")).toMatchObject({ matched_school: false });
    await as(db, HEAD);
    expect(await one(db, "select public.qb_family_applications_pending() as r")).toEqual([]);
    await as(db, STAFF);
    expect(await one(db, "select public.qb_family_applications_pending() as r")).toHaveLength(1);
  });

  it("staff approve, the applicant is told, and the workspace can then be opened", async () => {
    const db = await setup(); await as(db, ALUM); await apply(db);
    await as(db, STAFF);
    const list = await one(db, "select public.qb_family_applications_pending() as r");
    expect(list[0]).toMatchObject({ applicant_name: "Old Students of Mfantsipim", school_name: "Mfantsipim School", matched_school: true });
    await one(db, `select public.qb_family_application_decide('${list[0].id}', true, 'Checked with the school') as r`);
    expect((await db.query(`select 1 from public.notifications where recipient_user_id = '${ALUM}' and type = 'family_application_response'`)).rows).toHaveLength(1);
    await open(db, ALUM);
    await as(db, ALUM);
    expect(await one(db, "select public.qb_family_my_application() as r")).toMatchObject({ required: true, application: { status: "approved" } });
  });

  it("the school's own administrator can decide it; another user cannot", async () => {
    const db = await setup(); await as(db, ALUM); await apply(db);
    await as(db, OTHER);
    expect(await one(db, "select public.qb_family_applications_pending() as r")).toEqual([]);
    const id = (await db.query<{ id: string }>("select id from public.sponsor_family_applications")).rows[0].id;
    await expect(db.query(`select public.qb_family_application_decide('${id}', true)`)).rejects.toThrow(/QB_FORBIDDEN/);
    await as(db, HEAD);
    expect(await one(db, "select public.qb_family_applications_pending() as r")).toHaveLength(1);
    await one(db, `select public.qb_family_application_decide('${id}', true) as r`);
    await open(db, ALUM);
  });

  it("a declined applicant stays blocked and can apply again", async () => {
    const db = await setup(); await as(db, ALUM); await apply(db);
    const id = (await db.query<{ id: string }>("select id from public.sponsor_family_applications")).rows[0].id;
    await as(db, STAFF); await one(db, `select public.qb_family_application_decide('${id}', false, 'Not enough detail') as r`);
    await expect(open(db, ALUM)).rejects.toThrow(/QB_FAMILY_APPROVAL_REQUIRED/);
    await as(db, ALUM);
    expect(await apply(db)).toMatchObject({ matched_school: true });
  });

  it("clients cannot read or write applications directly, and the rollback removes the guard", async () => {
    const db = await setup();
    const can = async (priv: string) => (await db.query<{ r: boolean }>(`select has_table_privilege('authenticated', 'public.sponsor_family_applications', '${priv}') as r`)).rows[0].r;
    expect(await can("SELECT")).toBe(false);
    expect(await can("INSERT")).toBe(false);
    await db.exec(readFileSync("supabase/rollback/family_alumni_applications.sql", "utf8"));
    await open(db, ALUM);
    expect((await db.query<{ t: string | null }>("select to_regclass('public.sponsor_family_applications')::text as t")).rows[0].t).toBeNull();
  });
});
