import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261051100000_question_batch_discard.sql");
const ROLLBACK = read("../../supabase/rollback/question_batch_discard.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = (c: string) => c.repeat(64);
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const discard = (batch: string, note = "File was wrong, loading it again.") => one("select public.qb_owner_batch_discard($1,$2) v", [batch, note]);
const batch = (n: number) => one("select * from public.question_load_batches where id=$1", [id(n)]);

// Batches: 500 stopped partway (3 questions saved), 501 failed (none), 502 loaded and live, 503 loaded and not approved, 504 another file's batch (must stay untouched).
describe("discarding a question batch (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema quizbox_sme; create schema quizbox_market;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select position(p in coalesce(current_setting('test.caps',true),'')) > 0 $$;
      create function quizbox_market.is_super() returns boolean language sql stable as $$ select quizbox_sme.has_capability('super_admin') $$;
      create table public.profiles(id uuid primary key);
      create table public.question_load_batches(id uuid primary key, file_name text not null, file_sha256 text not null unique check (length(file_sha256) = 64), scope text default 'CURRICULUM', status text default 'CHECKED',
        rows_total int default 0, rows_loaded int default 0, rows_rejected int default 0, report jsonb not null default '{}', uploaded_by uuid, created_at timestamptz default now(), completed_at timestamptz);
      create table public.question_batch_approvals(id uuid primary key default gen_random_uuid(), batch_id uuid references public.question_load_batches(id), status text default 'ACTIVE');
      create table public.questions(id uuid primary key default gen_random_uuid(), validation_status text default 'review', status text default 'inactive', tags text[] default '{}', editorial_metadata jsonb default '{}', question_text text);
      -- the platform's editorial rule: an APPROVED question needs a reviewer; moving to archived/rejected must never be blocked by it
      create function public.editorial_stub() returns trigger language plpgsql as $$ begin
        if new.validation_status = 'approved' and old.validation_status is distinct from 'approved' then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if; return new; end $$;
      create trigger a_editorial before update on public.questions for each row execute function public.editorial_stub();
      insert into public.profiles values('${id(1)}'),('${id(2)}');
      insert into public.question_load_batches(id,file_name,file_sha256,status,rows_total,rows_loaded,report) values
        ('${id(500)}','science.csv','${HASH("a")}','LOADING',1000,3,'{"expected_rows":2600}'),
        ('${id(501)}','failed.csv','${HASH("b")}','FAILED',0,0,'{}'),
        ('${id(502)}','live.csv','${HASH("c")}','LOADED',2,2,'{}'),
        ('${id(503)}','ready.csv','${HASH("d")}','LOADED',2,2,'{}'),
        ('${id(504)}','other.csv','${HASH("e")}','LOADED',1,1,'{}');
      insert into public.question_batch_approvals(batch_id,status) values('${id(502)}','ACTIVE');
      insert into public.questions(question_text, tags) values
        ('S1','{"source:QL:${id(500)}:1"}'),('S2','{"source:QL:${id(500)}:2"}'),('S3','{"source:QL:${id(500)}:3"}'),
        ('L1','{"source:QL:${id(502)}:1"}'),('R1','{"source:QL:${id(503)}:1"}'),('R2','{"source:QL:${id(503)}:2"}'),('O1','{"source:QL:${id(504)}:1"}');
      alter table public.questions disable trigger a_editorial;   -- set-up only: one question starts out already approved and live
      update public.questions set status='active', validation_status='approved' where question_text = 'L1';
      alter table public.questions enable trigger a_editorial;
    `);
    await db.exec(MIGRATION);
    await db.exec("grant select on all tables in schema public to authenticated");
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("is for a super admin only, and needs a real reason", async () => {
    await as(2, "content_admin");
    await expect(discard(id(500))).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(1, "super_admin");
    await expect(discard(id(500), "short")).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");
    await expect(discard(id(999))).rejects.toThrow("QB_BATCH_NOT_FOUND");
    expect((await batch(500)).status).toBe("LOADING");
  });

  it("refuses a batch that is live for learners", async () => {
    await as(1, "super_admin");
    await expect(discard(id(502))).rejects.toThrow("QB_BATCH_IS_LIVE");
    expect((await one("select count(*)::int n from public.questions where status='active'")).n).toBe(1);
  });

  it("withdraws a stopped batch's questions without deleting them, and leaves every other batch alone", async () => {
    await as(1, "super_admin");
    const r = (await discard(id(500))).v;
    expect(r).toMatchObject({ batch_id: id(500), withdrawn: 3 });
    const q = await db.query<Record<string, any>>("select question_text, status, validation_status, editorial_metadata from public.questions where tags[1] like $1 order by question_text", [`%${id(500)}%`]);
    expect(q.rows.map((x) => [x.status, x.validation_status])).toEqual([["archived", "rejected"], ["archived", "rejected"], ["archived", "rejected"]]);
    expect(q.rows[0].editorial_metadata).toMatchObject({ discarded_batch: id(500) });
    expect((await one("select count(*)::int n from public.questions")).n).toBe(7);                                           // nothing deleted
    expect((await one("select count(*)::int n from public.questions where status='inactive'")).n).toBe(3);                    // R1, R2, O1 untouched
    expect((await one("select count(*)::int n from public.questions where status='active'")).n).toBe(1);                      // the live one untouched
  });

  it("marks the batch discarded, records who and why, and releases the file fingerprint so the file can be loaded again", async () => {
    const b = await batch(500);
    expect(b.status).toBe("DISCARDED");
    expect(b.completed_at).not.toBeNull();
    expect(b.file_sha256).not.toBe(HASH("a"));
    expect(b.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.report).toMatchObject({ discarded_by: id(1), discard_note: "File was wrong, loading it again.", original_file_sha256: HASH("a"), questions_withdrawn: 3, expected_rows: 2600 });
    // The same file can now start a fresh batch: its fingerprint is free again.
    await db.exec(`insert into public.question_load_batches(id,file_name,file_sha256,status) values('${id(600)}','science.csv','${HASH("a")}','LOADING')`);
    expect((await one("select count(*)::int n from public.question_load_batches where file_sha256=$1", [HASH("a")])).n).toBe(1);
  });

  it("cannot be done twice, and works for a failed batch with nothing in it and for a loaded batch that is not approved", async () => {
    await as(1, "super_admin");
    await expect(discard(id(500))).rejects.toThrow("QB_BATCH_ALREADY_DISCARDED");
    expect((await discard(id(501))).v).toMatchObject({ withdrawn: 0 });
    expect((await discard(id(503))).v).toMatchObject({ withdrawn: 2 });
    expect((await batch(503)).status).toBe("DISCARDED");
    expect((await batch(504)).status).toBe("LOADED");                                                                           // someone else's batch is untouched
  });

  it("is available to signed-in users only, and the rollback removes it cleanly", async () => {
    const grants = await db.query<Record<string, any>>("select has_function_privilege('anon','public.qb_owner_batch_discard(uuid,text)','execute') a, has_function_privilege('authenticated','public.qb_owner_batch_discard(uuid,text)','execute') b");
    expect(grants.rows[0]).toEqual({ a: false, b: true });
    await db.exec(MIGRATION);                                                                                                    // idempotent
    await db.exec(ROLLBACK);
    expect((await one("select count(*)::int n from pg_proc where proname='qb_owner_batch_discard'")).n).toBe(0);
  });
});
