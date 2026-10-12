import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const FOUNDATION = readFileSync(new URL("../../supabase/migrations/20261002200000_market_sme_foundation.sql", import.meta.url), "utf8");
const SUPPORT = readFileSync(new URL("../../supabase/migrations/20261012180000_reviewer_support_and_catalogue.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../../supabase/rollback/support_and_catalogue.sql", import.meta.url), "utf8");
let db: PGlite;
const as = (n: number | null) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [n === null ? "" : id(n)]);
const run = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const configure = (entity: string, payload: Record<string, unknown>) => run("select public.qb_sme_configure($1,$2::jsonb) v", [entity, JSON.stringify(payload)]);

// 1 super admin, 2 support person, 3 ordinary reviewer, 4 stranger
describe("reviewer support capability and curriculum pool (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create table public.profiles(id uuid primary key,role text,status text);
      create table public.curricula(id uuid primary key,country text);
      create table public.tenants(id uuid primary key,country text);
      create table public.sponsor_profiles(id uuid primary key);
      create table public.curriculum_nodes(id uuid primary key,curriculum_id uuid,education_level text,node_type text,subject_code text,grade_code text,canonical_grade_code text,is_active boolean default true);
      create table public.questions(id uuid primary key,version integer,subject_code text,curriculum_id uuid,curriculum_node_id uuid,
        canonical_grade_code text,grade text,tenant_id uuid,source_type text,validation_status text,status text,reviewed_by uuid,reviewed_at timestamptz,editorial_metadata jsonb default '{}');
      create table public.question_versions(id uuid primary key,question_id uuid,version_no integer);
      create function public.qb_content_validation_errors(jsonb) returns jsonb language sql as $$ select '[]'::jsonb $$;
      insert into public.profiles values('${id(1)}','OWNER','active'),('${id(2)}','TEACHER','active'),('${id(3)}','TEACHER','active'),('${id(4)}','TEACHER','active');
      insert into public.curricula values('${id(10)}','Ghana'),('${id(11)}','Ghana');
    `);
    await db.exec(FOUNDATION);
    await db.exec("create table public.market_curricula(curriculum_id uuid primary key, market_id uuid not null, active boolean not null default true)");
    await db.exec("grant select on public.market_curricula to authenticated");
    await db.exec(SUPPORT);
    await as(1);
    await db.exec(`insert into public.user_capabilities(user_id,capability,active) values('${id(1)}','super_admin',true)`);
    const market = (await run("select id from public.markets where name='Ghana'")).id as string;
    await db.exec(`insert into public.market_curricula values('${id(10)}','${market}',true),('${id(11)}','${market}',false)`);
    await db.exec(`insert into public.curriculum_nodes(id,curriculum_id,education_level,node_type,subject_code,grade_code,canonical_grade_code) values
      ('${id(20)}','${id(10)}','Primary','subject','Computing','B4','B4'),('${id(21)}','${id(10)}','Primary','subject','Creative Arts','B5','B5'),
      ('${id(22)}','${id(10)}','JHS','subject','Mathematics','B7','B7'),('${id(23)}','${id(10)}','JHS','strand',null,'B7','B7'),
      ('${id(24)}','${id(11)}','SHS','subject','Biology','SHS1','SHS1')`);
  }, 120_000);
  afterAll(async () => { await db.close(); });

  it("lets a super admin grant the new capability and a stranger cannot", async () => {
    await as(1);
    expect((await configure("user_capabilities", { user_id: id(2), capability: "sme_support", active: true })).v).toMatchObject({ capability: "sme_support" });
    await as(4);
    await expect(configure("user_capabilities", { user_id: id(4), capability: "sme_support" })).rejects.toThrow("QB_SME_CONFIGURATION_DENIED");
  });

  it("lets reviewer support manage reviewer profiles and domains, and nothing else", async () => {
    await as(2);
    expect((await configure("sme_profiles", { user_id: id(3), reviewer_tier: "qualified", reviewer_status: "verified", payment_status: "verified", active: true })).v)
      .toMatchObject({ user_id: id(3), reviewer_status: "verified" });
    const market = (await run("select id from public.markets where name='Ghana'")).id as string;
    expect((await configure("sme_domain_assignments", { reviewer_id: id(3), subject_code: "Computing", market_id: market, education_level: "Primary", grade_codes: ["B4"], can_review: true, active: true })).v)
      .toMatchObject({ subject_code: "Computing", grade_codes: ["B4"] });
    for (const entity of ["compensation_policies", "markets", "currencies", "countries", "user_capabilities"])
      await expect(configure(entity, { name: "x", code: "XXX", user_id: id(2), capability: "super_admin" })).rejects.toThrow("QB_SME_CONFIGURATION_DENIED");
    expect((await run("select count(*)::int c from public.sme_domain_assignments")).c).toBe(1);
  });

  it("refuses an unrelated reviewer the same configuration", async () => {
    await as(3);
    await expect(configure("sme_domain_assignments", { reviewer_id: id(3), subject_code: "Science" })).rejects.toThrow("QB_SME_CONFIGURATION_DENIED");
  });

  it("serves the curriculum pool from active curricula only, to admins and support only", async () => {
    await as(2);
    const pool = (await run("select public.qb_curriculum_catalogue() v")).v as { markets: unknown[]; items: Array<Record<string, string>> };
    expect(pool.items.map((i) => `${i.level}|${i.grade}|${i.subject}`)).toEqual(["JHS|B7|Mathematics", "Primary|B4|Computing", "Primary|B5|Creative Arts"]);
    expect(pool.markets).toHaveLength(1);
    await as(3);
    await expect(run("select public.qb_curriculum_catalogue() v")).rejects.toThrow("QB_CATALOGUE_ACCESS_DENIED");
  });

  it("reports the capability in the context and rolls back cleanly", async () => {
    await as(2);
    expect((await run("select public.qb_sme_context() v")).v).toMatchObject({ sme_support: true, super_admin: false });
    await db.exec(ROLLBACK);
    await as(2);
    await expect(configure("sme_profiles", { user_id: id(3), reviewer_status: "verified" })).rejects.toThrow("QB_SME_CONFIGURATION_DENIED");
    expect((await db.query("select to_regprocedure('public.qb_curriculum_catalogue()') f")).rows[0]).toEqual({ f: null });
  });
});
