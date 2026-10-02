import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
describe("sponsor private persistence migration (isolated baseline fixtures)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec("create role anon; create role authenticated;");
    for (const table of ["sponsor_profiles", "countries", "markets", "profiles", "competitions", "content_contexts", "source_documents", "curricula", "questions", "question_versions", "assessments", "attempts"]) {
      await db.exec(`create table public.${table}(id uuid primary key);`);
      await db.query(`insert into public.${table} values($1)`, [id(1)]);
    }
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261002220000_sponsor_competition_lifecycle.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await db.close(); });
  it("creates eleven private tables with RLS", async () => {
    const result = await db.query<{ total: number; secured: number }>("select count(*)::int total,count(*) filter(where relrowsecurity)::int secured from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='quizbox_competition' and c.relkind='r'");
    expect(result.rows[0]).toEqual({ total: 11, secured: 11 });
  });
  it("does not grant browser access to answer-bearing candidates", async () => {
    const result = await db.query<{ allowed: boolean }>("select has_table_privilege('authenticated','quizbox_competition.candidates','select') allowed");
    expect(result.rows[0].allowed).toBe(false);
    await db.exec("set role authenticated");
    try { await expect(db.query("select * from quizbox_competition.candidates")).rejects.toThrow(/permission denied/); }
    finally { await db.exec("reset role"); }
  });
  it("retains public baseline records", async () => expect((await db.query<{ n: number }>("select count(*)::int n from public.questions")).rows[0].n).toBe(1));
  it("enforces sponsor foreign keys", async () => {
    await expect(db.query("insert into quizbox_competition.sponsor_organizations(sponsor_id,organization_type,country_id,market_id) values($1,'school',$2,$2)", [id(2), id(1)])).rejects.toThrow(/foreign key/);
  });
  it("requires actual profile for organization membership", async () => {
    await db.query("insert into quizbox_competition.sponsor_organizations(sponsor_id,organization_type,country_id,market_id) values($1,'school',$1,$1)", [id(1)]);
    await expect(db.query("insert into quizbox_competition.organization_members(sponsor_id,user_id,role) values($1,$2,'sponsor_owner')", [id(1), id(2)])).rejects.toThrow(/foreign key/);
  });
  it("does not permit Super Admin sponsor role", async () => {
    await expect(db.query("insert into quizbox_competition.organization_members(sponsor_id,user_id,role) values($1,$1,'super_admin')", [id(1)])).rejects.toThrow(/check constraint/);
  });
  it("makes published snapshot immutable", async () => {
    await db.query("insert into quizbox_competition.drafts(competition_id,sponsor_id,created_by,content_context_id,configuration) values($1,$1,$1,$1,'{}')", [id(1)]);
    await db.query("insert into quizbox_competition.snapshots(competition_id,version,payload,checksum,published_by,assessment_id) values($1,1,'{}',$2,$1,$1)", [id(1), "a".repeat(64)]);
    await expect(db.query("update quizbox_competition.snapshots set version=2")).rejects.toThrow("IMMUTABLE_COMPETITION_RECORD");
    await expect(db.query("delete from quizbox_competition.snapshots")).rejects.toThrow("IMMUTABLE_COMPETITION_RECORD");
  });
  it("rejects unsupported generation states", async () => {
    await expect(db.query("insert into quizbox_competition.generation_jobs(competition_id,created_by,input_snapshot,provider,model,requested_count,status) values($1,$1,'{}','mock','mock',1,'PUBLISHED')", [id(1)])).rejects.toThrow(/check constraint/);
  });
  it("refuses to discard populated workflow records during reversal", async () => {
    await expect(db.exec(readFileSync(new URL("../../supabase/rollback/sponsor_competition_lifecycle.sql", import.meta.url), "utf8"))).rejects.toThrow("ROLLBACK_REQUIRES_ARCHIVE_AND_ISOLATED_RESTORE");
    await db.exec("rollback");
  });
  it("reverses an empty private schema without touching public questions", async () => {
    // This truncation is confined to a disposable PGlite fixture, not an operator script.
    await db.exec("truncate quizbox_competition.sponsor_organizations cascade");
    await db.exec(readFileSync(new URL("../../supabase/rollback/sponsor_competition_lifecycle.sql", import.meta.url), "utf8"));
    expect((await db.query<{ n: number }>("select count(*)::int n from public.questions")).rows[0].n).toBe(1);
  });
});
