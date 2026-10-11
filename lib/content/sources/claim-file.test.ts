import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactoryFixture, fixtureId as id } from "../factory/fixture";

// public.qb_source_claim_file (20261012150000) against stand-in registry tables on an isolated PostgreSQL.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite, market: string, curriculum: string;
const SUPER = id(60), ADMIN = id(13), ROW = id(70), FETCHED = id(71), UNVERIFIED = id(72);
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
const claim = async (rowId: string) => (await db.query<{ v: any }>("select public.qb_source_claim_file($1) v", [rowId])).rows[0].v;

beforeAll(async () => {
  const f = await createFactoryFixture();
  ({ db, market, curriculum } = f);
  await db.exec("reset role");
  await db.exec(`create schema if not exists quizbox_sources;
    create table quizbox_sources.registry(id uuid primary key, market_id uuid, package_id uuid, job_id uuid, curriculum_id uuid, title text, canonical_url text, status text,
      verification_status text, source_document_id uuid, claim_token uuid, claimed_by uuid, claimed_at timestamptz);
    create table quizbox_sources.events(id bigint generated always as identity primary key, registry_id uuid, package_id uuid, job_id uuid, actor_id uuid, action text, details jsonb);
    create function quizbox_sources.log(p_registry uuid,p_package uuid,p_job uuid,p_action text,p_details jsonb default '{}') returns void language sql security definer as
      $$ insert into quizbox_sources.events(registry_id,package_id,job_id,actor_id,action,details) values(p_registry,p_package,p_job,auth.uid(),p_action,p_details) $$;
    grant usage on schema quizbox_sources to authenticated;`);
  await db.query("insert into profiles(id,role,status,country,default_market_id,full_name) values($1,'ADMIN','active','Ghana',$2,'Super Admin')", [SUPER, market]);
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'super2@example.invalid',now())", [SUPER]);
  await db.query("insert into user_capabilities(user_id,capability,active) values($1,'super_admin',true)", [SUPER]);
  await db.query("insert into quizbox_sources.registry(id,market_id,curriculum_id,title,canonical_url,status,verification_status) values($1,$2,$3,'Social Studies CCP','https://nacca.gov.gh/x.pdf','IMPORTED','VERIFIED')", [ROW, market, curriculum]);
  await db.query("insert into quizbox_sources.registry(id,market_id,curriculum_id,title,canonical_url,status,verification_status,source_document_id) values($1,$2,$3,'Fetched','https://nacca.gov.gh/y.pdf','NEEDS_REVIEW','VERIFIED',gen_random_uuid())", [FETCHED, market, curriculum]);
  await db.query("insert into quizbox_sources.registry(id,market_id,curriculum_id,title,canonical_url,status,verification_status) values($1,$2,$3,'Index','https://nacca.gov.gh/','IMPORTED','INDEX_LISTED')", [UNVERIFIED, market, curriculum]);
  await db.exec(read("../../../supabase/migrations/20261012150000_source_file_claim.sql"));
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("qb_source_claim_file", () => {
  it("lets a super admin claim one verified, unfetched row and leaves an audit event", async () => {
    await as(SUPER);
    const c = await claim(ROW);
    expect(c).toMatchObject({ id: ROW, title: "Social Studies CCP", market_id: market, url: "https://nacca.gov.gh/x.pdf" });
    expect(c.token).toMatch(/^[0-9a-f-]{36}$/);
    await db.exec("reset role");
    const row = (await db.query<{ claimed_by: string; claim_token: string }>("select claimed_by, claim_token from quizbox_sources.registry where id=$1", [ROW])).rows[0];
    expect(row).toEqual({ claimed_by: SUPER, claim_token: c.token });
    expect((await db.query<{ n: string }>("select count(*)::text n from quizbox_sources.events where registry_id=$1 and action='FILE_SUPPLY_CLAIMED'", [ROW])).rows[0].n).toBe("1");
  });

  it("refuses rows that are fetched or not verified, and anyone who is not a super admin", async () => {
    await as(SUPER);
    await expect(claim(FETCHED)).rejects.toThrow(/QB_SOURCE_INVALID_TRANSITION/);
    await expect(claim(UNVERIFIED)).rejects.toThrow(/QB_SOURCE_INVALID_TRANSITION/);
    await expect(claim(id(99))).rejects.toThrow(/QB_SOURCE_NOT_FOUND/);
    await as(ADMIN);
    await expect(claim(ROW)).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    await as(null);
    await expect(claim(ROW)).rejects.toThrow(/permission denied/);
  });
});
