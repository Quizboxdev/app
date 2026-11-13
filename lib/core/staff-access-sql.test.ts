import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Staff access (20261070100000), on an isolated PostgreSQL. A super admin gives a colleague connected workflows by email; each is a capability the database already enforces.
// Closed until flags.staff_access is on; only a super admin can use it; other capabilities and other super admins are never touched.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261070100000_staff_access.sql");
const ROLLBACK = read("../../supabase/rollback/staff_access.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [BOSS, OTHER_BOSS, EFUA, KOFI, TEACHER, GONE, OWNER] = [1, 2, 3, 4, 5, 6, 7].map(id);
let db: PGlite;
const as = async (user: string | null) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec("set role authenticated"); };
const admin = async () => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); };
const setFlag = async (on: boolean) => { await admin(); await db.query("update public.platform_settings set value = $1::jsonb where key = 'flags.staff_access'", [JSON.stringify(on)]); };
const one = async (sql: string, params: unknown[] = []) => (await db.query<{ v: any }>(sql, params)).rows[0].v;
const set = (user: string, ws: string[]) => one("select public.qb_staff_set($1, $2::text[]) v", [user, ws]);
const caps = async (user: string) => { await admin(); return (await db.query<{ capability: string; active: boolean }>("select capability, active from public.user_capabilities where user_id = $1 order by capability", [user])).rows; };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    create type public.qb_role as enum ('student','teacher','admin','owner','sponsor');
    create table public.profiles(id uuid primary key, email text, full_name text not null, role public.qb_role, status text not null default 'active');
    create table public.user_capabilities(user_id uuid not null references public.profiles(id), capability text not null, active boolean not null default true, granted_by uuid, created_at timestamptz not null default now(), primary key(user_id, capability));
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), n bigserial, actor_user_id uuid, action text not null, entity_type text, entity_id uuid, status text not null default 'pass', details jsonb not null default '{}'::jsonb);
    create table public.platform_settings(id uuid primary key default gen_random_uuid(), key text not null, scope_type text not null default 'global', scope_id uuid, value jsonb not null, description text not null default '');
    create unique index platform_settings_scope_key on public.platform_settings(key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'));
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql stable security definer set search_path = '' as $$
      select coalesce((select value from public.platform_settings where key = p_key and scope_type = 'global') = 'true'::jsonb, false) $$;
    create schema quizbox_market;
    create function quizbox_market.is_super() returns boolean language sql stable security definer set search_path = '' as $$
      select auth.uid() is not null and (exists (select 1 from public.profiles where id = auth.uid() and role = 'owner') or exists (select 1 from public.user_capabilities where user_id = auth.uid() and active and capability = 'super_admin')) $$;
    grant usage on schema quizbox_market to authenticated; grant execute on function quizbox_market.is_super() to authenticated;
    insert into public.profiles values ('${BOSS}','boss@quizbox.io','Boss One','admin','active'),('${OTHER_BOSS}','boss2@quizbox.io','Boss Two','admin','active'),('${EFUA}','efua@quizbox.io','Efua Mensah','teacher','active'),
      ('${KOFI}','kofi@quizbox.io','Kofi Addo','student','active'),('${TEACHER}','teacher@quizbox.io','Abena Owusu','teacher','active'),('${GONE}','gone@quizbox.io','Gone Person','teacher','suspended'),('${OWNER}','owner@quizbox.io','The Owner','owner','active');
    insert into public.user_capabilities(user_id, capability) values ('${BOSS}','super_admin'),('${OTHER_BOSS}','super_admin'),('${KOFI}','sme_reviewer');
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("staff access", () => {
  it("re-applies cleanly and ships off", async () => {
    await db.exec(MIGRATION);
    await admin();
    expect((await db.query<{ value: unknown }>("select value from public.platform_settings where key = 'flags.staff_access'")).rows[0].value).toBe(false);
  });

  it("is closed while the flag is off, and the menu is told nothing is on", async () => {
    await as(BOSS);
    await expect(one("select public.qb_staff_list() v")).rejects.toThrow(/QB_FEATURE_DISABLED/);
    await expect(set(EFUA, ["content"])).rejects.toThrow(/QB_FEATURE_DISABLED/);
    expect(await one("select public.qb_my_staff_access() v")).toEqual({ enabled: false, workflows: [] });
    expect(await caps(EFUA)).toEqual([]);
  });

  it("is closed to signed-out callers and to the internal helpers", async () => {
    await setFlag(true);
    await as(null);
    await expect(one("select public.qb_my_staff_access() v")).rejects.toThrow(/NOT_AUTHORIZED/);
    await expect(one("select public.qb_staff_list() v")).rejects.toThrow(/NOT_AUTHORIZED/);
    await as(BOSS);
    await expect(db.query("select quizbox_staff.workflows_of('" + EFUA + "')")).rejects.toThrow(/permission denied/);
  });

  it("is for a super admin only", async () => {
    await as(TEACHER);
    await expect(one("select public.qb_staff_list() v")).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    await expect(one("select public.qb_staff_find('efua@quizbox.io') v")).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    await expect(set(EFUA, ["content"])).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    expect(await caps(EFUA)).toEqual([]);
  });

  it("finds an account by email, ignoring case and spaces, and says when there is none", async () => {
    await as(BOSS);
    expect(await one("select public.qb_staff_find('  EFUA@quizbox.io ') v")).toMatchObject({ user_id: EFUA, full_name: "Efua Mensah", role: "teacher", is_super: false, workflows: [] });
    await expect(one("select public.qb_staff_find('nobody@quizbox.io') v")).rejects.toThrow(/ACCOUNT_NOT_FOUND/);
    await expect(one("select public.qb_staff_find('  ') v")).rejects.toThrow(/ACCOUNT_NOT_FOUND/);
    expect(await one("select public.qb_staff_find('boss2@quizbox.io') v")).toMatchObject({ is_super: true });
    expect(await one("select public.qb_staff_find('owner@quizbox.io') v")).toMatchObject({ is_super: true });
  });

  it("gives workflows, and each one is the capability the database already enforces", async () => {
    await as(BOSS);
    expect(await set(EFUA, ["support", "content", "content"])).toMatchObject({ ok: true, workflows: ["content", "support"] });
    expect(await caps(EFUA)).toEqual([{ capability: "content_admin", active: true }, { capability: "sme_support", active: true }]);
    await as(EFUA);
    expect(await one("select public.qb_my_staff_access() v")).toEqual({ enabled: true, workflows: ["content", "support"] });
  });

  it("makes the account hold exactly what is sent: others are withdrawn, and the rows stay for history", async () => {
    await as(BOSS);
    await set(EFUA, ["finance"]);
    expect(await caps(EFUA)).toEqual([{ capability: "content_admin", active: false }, { capability: "finance_admin", active: true }, { capability: "sme_support", active: false }]);
    await as(BOSS);
    await set(EFUA, ["content"]);
    expect((await caps(EFUA)).filter((c) => c.active).map((c) => c.capability)).toEqual(["content_admin"]);
  });

  it("refuses a save that changes nothing, an unknown workflow, and a missing, suspended or super-admin account", async () => {
    await as(BOSS);
    await expect(set(EFUA, ["content"])).rejects.toThrow(/NOTHING_CHANGED/);
    await expect(set(EFUA, ["payroll"])).rejects.toThrow(/INVALID_WORKFLOW/);
    await expect(set(id(99), ["content"])).rejects.toThrow(/ACCOUNT_NOT_FOUND/);
    await expect(set(GONE, ["content"])).rejects.toThrow(/ACCOUNT_INACTIVE/);
    await expect(set(OTHER_BOSS, ["content"])).rejects.toThrow(/CANNOT_CHANGE_SUPER_ADMIN/);
    await expect(set(OWNER, ["content"])).rejects.toThrow(/CANNOT_CHANGE_SUPER_ADMIN/);
    await expect(set(BOSS, [])).rejects.toThrow(/CANNOT_CHANGE_SUPER_ADMIN/);
  });

  it("never touches a capability it does not manage", async () => {
    await as(BOSS);
    await set(KOFI, ["support"]);
    await set(KOFI, []);
    expect(await caps(KOFI)).toEqual([{ capability: "sme_reviewer", active: true }, { capability: "sme_support", active: false }]);
  });

  it("lists who holds a workflow, and drops someone once everything is withdrawn", async () => {
    await as(BOSS);
    const list = await one("select public.qb_staff_list() v") as Array<{ user_id: string; workflows: string[] }>;
    expect(list.map((r) => [r.user_id, r.workflows])).toEqual([[EFUA, ["content"]]]);
    await set(EFUA, []);
    expect(await one("select public.qb_staff_list() v")).toEqual([]);
  });

  it("records every change in the audit log with before and after", async () => {
    await admin();
    const rows = (await db.query<{ details: any }>("select details from public.audit_logs where action = 'staff_access_set' and entity_id = $1 order by n", [EFUA])).rows;
    expect(rows.length).toBe(4);
    expect(rows.some((r) => JSON.stringify(r.details.before) === "[]" && JSON.stringify(r.details.after) === '["content","support"]' && r.details.email === "efua@quizbox.io")).toBe(true);
  });

  it("turning the flag off hides the menu again and closes the screen, without removing anyone's access", async () => {
    await as(BOSS); await set(EFUA, ["support"]);
    await setFlag(false);
    await as(EFUA);
    expect(await one("select public.qb_my_staff_access() v")).toEqual({ enabled: false, workflows: [] });
    await as(BOSS);
    await expect(one("select public.qb_staff_list() v")).rejects.toThrow(/QB_FEATURE_DISABLED/);
    expect((await caps(EFUA)).filter((c) => c.active).map((c) => c.capability)).toEqual(["sme_support"]);
  });

  it("rolls back cleanly, leaving the capabilities, and can be applied again", async () => {
    await admin();
    await db.exec(ROLLBACK);
    expect((await db.query<{ f: unknown }>("select to_regprocedure('public.qb_staff_set(uuid,text[])') f")).rows[0].f).toBeNull();
    expect((await db.query<{ n: number }>("select count(*)::int n from public.platform_settings where key = 'flags.staff_access'")).rows[0].n).toBe(0);
    expect((await caps(EFUA)).filter((c) => c.active).map((c) => c.capability)).toEqual(["sme_support"]);
    await db.exec(MIGRATION);
    expect((await db.query<{ f: unknown }>("select to_regprocedure('public.qb_staff_set(uuid,text[])') f")).rows[0].f).not.toBeNull();
  });
});
