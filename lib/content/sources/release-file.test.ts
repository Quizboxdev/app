import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactoryFixture, fixtureId as id } from "../factory/fixture";

// public.qb_source_release_file (20261012160000) against stand-in registry tables on an isolated PostgreSQL.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite, market: string, curriculum: string, authority: string;
const SUPER = id(60), ADMIN = id(13);
const REVIEW = id(80), REJECTED = id(81), APPROVED = id(82), ACTIVE = id(83), IMPORTED = id(84);
const DOC = (n: number) => id(90 + n);
const NOTE = "Wrong file: it is the sibling subject PDF";
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
const release = async (rowId: string, note = NOTE) => (await db.query<{ v: any }>("select public.qb_source_release_file($1,$2) v", [rowId, note])).rows[0].v;

beforeAll(async () => {
  const f = await createFactoryFixture();
  ({ db, market, curriculum } = f);
  authority = (await db.query<{ authority_id: string }>("select authority_id from market_curricula where curriculum_id=$1", [curriculum])).rows[0].authority_id;
  await db.exec("reset role");
  await db.exec(`create schema if not exists quizbox_sources;
    create table quizbox_sources.registry(id uuid primary key, market_id uuid, package_id uuid, job_id uuid, curriculum_id uuid, title text, canonical_url text, status text,
      verification_status text, source_document_id uuid, sha256 text, byte_size integer, storage_path text, pages integer, fetch_attempts integer default 0, last_error text,
      claim_token uuid, claimed_by uuid, claimed_at timestamptz, review_note text);
    create table quizbox_sources.events(id bigint generated always as identity primary key, registry_id uuid, package_id uuid, job_id uuid, actor_id uuid, action text, details jsonb);
    create function quizbox_sources.log(p_registry uuid,p_package uuid,p_job uuid,p_action text,p_details jsonb default '{}') returns void language sql security definer as
      $$ insert into quizbox_sources.events(registry_id,package_id,job_id,actor_id,action,details) values(p_registry,p_package,p_job,auth.uid(),p_action,p_details) $$;
    grant usage on schema quizbox_sources to authenticated;`);
  await db.query("insert into profiles(id,role,status,country,default_market_id,full_name) values($1,'ADMIN','active','Ghana',$2,'Super Admin')", [SUPER, market]);
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'super3@example.invalid',now())", [SUPER]);
  await db.query("insert into user_capabilities(user_id,capability,active) values($1,'super_admin',true)", [SUPER]);
  const rows: Array<[string, string, string, number]> = [[REVIEW, "NEEDS_REVIEW", "review", 1], [REJECTED, "REJECTED", "rejected", 2], [APPROVED, "APPROVED", "review", 3], [ACTIVE, "ACTIVE", "approved", 4]];
  for (const [rid, status, doc, n] of rows) {
    await db.query(`insert into source_documents(id,title,checksum,rights_confirmed,market_id,curriculum_id,authority_id,source_kind,validation_status,approved_by,content_text,uploaded_by)
      values($1,$2,$3,$7='approved',$4,$5,$6,'CURRICULUM',$7,case when $7='approved' then $8::uuid end,'text',$8)`, [DOC(n), `Doc ${n}`, `sum-r${n}`, market, curriculum, authority, doc, id(2)]);
    await db.query(`insert into quizbox_sources.registry(id,market_id,curriculum_id,title,canonical_url,status,verification_status,source_document_id,sha256,byte_size,storage_path,pages)
      values($1,$2,$3,$4,'https://nacca.gov.gh/x.pdf',$5,'VERIFIED',$6,repeat('a',64),1000,'m/x.pdf',12)`, [rid, market, curriculum, `Row ${n}`, status, DOC(n)]);
  }
  await db.query("insert into quizbox_sources.registry(id,market_id,curriculum_id,title,canonical_url,status,verification_status) values($1,$2,$3,'Fresh','https://nacca.gov.gh/y.pdf','IMPORTED','VERIFIED')", [IMPORTED, market, curriculum]);
  await db.exec(read("../../../supabase/migrations/20261012160000_source_file_release.sql"));
}, 240_000);
afterAll(async () => { await db?.close(); });

describe("qb_source_release_file", () => {
  it("returns an unapproved row to IMPORTED, rejects its document and logs the previous fingerprint", async () => {
    await as(SUPER);
    expect(await release(REVIEW)).toMatchObject({ id: REVIEW, status: "IMPORTED", previous_sha256: "a".repeat(64) });
    await db.exec("reset role");
    const row = (await db.query<any>("select status, sha256, storage_path, pages, source_document_id, fetch_attempts, review_note from quizbox_sources.registry where id=$1", [REVIEW])).rows[0];
    expect(row).toEqual({ status: "IMPORTED", sha256: null, storage_path: null, pages: null, source_document_id: null, fetch_attempts: 0, review_note: NOTE });
    const doc = (await db.query<any>("select validation_status, metadata from source_documents where id=$1", [DOC(1)])).rows[0];
    expect(doc.validation_status).toBe("rejected");
    expect(doc.metadata.released_registry_id).toBe(REVIEW);
    const ev = (await db.query<any>("select details from quizbox_sources.events where registry_id=$1 and action='FILE_RELEASED'", [REVIEW])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].details).toMatchObject({ previous_status: "NEEDS_REVIEW", previous_sha256: "a".repeat(64) });
  });

  it("also releases a rejected row", async () => {
    await as(SUPER);
    expect(await release(REJECTED, "Rejected earlier; correct file now available")).toMatchObject({ status: "IMPORTED" });
  });

  it("never touches approved or active sources, or rows with no file", async () => {
    await as(SUPER);
    for (const rid of [APPROVED, ACTIVE, IMPORTED]) await expect(release(rid)).rejects.toThrow(/QB_SOURCE_INVALID_TRANSITION/);
    await db.exec("reset role");
    expect((await db.query<any>("select status, source_document_id from quizbox_sources.registry where id=$1", [ACTIVE])).rows[0]).toMatchObject({ status: "ACTIVE", source_document_id: DOC(4) });
  });

  it("requires a known row and a super admin", async () => {
    await as(SUPER);
    await expect(release(id(99))).rejects.toThrow(/QB_SOURCE_NOT_FOUND/);
    await as(ADMIN);
    await expect(release(REVIEW)).rejects.toThrow(/SUPER_ADMIN_REQUIRED/);
    await as(null);
    await expect(release(REVIEW)).rejects.toThrow(/permission denied/);
  });
});
