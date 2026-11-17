import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Parents sign up as sponsors (migrations 20261087100000 and 20261117110000). The parent role value and parent_profiles remain from 20261087,
// but onboarding no longer accepts the parent role. Runs the real migrations on stand-in tables, including the real onboarding function.
const MIG_PARENT = "supabase/migrations/20261087100000_parent_accounts.sql";
const MIG_SPONSOR = "supabase/migrations/20261117110000_parents_sign_up_as_sponsor.sql";
const A = "00000000-0000-0000-0000-0000000000a1"; // a new parent (signing up)
const B = "00000000-0000-0000-0000-0000000000b1"; // an existing parent profile from before the change
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
    create table public.sponsor_profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, organization_name text, contact_name text, country text, status text, sponsor_type text, verification_status text);
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
  await db.exec(readFileSync(MIG_PARENT, "utf8"));
  await db.exec(readFileSync(MIG_SPONSOR, "utf8"));
  await db.exec(`insert into public.profiles(id, role, full_name) values ('${B}', 'parent', 'Efua Boateng')`);
  return db;
}
const as = (db: PGlite, uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
const heldRoles = async (db: PGlite, uid: string) =>
  (await db.query<{ r: string[] }>(`select quizbox_core.held_roles('${uid}'::uuid) as r`)).rows[0].r;
const onboard = (db: PGlite, p: Record<string, unknown>) => db.query<{ r: any }>("select public.qb_complete_onboarding($1::jsonb) as r", [JSON.stringify(p)]);
const setFlag = (db: PGlite, on: boolean) =>
  db.exec(`insert into public.platform_settings(key, value) values ('flags.family_workspace', '${on}'::jsonb) on conflict (key) do update set value = excluded.value`);
const sponsorSignUp = { country_code: "GH", role: "sponsor", organization_name: "Kwame Owusu", contact_name: "Kwame Owusu", contact_email: "kwame@x.test" };

describe("parents sign up as sponsors", () => {
  it("keeps the parent role value in the profile role list (it cannot be removed from an enum)", async () => {
    const db = await setup();
    const values = (await db.query<{ v: string }>("select unnest(enum_range(null::public.qb_role))::text as v")).rows.map((r) => r.v);
    expect(values).toEqual(["student", "teacher", "admin", "sponsor", "parent"]);
  });

  it("a parent profile from before still holds parent_guardian, and a sponsor still holds sponsor_user", async () => {
    const db = await setup();
    expect(await heldRoles(db, B)).toEqual(["parent_guardian"]);
    expect(await heldRoles(db, S)).toEqual(["sponsor_user"]);
  });

  it("refuses the parent role at sign-up, with the flag on or off, and creates nothing", async () => {
    const db = await setup();
    await as(db, A);
    await expect(onboard(db, { country_code: "GH", role: "parent", full_name: "Kwame Owusu" })).rejects.toThrow(/QB_INVALID_ONBOARDING_ROLE/);
    await setFlag(db, true);
    await expect(onboard(db, { country_code: "GH", role: "parent", full_name: "Kwame Owusu" })).rejects.toThrow(/QB_INVALID_ONBOARDING_ROLE/);
    expect((await db.query("select 1 from public.profiles where id = '" + A + "'")).rows).toHaveLength(0);
    expect((await db.query("select 1 from public.sponsor_profiles")).rows).toHaveLength(0);
  });

  it("a parent signs up as a sponsor and is marked INDIVIDUAL, not an organization", async () => {
    const db = await setup();
    await as(db, A);
    const res = await onboard(db, { ...sponsorSignUp, sponsor_type: "INDIVIDUAL" });
    expect(res.rows[0].r).toMatchObject({ role: "sponsor", country_code: "GH" });
    expect((await db.query<any>(`select role::text as role from public.profiles where id = '${A}'`)).rows[0].role).toBe("sponsor");
    const row = (await db.query<any>(`select organization_name, sponsor_type, verification_status from public.sponsor_profiles where user_id = '${A}'`)).rows[0];
    expect(row).toEqual({ organization_name: "Kwame Owusu", sponsor_type: "INDIVIDUAL", verification_status: "PENDING" });
    expect(await heldRoles(db, A)).toEqual(["sponsor_user"]);
  });

  it("an organization that does not say otherwise is still recorded as an ORGANIZATION", async () => {
    const db = await setup();
    await as(db, A);
    await onboard(db, sponsorSignUp);
    const type = (await db.query<{ t: string }>(`select sponsor_type as t from public.sponsor_profiles where user_id = '${A}'`)).rows[0].t;
    expect(type).toBe("ORGANIZATION");
  });

  it("refuses an unknown sponsor type and a sponsor without a name or email", async () => {
    const db = await setup();
    await as(db, A);
    await expect(onboard(db, { ...sponsorSignUp, sponsor_type: "COMPANY" })).rejects.toThrow(/QB_INVALID_SPONSOR_TYPE/);
    await expect(onboard(db, { ...sponsorSignUp, organization_name: "", sponsor_type: "INDIVIDUAL" })).rejects.toThrow(/QB_SPONSOR_DETAILS_REQUIRED/);
  });

  it("the parent profile from before is readable by its owner only, and clients cannot write it directly", async () => {
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

  it("the rollback of this change puts the 20261087 parent sign-up back", async () => {
    const db = await setup();
    await db.exec(readFileSync("supabase/rollback/parents_sign_up_as_sponsor.sql", "utf8"));
    await setFlag(db, true);
    await as(db, A);
    const res = await onboard(db, { country_code: "GH", role: "parent", full_name: "Kwame Owusu" });
    expect(res.rows[0].r).toMatchObject({ role: "parent" });
  });

  it("the rollback of 20261087 removes parent_profiles, and sponsors still sign up", async () => {
    const db = await setup();
    await db.exec(readFileSync("supabase/rollback/parent_accounts.sql", "utf8"));
    expect((await db.query<{ t: string | null }>("select to_regclass('public.parent_profiles')::text as t")).rows[0].t).toBeNull();
    expect(await heldRoles(db, S)).toEqual(["sponsor_user"]);
    await as(db, A);
    await onboard(db, sponsorSignUp);
    expect((await db.query(`select 1 from public.sponsor_profiles where user_id = '${A}'`)).rows).toHaveLength(1);
  });

  it("can be run again without changing anything", async () => {
    const db = await setup();
    await db.exec(readFileSync(MIG_SPONSOR, "utf8"));
    await as(db, A);
    await onboard(db, { ...sponsorSignUp, sponsor_type: "INDIVIDUAL" });
    expect(await heldRoles(db, B)).toEqual(["parent_guardian"]);
  });
});
