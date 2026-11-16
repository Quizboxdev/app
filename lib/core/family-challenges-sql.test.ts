import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Family workspace phase 4b (migration 20261085100000): a parent invites chosen children to a challenge they made. Runs the real migration SQL.
const MIGS = ["20261079100000_family_workspace", "20261085100000_family_challenges"].map((m) => `supabase/migrations/${m}.sql`);
const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000a2";
const AMA = "00000000-0000-0000-0000-0000000000c1", KOJO = "00000000-0000-0000-0000-0000000000c2", SENA = "00000000-0000-0000-0000-0000000000c3";
const C1 = "00000000-0000-0000-0000-0000000000f1", C2 = "00000000-0000-0000-0000-0000000000f2", C3 = "00000000-0000-0000-0000-0000000000f3";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.platform_settings (key text, value jsonb, description text, scope_type text not null default 'global');
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select value = 'true'::jsonb from public.platform_settings where key = p_key limit 1), false) $$;
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb, created_at timestamptz default now());
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql as $$ insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, p_entity_type, p_entity, 'pass', p_details) $$;
    create table public.profiles (id uuid primary key, full_name text, email text, role text, status text default 'active');
    create table public.student_profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, grade_code text, school_name text);
    create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_role text, type text, title text, message text, entity_type text, entity_id uuid);
    create table public.challenge_campaigns (id uuid primary key, owner_id uuid, slug text, title text, visibility text, access_code text, status text, starts_at timestamptz, ends_at timestamptz, created_at timestamptz default now());
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
    insert into public.profiles(id, full_name, email, role) values ('${A}', 'John Mensah', 'j@x.test', 'teacher'), ('${B}', 'Efua Boateng', 'e@x.test', 'sponsor'),
      ('${AMA}', 'Ama Mensah', 'a@x.test', 'student'), ('${KOJO}', 'Kojo Mensah', 'k@x.test', 'student'), ('${SENA}', 'Sena Boateng', 's@x.test', 'student');
    insert into public.challenge_campaigns(id, owner_id, slug, title, visibility, access_code, status) values
      ('${C1}', '${A}', 'fractions-fun', 'Fractions fun', 'PRIVATE', 'MANGO7', 'LIVE'), ('${C2}', '${A}', 'old-one', 'Old one', 'PRIVATE', 'X1', 'ARCHIVED'), ('${C3}', '${B}', 'efua-quiz', 'Efua quiz', 'PUBLIC', null, 'LIVE');
  `);
  for (const m of MIGS) await db.exec(readFileSync(m, "utf8"));
  await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.family_workspace'`);
  const attach = (p: string, s: string, t = "parent") => db.exec(`select public.qb_family_attach_child('${p}', '${s}', '${t}')`);
  await db.exec(`insert into public.student_profiles(user_id, grade_code) values ('${AMA}', 'B5'), ('${KOJO}', 'B5'), ('${SENA}', 'B5')`);
  await attach(A, AMA); await attach(A, KOJO); await attach(B, SENA, "mentor");
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const invite = (db: PGlite, campaign: string, kids: string[]) => one(db, `select public.qb_family_invite_challenge('${campaign}', array[${kids.map((k) => `'${k}'::uuid`).join(",")}]) as r`);

describe("family challenges", () => {
  it("invites only the ticked children, tells them, and shows the parent who is invited", async () => {
    const db = await setup(); await as(db, A);
    expect(await invite(db, C1, [AMA])).toEqual({ invited: 1 });
    expect((await db.query<any>("select recipient_user_id, type from public.notifications")).rows).toEqual([{ recipient_user_id: AMA, type: "family_challenge" }]);
    const mine = await one(db, "select public.qb_family_challenges() as r");
    expect(mine.map((c: any) => [c.title, c.children.map((k: any) => k.name)])).toEqual([["Fractions fun", ["Ama Mensah"]]]);
    await as(db, AMA); const got = await one(db, "select public.qb_family_my_challenges() as r");
    expect(got.map((c: any) => [c.title, c.access_code, c.from])).toEqual([["Fractions fun", "MANGO7", "John Mensah"]]);
    await as(db, KOJO); expect(await one(db, "select public.qb_family_my_challenges() as r")).toEqual([]);
  });
  it("inviting twice does not notify twice, and several children can be ticked at once", async () => {
    const db = await setup(); await as(db, A);
    await invite(db, C1, [AMA]); expect(await invite(db, C1, [AMA, KOJO])).toEqual({ invited: 1 });
    expect((await db.query("select 1 from public.family_challenge_invites")).rows).toHaveLength(2);
  });
  it("refuses a challenge the parent does not own, an archived one, a child who is not theirs or may not be given challenges, and an empty list", async () => {
    const db = await setup(); await as(db, A);
    await expect(invite(db, C3, [AMA])).rejects.toThrow(/QB_NOT_FOUND/);
    await expect(invite(db, C2, [AMA])).rejects.toThrow(/QB_NOT_FOUND/);
    await expect(invite(db, C1, [SENA])).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await expect(db.query(`select public.qb_family_invite_challenge('${C1}', array[]::uuid[])`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await as(db, B); await expect(invite(db, C3, [SENA])).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    expect((await db.query("select 1 from public.family_challenge_invites")).rows).toHaveLength(0);
  });
  it("the code is only shown for a private challenge, and an ended or paused challenge drops off the child's list", async () => {
    const db = await setup(); await db.exec(`update public.challenge_campaigns set visibility = 'PUBLIC' where id = '${C1}'`); await as(db, A);
    await invite(db, C1, [AMA]); await as(db, AMA);
    expect((await one(db, "select public.qb_family_my_challenges() as r"))[0].access_code).toBeNull();
    await db.exec(`update public.challenge_campaigns set ends_at = now() - interval '1 day' where id = '${C1}'`);
    expect(await one(db, "select public.qb_family_my_challenges() as r")).toEqual([]);
    await db.exec(`update public.challenge_campaigns set ends_at = null, status = 'PAUSED' where id = '${C1}'`);
    expect(await one(db, "select public.qb_family_my_challenges() as r")).toEqual([]);
  });
  it("the parent can take an invitation back; another parent cannot", async () => {
    const db = await setup(); await as(db, A); await invite(db, C1, [AMA, KOJO]);
    await db.exec(`select public.qb_family_uninvite_challenge('${C1}', '${KOJO}')`);
    expect((await one(db, "select public.qb_family_challenges() as r"))[0].children.map((k: any) => k.name)).toEqual(["Ama Mensah"]);
    await as(db, B); await expect(db.query(`select public.qb_family_uninvite_challenge('${C1}', '${AMA}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
  it("a removed child drops out of the parent's view, and the flag and sign-in are enforced", async () => {
    const db = await setup(); await as(db, A); await invite(db, C1, [AMA, KOJO]); await db.exec(`select public.qb_family_revoke('${KOJO}')`);
    expect((await one(db, "select public.qb_family_challenges() as r"))[0].children.map((k: any) => k.name)).toEqual(["Ama Mensah"]);
    await as(db, null); await expect(db.query("select public.qb_family_challenges()")).rejects.toThrow(/QB_AUTH_REQUIRED/);
    await db.exec("update public.platform_settings set value = 'false'::jsonb where key = 'flags.family_workspace'"); await as(db, A);
    await expect(invite(db, C1, [AMA])).rejects.toThrow(/QB_FEATURE_DISABLED/);
  });
  it("is for signed-in users only", async () => {
    const db = await setup();
    const can = async (fn: string, role: string) => (await one(db, `select has_function_privilege('${role}', '${fn}', 'execute') as r`)) as boolean;
    for (const f of ["qb_family_challenges()", "qb_family_invite_challenge(uuid, uuid[])", "qb_family_uninvite_challenge(uuid, uuid)", "qb_family_my_challenges()"]) { expect(await can(`public.${f}`, "authenticated")).toBe(true); expect(await can(`public.${f}`, "anon")).toBe(false); }
  });
});
