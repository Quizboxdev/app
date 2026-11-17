import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Family workspace phase 2 (migration 20261080100000): adding a child, the single-use invitation, and linking an existing student. Runs the real migration SQL.
const MIGS = ["supabase/migrations/20261079100000_family_workspace.sql", "supabase/migrations/20261080100000_family_children.sql", "supabase/migrations/20261117120000_family_sponsor_links.sql"];
const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000a2", T = "00000000-0000-0000-0000-0000000000a3";
const KID = "00000000-0000-0000-0000-0000000000c1", KID2 = "00000000-0000-0000-0000-0000000000c2", EXIST = "00000000-0000-0000-0000-0000000000c3", MANAGED = "00000000-0000-0000-0000-0000000000c4";
const MKT = "00000000-0000-0000-0000-0000000000d1";

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
    insert into public.markets values ('${MKT}', '{"grades":[{"code":"B5","level":"primary"},{"code":"B8","level":"jhs"}]}');
    create type public.qb_grade as enum ('B5', 'B8');
    create table public.profiles (id uuid primary key, full_name text, email text, role text, status text default 'active', country text, school_name text, default_market_id uuid, primary_market_id uuid, onboarding_completed_at timestamptz);
    create table public.student_profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, grade public.qb_grade, grade_code text, education_level text, school_name text, country text, status text, managed_by uuid, is_minor boolean default false, archived_at timestamptz, subjects text[]);
    create table public.user_market_memberships (user_id uuid, market_id uuid, active boolean, primary key (user_id, market_id));
    create table public.learner_consent (user_id uuid primary key, status text, policy_ref text, decided_by uuid, decided_at timestamptz, updated_at timestamptz default now());
    create table public.notifications (id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_role text, type text, title text, message text, entity_type text, entity_id uuid);
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
    insert into public.profiles(id, full_name, email, role, country, primary_market_id) values
      ('${A}', 'John Mensah', 'john@x.test', 'teacher', 'Ghana', '${MKT}'), ('${B}', 'Efua Boateng', 'efua@x.test', 'sponsor', 'Ghana', '${MKT}'), ('${T}', 'Mr Mensah', 't@x.test', 'teacher', 'Ghana', '${MKT}'),
      ('${EXIST}', 'Esi Owusu', 'esi@x.test', 'student', 'Ghana', '${MKT}'), ('${MANAGED}', 'Yaw', 'yaw.abcd@learners.quizbox.io', 'student', 'Ghana', '${MKT}');
    insert into public.student_profiles(user_id, grade_code, status, managed_by, is_minor) values ('${EXIST}', 'B8', 'active', null, false), ('${MANAGED}', 'B5', 'active', '${T}', true);
    insert into auth.users values ('${KID}', 'ama.k7f2@learners.quizbox.io'), ('${KID2}', 'kojo.m2p9@learners.quizbox.io');
  `);
  for (const m of MIGS) await db.exec(readFileSync(m, "utf8"));
  await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.family_workspace'`);
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const provision = (db: PGlite, parent: string, user: string, over: Record<string, any> = {}) => {
  const a = { first: "Ama", last: "Mensah", display: "", age: 11, grade: "B5", school: "XYZ Academy", username: "ama.k7f2", consent: "parent-attested", ...over };
  return one(db, `select public.qb_family_child_provision('${parent}', '${user}', '${a.first}', '${a.last}', '${a.display}', ${a.age}, '${a.grade}', '${a.school}', '${a.username}', '${a.consent}') as r`);
};
const issue = async (db: PGlite, student: string) => (await one(db, `select public.qb_family_invite_issue('${student}') as r`)).token as string;

describe("add a child", () => {
  it("creates an ordinary student linked to the parent's workspace, with the consent and an audit entry", async () => {
    const db = await setup();
    const r = await provision(db, A, KID);
    expect(r).toMatchObject({ username: "ama.k7f2", is_minor: true });
    expect((await db.query("select role, full_name, school_name from public.profiles where id = '" + KID + "'")).rows[0]).toEqual({ role: "student", full_name: "Ama Mensah", school_name: "XYZ Academy" });
    expect((await db.query("select grade_code, education_level, managed_by, is_minor from public.student_profiles where user_id = '" + KID + "'")).rows[0]).toEqual({ grade_code: "B5", education_level: "primary", managed_by: A, is_minor: true });
    expect((await db.query("select status from public.learner_consent where user_id = '" + KID + "'")).rows[0]).toEqual({ status: "granted" });
    await as(db, A);
    expect((await one(db, "select public.qb_family_children() as r")).map((k: any) => [k.full_name, k.status])).toEqual([["Ama Mensah", "active"]]);
    expect((await db.query("select 1 from public.audit_logs where action = 'family.child_create'")).rows).toHaveLength(1);
  });
  it("a child aged 13 or over is an ordinary independent student (not managed)", async () => {
    const db = await setup(); await provision(db, A, KID, { age: 14, grade: "B8" });
    expect((await db.query("select managed_by, is_minor from public.student_profiles where user_id = '" + KID + "'")).rows[0]).toEqual({ managed_by: null, is_minor: false });
  });
  it("five children can be added, and each is visible only to their own parent", async () => {
    const db = await setup();
    for (let i = 0; i < 5; i++) { const id = `00000000-0000-0000-0000-00000000f00${i}`; await db.exec(`insert into auth.users values ('${id}', 'k${i}@learners.quizbox.io')`); await provision(db, A, id, { first: "Kofi", username: `kofi.aaa${i}` }); }
    await provision(db, B, KID2, { first: "Sena", username: "sena.zzzz" });
    await as(db, A); expect(await one(db, "select jsonb_array_length(public.qb_family_children()) as r")).toBe(5);
    await as(db, B); expect((await one(db, "select public.qb_family_children() as r")).map((k: any) => k.full_name)).toEqual(["Sena Mensah"]);
  });
  it("refuses a student as the parent, a grade the market does not offer, a bad name, a bad age and a missing consent", async () => {
    const db = await setup();
    await expect(provision(db, EXIST, KID)).rejects.toThrow(/QB_FAMILY_NOT_ADULT/);
    await expect(provision(db, A, KID, { grade: "B99" })).rejects.toThrow(/QB_FAMILY_GRADE_INVALID/);
    await expect(provision(db, A, KID, { first: "A1" })).rejects.toThrow(/QB_FAMILY_NAME_INVALID/);
    await expect(provision(db, A, KID, { age: 2 })).rejects.toThrow(/QB_FAMILY_AGE_INVALID/);
    await expect(provision(db, A, KID, { consent: "yes" })).rejects.toThrow(/QB_FAMILY_CONSENT_REQUIRED/);
    await expect(provision(db, A, KID, { username: "Bad Name" })).rejects.toThrow(/QB_FAMILY_USERNAME_INVALID/);
  });
});

describe("the single-use invitation", () => {
  it("is issued to the parent only, stored as a hash, and can be used exactly once", async () => {
    const db = await setup(); await provision(db, A, KID); await as(db, A);
    const token = await issue(db, KID);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect((await db.query<{ token_hash: string }>("select token_hash from public.family_invitations")).rows[0].token_hash).not.toContain(token);
    expect(await one(db, `select public.qb_family_invite_peek('${token}') as r`)).toEqual({ valid: true, first_name: "Ama" });
    expect(await one(db, `select public.qb_family_invite_consume('${token}') as r`)).toEqual({ student_id: KID, username: "ama.k7f2" });
    await expect(db.query(`select public.qb_family_invite_consume('${token}')`)).rejects.toThrow(/QB_INVITE_INVALID/);
    expect(await one(db, `select public.qb_family_invite_peek('${token}') as r`)).toEqual({ valid: false });
  });
  it("another parent cannot issue or revoke a link for this child", async () => {
    const db = await setup(); await provision(db, A, KID); await as(db, B);
    await expect(db.query(`select public.qb_family_invite_issue('${KID}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await expect(db.query(`select public.qb_family_invite_revoke('${KID}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
  it("resending makes the earlier link stop working, and revoking cancels it", async () => {
    const db = await setup(); await provision(db, A, KID); await as(db, A);
    const first = await issue(db, KID), second = await issue(db, KID);
    await expect(db.query(`select public.qb_family_invite_consume('${first}')`)).rejects.toThrow(/QB_INVITE_INVALID/);
    await db.exec(`select public.qb_family_invite_revoke('${KID}')`);
    await expect(db.query(`select public.qb_family_invite_consume('${second}')`)).rejects.toThrow(/QB_INVITE_INVALID/);
  });
  it("an expired link and a made-up token fail", async () => {
    const db = await setup(); await provision(db, A, KID); await as(db, A);
    const token = await issue(db, KID);
    await db.exec("update public.family_invitations set expires_at = now() - interval '1 minute'");
    await expect(db.query(`select public.qb_family_invite_consume('${token}')`)).rejects.toThrow(/QB_INVITE_INVALID/);
    expect(await one(db, "select public.qb_family_invite_peek('nope') as r")).toEqual({ valid: false });
    await expect(db.query("select public.qb_family_invite_consume('')")).rejects.toThrow(/QB_INVITE_INVALID/);
  });
  it("a revoked family link stops the parent issuing new invitations", async () => {
    const db = await setup(); await provision(db, A, KID); await as(db, A);
    await db.exec(`select public.qb_family_revoke('${KID}')`);
    await expect(db.query(`select public.qb_family_invite_issue('${KID}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
});

describe("link an existing student", () => {
  it("gives the same answer whether or not the account exists, and shares nothing until the student accepts", async () => {
    const db = await setup(); await as(db, A);
    const found = await one(db, "select public.qb_family_link_request('esi@x.test') as r"), missing = await one(db, "select public.qb_family_link_request('nobody@x.test') as r");
    expect(found).toEqual(missing);
    const list = await one(db, "select public.qb_family_children() as r");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "requested", full_name: null, grade_code: null, student_id: null, label: "esi@x.test" });
    await expect(db.query(`select public.qb_family_child_summary('${EXIST}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    expect((await db.query("select 1 from public.notifications where recipient_user_id = '" + EXIST + "' and type = 'family_link_request'")).rows).toHaveLength(1);
  });
  it("the student sees the request and accepting opens access (and declining closes it)", async () => {
    const db = await setup(); await as(db, A); await db.exec("select public.qb_family_link_request('esi@x.test')");
    await as(db, EXIST);
    const reqs = await one(db, "select public.qb_family_my_requests() as r");
    expect(reqs).toHaveLength(1); expect(reqs[0].parent_name).toBe("John Mensah");
    await db.exec(`select public.qb_family_link_respond('${reqs[0].id}', true)`);
    await as(db, A);
    expect((await one(db, `select public.qb_family_child_summary('${EXIST}') as r`)).full_name).toBe("Esi Owusu");
    expect(await one(db, `select public.qb_family_can('${EXIST}', 'manage_access') as r`)).toBe(false);
    const db2 = await setup(); await as(db2, A); await db2.exec("select public.qb_family_link_request('esi@x.test')"); await as(db2, EXIST);
    const r2 = await one(db2, "select public.qb_family_my_requests() as r");
    await db2.exec(`select public.qb_family_link_respond('${r2[0].id}', false)`);
    await as(db2, A); await expect(db2.query(`select public.qb_family_child_summary('${EXIST}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
  });
  it("only the named student can answer, and a managed child cannot be linked this way", async () => {
    const db = await setup(); await as(db, A); await db.exec("select public.qb_family_link_request('esi@x.test')");
    await as(db, EXIST); const id = (await one(db, "select public.qb_family_my_requests() as r"))[0].id;
    await as(db, B); await expect(db.query(`select public.qb_family_link_respond('${id}', true)`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await as(db, A); await db.exec("select public.qb_family_link_request('yaw.abcd@learners.quizbox.io')");
    expect(await one(db, "select jsonb_array_length(public.qb_family_children()) as r")).toBe(1);
  });
  it("a repeated request does not create a second one, and is rate limited", async () => {
    const db = await setup(); await as(db, A);
    await db.exec("select public.qb_family_link_request('esi@x.test')"); await db.exec("select public.qb_family_link_request('esi@x.test')");
    expect((await db.query("select 1 from public.account_relationships")).rows).toHaveLength(1);
    for (let i = 0; i < 12; i++) { await db.exec(`insert into public.profiles(id, full_name, email, role) values ('00000000-0000-0000-0000-00000000e0${String(i).padStart(2, "0")}', 'S${i}', 's${i}@x.test', 'student')`); }
    let blocked = false;
    for (let i = 0; i < 12 && !blocked; i++) { try { await db.exec(`select public.qb_family_link_request('s${i}@x.test')`); } catch (e) { blocked = /QB_RATE_LIMITED/.test(String(e)); } }
    expect(blocked).toBe(true);
  });
  it("is refused for a student asking, and while the flag is off", async () => {
    const db = await setup(); await as(db, EXIST);
    await expect(db.query("select public.qb_family_link_request('esi@x.test')")).rejects.toThrow(/QB_FAMILY_NOT_ADULT/);
    await db.exec("update public.platform_settings set value = 'false'::jsonb where key = 'flags.family_workspace'"); await as(db, A);
    await expect(db.query("select public.qb_family_link_request('esi@x.test')")).rejects.toThrow(/QB_FEATURE_DISABLED/);
  });
});

describe("a sponsor links as a sponsor", () => {
  const link = async (db: PGlite, who: string) => {
    await as(db, who); await db.exec("select public.qb_family_link_request('esi@x.test')");
    return (await db.query<any>(`select relationship_type, permissions from public.account_relationships where source_user_id = '${who}' and target_user_id = '${EXIST}'`)).rows[0];
  };
  it("a sponsor's request is a sponsor link with sponsor permissions only, and the student is told so", async () => {
    const db = await setup();
    const rel = await link(db, B);
    expect(rel.relationship_type).toBe("sponsor");
    expect(rel.permissions).toEqual({ view_progress: true, buy_coins: true, buy_subscription: true });
    const msg = (await db.query<any>(`select message from public.notifications where recipient_user_id = '${EXIST}' and type = 'family_link_request'`)).rows[0].message;
    expect(msg).toContain("as your sponsor");
  });
  it("a sponsor cannot assign work or challenges through a sponsor link", async () => {
    const db = await setup();
    const rel = await link(db, B);
    expect(rel.permissions.assign).toBeUndefined();
    expect(rel.permissions.create_challenge).toBeUndefined();
  });
  it("any other adult's request is still a parent link with the full parent permissions", async () => {
    const db = await setup();
    const rel = await link(db, A);
    expect(rel.relationship_type).toBe("parent");
    expect(rel.permissions).toMatchObject({ view_progress: true, assign: true, create_challenge: true, buy_coins: true, buy_subscription: true });
    const msg = (await db.query<any>(`select message from public.notifications where recipient_user_id = '${EXIST}' and type = 'family_link_request'`)).rows[0].message;
    expect(msg).toContain("as your parent");
  });
});

describe("privileges", () => {
  it("provision, peek and consume are server-only; the parent and student functions are open to signed-in users", async () => {
    const db = await setup();
    const can = async (fn: string, role = "authenticated") => (await one(db, `select has_function_privilege('${role}', '${fn}', 'execute') as r`)) as boolean;
    for (const f of ["qb_family_child_provision(uuid, uuid, text, text, text, integer, text, text, text, text)", "qb_family_invite_peek(text)", "qb_family_invite_consume(text)"]) expect(await can(`public.${f}`)).toBe(false);
    for (const f of ["qb_family_invite_issue(uuid)", "qb_family_invite_revoke(uuid)", "qb_family_link_request(text)", "qb_family_my_requests()", "qb_family_link_respond(uuid, boolean)"]) { expect(await can(`public.${f}`)).toBe(true); expect(await can(`public.${f}`, "anon")).toBe(false); }
  });
});
