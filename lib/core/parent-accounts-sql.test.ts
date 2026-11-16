import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Parent accounts (migration 20261087100000): a parent signs up with the parent role and is stored like a sponsor
// (profile role + a profile-type row). Runs the real migration on stand-in tables, including the real onboarding function.
const MIG = "supabase/migrations/20261087100000_parent_accounts.sql";
const A = "00000000-0000-0000-0000-0000000000a1"; // a new parent
const B = "00000000-0000-0000-0000-0000000000b1"; // an existing parent profile
const S = "00000000-0000-0000-0000-0000000000c1"; // an existing sponsor profile
const GH = "00000000-0000-0000-0000-0000000000d1";
const MKT = "00000000-0000-0000-0000-0000000000d2";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create type public.qb_role as enum ('student', 'teacher', 'admin', 'sponsor');
    create table public.profiles (id uuid primary key, role public.qb_role not null default 'student', full_name text, email text, status text not null default 'active',
      country text, school_name text, default_market_id uuid, primary_market_id uuid, onboarding_completed_at timestamptz);
    create table public.user_capabilities (user_id uuid, capability text, active boolean default true);
    create table public.institution_memberships (user_id uuid, institution_id uuid, role text, status text default 'active');
    create table public.account_relationships (source_user_id uuid, target_user_id uuid, relationship_type text, status text);
    create table public.countries (id uuid primary key default gen_random_uuid(), iso2_code text, name text, active boolean default true);
    create table public.markets (id uuid primary key default gen_random_uuid(), country_id uuid references public.countries(id), name text, status text default 'ACTIVE',
      is_test boolean default false, configuration jsonb default '{}'::jsonb, default_currency_code text, locale text, timezone text);
    create table public.user_market_memberships (user_id uuid, market_id uuid, active boolean default true, primary key (user_id, market_id));
    create table public.feature_flags (feature_code text, enabled boolean);
    create table public.platform_settings (key text primary key, value jsonb);
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql stable as $$
      select coalesce((select value = 'true'::jsonb from public.platform_settings where key = p_key limit 1), false) $$;
    insert into public.countries(id, iso2_code, name) values ('${GH}', 'GH', 'Ghana');
    insert into public.markets(id, country_id, name, configuration) values ('${MKT}', '${GH}', 'Ghana', '{"grades":[{"code":"B5","level":"primary"}]}'::jsonb);
    insert into public.profiles(id, role, full_name) values ('${S}', 'sponsor', 'Sena Org');
    insert into auth.users(id, email) values ('${A}', 'new-parent@x.test');
  `);
  await db.exec(readFileSync(MIG, "utf8"));
  await db.exec(`insert into public.profiles(id, role, full_name) values ('${B}', 'parent', 'Efua Boateng')`);
  return db;
}
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
const heldRoles = async (db: PGlite, uid: string) =>
  (await db.query<{ r: string[] }>(`select quizbox_core.held_roles('${uid}'::uuid) as r`)).rows[0].r;
const onboard = (db: PGlite, p: Record<string, unknown>) => db.query<{ r: any }>("select public.qb_complete_onboarding($1::jsonb) as r", [JSON.stringify(p)]);
const setFlag = (db: PGlite, on: boolean) =>
  db.exec(`insert into public.platform_settings(key, value) values ('flags.family_workspace', '${on}'::jsonb) on conflict (key) do update set value = excluded.value`);

describe("parent accounts", () => {
  it("adds the parent role to the profile role list", async () => {
    const db = await setup();
    const values = (await db.query<{ v: string }>("select unnest(enum_range(null::public.qb_role))::text as v")).rows.map((r) => r.v);
    expect(values).toEqual(["student", "teacher", "admin", "sponsor", "parent"]);
  });

  it("a parent profile holds parent_guardian, and a sponsor still holds sponsor_user", async () => {
    const db = await setup();
    expect(await heldRoles(db, B)).toEqual(["parent_guardian"]);
    expect(await heldRoles(db, S)).toEqual(["sponsor_user"]);
  });

  it("refuses a parent sign-up while the family workspace flag is off, and creates nothing", async () => {
    const db = await setup();
    await as(db, A);
    await expect(onboard(db, { country_code: "GH", role: "parent", full_name: "Kwame Owusu" })).rejects.toThrow(/QB_FEATURE_DISABLED/);
    expect((await db.query("select 1 from public.profiles where id = '" + A + "'")).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.parent_profiles")).rows).toHaveLength(0);
  });

  it("with the flag on, stores the parent like a sponsor: a profile role plus a parent_profiles row", async () => {
    const db = await setup();
    await setFlag(db, true);
    await as(db, A);
    const res = await onboard(db, { country_code: "GH", role: "parent", full_name: "  Kwame Owusu  " });
    expect(res.rows[0].r).toMatchObject({ role: "parent", country_code: "GH" });
    const prof = (await db.query<any>(`select role::text as role from public.profiles where id = '${A}'`)).rows[0];
    expect(prof.role).toBe("parent");
    const row = (await db.query<any>(`select full_name, country, status from public.parent_profiles where user_id = '${A}'`)).rows[0];
    expect(row).toEqual({ full_name: "Kwame Owusu", country: "Ghana", status: "ACTIVE" });
    expect(await heldRoles(db, A)).toEqual(["parent_guardian"]);
  });

  it("the parent profile is readable by its owner only, and clients cannot write it directly", async () => {
    const db = await setup();
    const can = async (role: string, priv: string) =>
      (await db.query<{ r: boolean }>(`select has_table_privilege('${role}', 'public.parent_profiles', '${priv}') as r`)).rows[0].r;
    expect(await can("authenticated", "SELECT")).toBe(true);
    expect(await can("authenticated", "INSERT")).toBe(false);
    expect(await can("authenticated", "UPDATE")).toBe(false);
    expect(await can("anon", "SELECT")).toBe(false);
    const rls = (await db.query<{ r: boolean }>("select relrowsecurity as r from pg_class where oid = 'public.parent_profiles'::regclass")).rows[0].r;
    expect(rls).toBe(true);
  });

  it("the rollback removes parent_profiles and restores the prior sign-up behaviour", async () => {
    const db = await setup();
    await db.exec(readFileSync("supabase/rollback/parent_accounts.sql", "utf8"));
    expect((await db.query<{ t: string | null }>("select to_regclass('public.parent_profiles')::text as t")).rows[0].t).toBeNull();
    expect(await heldRoles(db, S)).toEqual(["sponsor_user"]);
    await setFlag(db, true);
    await as(db, A);
    await expect(onboard(db, { country_code: "GH", role: "parent", full_name: "Kwame Owusu" })).rejects.toThrow(/QB_INVALID_ONBOARDING_ROLE/);
  });

  it("can be run again without changing anything", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG, "utf8"));
    expect(await heldRoles(db, B)).toEqual(["parent_guardian"]);
  });
});
