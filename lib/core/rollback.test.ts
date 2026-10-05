import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Provenance: quizbox.ransford.eddy.mensah. Disposable in-memory database with stubbed upstream objects (NOT a Supabase branch).
// Normalised so the comparison against the inline stub definitions holds on checkouts that convert line endings (core.autocrlf on Windows).
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.profiles(id uuid primary key,role text,status text,onboarding_completed_at timestamptz);
  create table public.currencies(code text primary key); create table public.institutions(id uuid primary key,name text);
  create table public.institution_memberships(id uuid primary key default gen_random_uuid(),institution_id uuid,user_id uuid,role text,status text);
  create table public.user_capabilities(user_id uuid not null,capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin','content_admin')),active boolean default true,primary key(user_id,capability));
  create table public.audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,action text,entity_type text,entity_id uuid,status text,details jsonb,created_at timestamptz default now());
  create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid);
  create table public.attempts(id uuid primary key default gen_random_uuid()); create table public.responses(id uuid primary key default gen_random_uuid());
  create schema quizbox_sme; create schema quizbox_ops;
  create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select false $$;
  create function quizbox_ops.analytics_student(p_student uuid) returns uuid language plpgsql stable security definer set search_path='' as $$
declare v uuid:=coalesce(p_student,auth.uid());
begin
 if auth.uid() is null or (v<>auth.uid() and not quizbox_sme.has_capability('super_admin')) then raise exception 'NOT_AUTHORIZED' using errcode='42501'; end if;
 return v;
end $$;
  create function quizbox_ops.student_insights(p uuid) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create function public.qb_student_insights() returns jsonb language sql stable security definer set search_path='' as $$ select quizbox_ops.student_insights(auth.uid()); $$;
  grant execute on function public.qb_student_insights() to authenticated;
  insert into public.currencies values('GHS');`;
const SNAPSHOT = `select
  (select coalesce(string_agg(c.relname||':'||c.relkind::text,',' order by c.relname),'') from pg_class c where c.relnamespace in ('public'::regnamespace) and c.relkind in ('r','v')) objects,
  (select coalesce(string_agg(a.attrelid::regclass||'.'||a.attname,',' order by a.attrelid::regclass::text,a.attname),'') from pg_attribute a where a.attrelid in ('public.notifications'::regclass,'public.attempts'::regclass,'public.responses'::regclass) and a.attnum>0 and not a.attisdropped) columns,
  (select coalesce(string_agg(p.oid::regprocedure::text||md5(p.prosrc),',' order by p.oid::regprocedure::text),'') from pg_proc p where p.pronamespace in ('public'::regnamespace,'quizbox_ops'::regnamespace,'quizbox_sme'::regnamespace)) functions,
  coalesce((select has_function_privilege('authenticated',to_regprocedure('public.qb_student_insights()'),'execute')),false) insights_grant,
  (select count(*)::int from pg_namespace where nspname='quizbox_core') core_schema`;

async function fresh() {
  const db = new PGlite();
  await db.exec(STUBS);
  return db;
}

// Hosted-shape stubs of the two tables that already exist in production (marketplace entitlements, notification delivery model).
const HOSTED = `
  create table public.entitlements(id uuid primary key default gen_random_uuid(),buyer_id uuid,product_ref text not null,status text not null default 'granted',granted_at timestamptz default now());
  create table public.notification_deliveries(id uuid primary key default gen_random_uuid(),notification_id uuid references public.notifications(id),channel text not null,status text not null default 'PENDING',attempts int not null default 0);
  insert into public.notifications(id) values('00000000-0000-4000-8000-0000000000aa');
  insert into public.entitlements(id,product_ref) values('00000000-0000-4000-8000-0000000000e1','pack-1');
  insert into public.notification_deliveries(id,notification_id,channel) values('00000000-0000-4000-8000-0000000000d1','00000000-0000-4000-8000-0000000000aa','email');`;
const HOSTED_STATE = `select
  (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),',' order by a.attname) from pg_attribute a where a.attrelid='public.entitlements'::regclass and a.attnum>0 and not a.attisdropped) ent_cols,
  (select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),',' order by a.attname) from pg_attribute a where a.attrelid='public.notification_deliveries'::regclass and a.attnum>0 and not a.attisdropped) nd_cols,
  (select string_agg(indexname,',' order by indexname) from pg_indexes where schemaname='public' and tablename in ('entitlements','notification_deliveries')) idx,
  (select string_agg(t::text,',' order by t::text) from public.entitlements t) ent_rows,
  (select string_agg(t::text,',' order by t::text) from public.notification_deliveries t) nd_rows,
  (select relrowsecurity::text||has_table_privilege('authenticated','public.entitlements','select')::text from pg_class where oid='public.entitlements'::regclass) ent_sec,
  (select relrowsecurity::text||has_table_privilege('authenticated','public.notification_deliveries','select')::text from pg_class where oid='public.notification_deliveries'::regclass) nd_sec`;
const exists = async (db: PGlite, t: string) => (await db.query<Record<string, any>>("select to_regclass($1) is not null e", [t])).rows[0].e as boolean;
const MIGRATION = "../../supabase/migrations/20261007100000_core_platform_foundation.sql";
const ROLLBACK = "../../supabase/rollback/core_platform_foundation.sql";
const code = (path: string) => read(path).replace(/^\s*--.*$/gm, "");

describe("hosted-table collisions: public.entitlements and public.notification_deliveries (disposable PGlite database)", { timeout: 60_000 }, () => {
  it("migrates over pre-existing hosted tables without touching them, and rollback never drops them", async () => {
    const db = new PGlite();
    await db.exec(STUBS);
    await db.exec(HOSTED);
    const before = (await db.query<Record<string, any>>(HOSTED_STATE)).rows[0];
    await db.exec(read(MIGRATION));
    expect(await exists(db, "public.access_entitlements")).toBe(true);
    expect((await db.query<Record<string, any>>(HOSTED_STATE)).rows[0]).toEqual(before);
    await db.exec(read(ROLLBACK));
    expect(await exists(db, "public.access_entitlements")).toBe(false);
    expect(await exists(db, "public.entitlements")).toBe(true);
    expect(await exists(db, "public.notification_deliveries")).toBe(true);
    expect((await db.query<Record<string, any>>(HOSTED_STATE)).rows[0]).toEqual(before);
    await db.close();
  });
  it("migration and rollback SQL never create, alter, reference or drop the hosted tables", () => {
    for (const sql of [code(MIGRATION), code(ROLLBACK)]) {
      expect(sql).not.toMatch(/notification_deliveries/);
      expect(sql).not.toMatch(/public\.entitlements\b/);
      expect(sql).not.toMatch(/[\s,'(]entitlements[\s,')]/);
    }
  });
});

describe("rollback of 20261007100000 (disposable PGlite database)", { timeout: 60_000 }, () => {
  it("restores the pre-migration public/quizbox_ops catalogue exactly, apart from the documented widened capability constraint", async () => {
    const db = await fresh();
    const before = (await db.query<Record<string, any>>(SNAPSHOT)).rows[0];
    await db.exec(read("../../supabase/migrations/20261007100000_core_platform_foundation.sql"));
    const during = (await db.query<Record<string, any>>(SNAPSHOT)).rows[0];
    expect(during.objects).not.toEqual(before.objects);
    expect(during.core_schema).toBe(1);
    await db.exec(read("../../supabase/rollback/core_platform_foundation.sql"));
    const after = (await db.query<Record<string, any>>(SNAPSHOT)).rows[0];
    expect(after).toEqual(before);
    // The one intentional leftover: a superset check constraint on user_capabilities (existing values stay valid).
    await db.exec("insert into public.user_capabilities values(gen_random_uuid(),'super_admin')");
    await db.close();
  });
  it("refuses to roll back once money, relationship or consent data exists", async () => {
    const db = await fresh();
    await db.exec(read("../../supabase/migrations/20261007100000_core_platform_foundation.sql"));
    const u = "00000000-0000-4000-8000-000000000001";
    await db.exec(`insert into public.profiles values('${u}','STUDENT','active',now()); insert into public.wallets(user_id) values('${u}');
      insert into public.coin_transactions(wallet_id,bucket,kind,amount,balance_after,idempotency_key) select id,'promotional','promo_grant',1,1,'seed-key-0001' from public.wallets;`);
    await expect(db.exec(read("../../supabase/rollback/core_platform_foundation.sql"))).rejects.toThrow(/QB_ROLLBACK_REFUSED/);
    await db.exec("rollback");
    expect((await db.query<Record<string, any>>("select count(*)::int n from public.coin_transactions")).rows[0].n).toBe(1);
    await db.close();
  });
});
