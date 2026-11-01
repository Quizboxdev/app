import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const SME = read("../../supabase/migrations/20261002200000_market_sme_foundation.sql");
const OWNER = read("../../supabase/migrations/20261014110000_owner_batch_approval.sql");
const TOPICS = read("../../supabase/migrations/20261012100000_topic_registry.sql");
const MIGRATION = read("../../supabase/migrations/20261052100000_owner_batch_steps.sql");
const ROLLBACK = read("../../supabase/rollback/owner_batch_steps.sql");
// The production objects this depends on are taken verbatim from the migrations that created them: the review guard, and the batch table's own status check.
const GUARD = SME.slice(SME.indexOf("create function quizbox_sme.managed_review_guard()"), SME.indexOf("create trigger zz_sme_managed_review_guard"));
const BATCH_TABLE = TOPICS.slice(TOPICS.indexOf("create table public.question_load_batches ("), TOPICS.indexOf(");", TOPICS.indexOf("create table public.question_load_batches (")) + 2);
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = (c: string) => c.repeat(64);
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const count = async (where: string) => (await one(`select count(*)::int n from public.questions where ${where}`)).n as number;
const approve = (batch: string, limit = 100, note = "Read 25 of 250 questions; sound.", sample = 25) => one("select public.qb_owner_approve_batch_step($1,$2,$3,true,$4) v", [batch, note, sample, limit]).then((r) => r.v);
const revoke = (approval: string, limit = 100, note = "Reviewers will take over this batch.") => one("select public.qb_owner_revoke_batch_approval_step($1,$2,$3) v", [approval, note, limit]).then((r) => r.v);
const discard = (batch: string, limit = 100, note = "File was wrong, loading it again.") => one("select public.qb_owner_batch_discard_step($1,$2,$3) v", [batch, note, limit]).then((r) => r.v);
const batch = (n: number) => one("select * from public.question_load_batches where id=$1", [id(n)]);
const run = async (step: () => Promise<any>) => { const out: any[] = []; for (let i = 0; i < 20; i++) { const r = await step(); out.push(r); if (r.done) return out; } throw new Error("never finished"); };

// Batches: 500 loaded, 250 valid + 3 invalid questions; 501 loaded, 200 valid (an exact multiple of the step); 502 stopped partway with 30 questions saved; 503 loaded, 10 valid, left unapproved; 504 another file's batch.
describe("owner batch actions in steps (isolated PostgreSQL; production review guard and batch status check installed verbatim)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema quizbox_sme; create schema quizbox_market;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select position(p in coalesce(current_setting('test.caps',true),'')) > 0 $$;
      create function quizbox_market.is_super() returns boolean language sql stable as $$ select quizbox_sme.has_capability('super_admin') $$;
      create table public.profiles(id uuid primary key);
      ${BATCH_TABLE.replace("uploaded_by uuid not null references public.profiles(id)", "uploaded_by uuid")}
      create type public.qb_status as enum ('active', 'inactive', 'archived');
      create table public.questions(id uuid primary key default gen_random_uuid(), version integer default 1, validation_status text default 'review', status public.qb_status default 'inactive',
        reviewed_by uuid, reviewed_at timestamptz, editorial_metadata jsonb default '{}', tags text[] default '{}', question_text text, option_a text, option_b text, option_c text,
        option_d text, correct_answer text, difficulty_label text, curriculum_id uuid);
      create function public.qb_content_validation_errors(p jsonb) returns jsonb language sql stable as $$ select case when p->>'question_text' like '%BAD%' then '["X"]'::jsonb else '[]'::jsonb end $$;
      create function public.qb_question_is_available(q public.questions) returns boolean language sql stable as
        $$ select q.status::text = 'active' and q.validation_status = 'approved' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb $$;
      create table public.sme_domain_assignments(id uuid primary key, reviewer_id uuid);
      create table public.sme_review_assignments(id uuid primary key, question_id uuid, reviewer_id uuid, review_completed_at timestamptz, question_version integer, review_kind text);
      create table public.sme_review_events(id uuid primary key, assignment_id uuid, decision text, review_completed_at timestamptz);
      create table public.curricula(id uuid primary key, market_id uuid);
      create table public.markets(id uuid primary key, configuration jsonb);
      create function quizbox_sme.domain_matches(a uuid, b uuid, c uuid, d uuid, e boolean, f boolean) returns boolean language sql as $$ select false $$;
      -- the platform's editorial rule: an approved question needs a reviewer, a time and the human_reviewed stamp
      create function public.editorial_stub() returns trigger language plpgsql as $$ begin
        if new.validation_status = 'approved' and (tg_op = 'INSERT' or old.validation_status is distinct from 'approved') then
          if new.reviewed_by is null or new.reviewed_at is null or new.editorial_metadata->>'human_reviewed' is distinct from 'true' then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if; end if; return new; end $$;
      create trigger a_editorial before insert or update on public.questions for each row execute function public.editorial_stub();
      insert into public.profiles values('${id(1)}'),('${id(2)}');
      insert into public.question_load_batches(id, file_name, file_sha256, scope, status, rows_total, rows_loaded, uploaded_by, report) values
        ('${id(500)}','a.csv','${HASH("a")}','CURRICULUM','LOADED',253,253,'${id(1)}','{}'),
        ('${id(501)}','b.csv','${HASH("b")}','CURRICULUM','LOADED',200,200,'${id(1)}','{}'),
        ('${id(502)}','c.csv','${HASH("c")}','CURRICULUM','LOADING',30,30,'${id(1)}','{"expected_rows":2600}'),
        ('${id(503)}','d.csv','${HASH("d")}','CURRICULUM','LOADED',10,10,'${id(1)}','{}'),
        ('${id(504)}','e.csv','${HASH("e")}','CURRICULUM','LOADED',1,1,'${id(1)}','{}');
      insert into public.questions(question_text, tags) select 'A'||g, array['source:QL:${id(500)}:'||g] from generate_series(1,250) g;
      insert into public.questions(question_text, tags) select 'BAD A'||g, array['source:QL:${id(500)}:'||(250+g)] from generate_series(1,3) g;
      insert into public.questions(question_text, tags) select 'B'||g, array['source:QL:${id(501)}:'||g] from generate_series(1,200) g;
      insert into public.questions(question_text, tags) select 'C'||g, array['source:QL:${id(502)}:'||g] from generate_series(1,30) g;
      insert into public.questions(question_text, tags) select 'D'||g, array['source:QL:${id(503)}:'||g] from generate_series(1,10) g;
      insert into public.questions(question_text, tags) values ('Other', array['source:QL:${id(504)}:1']);
    `);
    await db.exec(GUARD); await db.exec("create trigger zz_sme_managed_review_guard before update on public.questions for each row execute function quizbox_sme.managed_review_guard()");
    await db.exec(OWNER);
    await db.exec(MIGRATION);
    await db.exec("grant select on all tables in schema public to authenticated");
  }, 120_000);
  afterAll(async () => { await db.close(); });

  it("is for a super admin only, and refuses a batch that is not loaded, a small sample and a short note before changing anything", async () => {
    await as(2, "content_admin");
    await expect(approve(id(500))).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await expect(discard(id(503))).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(1, "super_admin");
    await expect(approve(id(502))).rejects.toThrow("QB_BATCH_NOT_LOADED");            // still loading
    await expect(approve(id(500), 100, "Read 25 of 250 questions; sound.", 5)).rejects.toThrow("QB_OWNER_SAMPLE_TOO_SMALL");
    await expect(approve(id(500), 100, "short")).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");
    await expect(approve(id(999))).rejects.toThrow("QB_BATCH_NOT_FOUND");
    expect((await one("select count(*)::int n from public.question_batch_approvals")).n).toBe(0);
    expect(await count("validation_status='review'")).toBe(250 + 3 + 200 + 30 + 10 + 1);
  });

  it("approves a large batch in steps: each step is small, the approval shows as unfinished in between, and the end result is the same as one big call", async () => {
    await as(1, "super_admin");
    const first = await approve(id(500));
    expect(first).toMatchObject({ done: false, approved: 100, published: true });
    expect(await one("select in_progress, status, questions_approved from public.question_batch_approvals")).toMatchObject({ in_progress: true, status: "ACTIVE", questions_approved: 100 });
    await expect(approve(id(500), 100, "x", 1)).resolves.toMatchObject({ done: false, approved: 200 });   // a continuing step needs no new note or sample: it finishes the same approval
    const last = await approve(id(500));
    expect(last).toMatchObject({ done: true, questions_found: 253, approved: 250, skipped: 3, published: true });
    expect(await one("select in_progress, questions_approved, questions_skipped from public.question_batch_approvals")).toMatchObject({ in_progress: false, questions_approved: 250, questions_skipped: 3 });
    expect(await count("validation_status='approved' and status::text='active' and editorial_metadata->>'approval_basis'='OWNER_BATCH'")).toBe(250);
    expect(await count("question_text like 'BAD%' and validation_status='review' and status::text='inactive'")).toBe(3);   // invalid ones stay for review
    expect(await count("question_text in ('Other') and validation_status='review'")).toBe(1);                              // another file's batch untouched
    expect((await one("select current_setting('quizbox.owner_batch', true) f")).f).not.toBe("on");
    await expect(approve(id(500))).rejects.toThrow("QB_BATCH_ALREADY_APPROVED");
    // outside these functions the guard is back: even a super admin cannot approve by hand
    await expect(db.exec(`update public.questions set validation_status='approved', reviewed_by='${id(1)}', reviewed_at=now(), editorial_metadata='{"human_reviewed":true}' where question_text='Other'`)).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
  });

  it("finishes correctly when the batch is an exact multiple of the step size", async () => {
    await as(1, "super_admin");
    const steps = await run(() => approve(id(501)));
    expect(steps.map((s) => s.done)).toEqual([false, false, true]);                      // 100, 100, then nothing left
    expect(steps.at(-1)).toMatchObject({ approved: 200, skipped: 0, questions_found: 200 });
    expect(await count("question_text like 'B%' and status::text='active'")).toBe(200);
  });

  it("revokes in steps too: the batch stays marked live until the last step, then every question is back in review and offline", async () => {
    await as(1, "super_admin");
    const approval = (await one("select id from public.question_batch_approvals where batch_id=$1", [id(500)])).id;
    await as(2, "content_admin");
    await expect(revoke(approval)).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(1, "super_admin");
    await expect(revoke(approval, 100, "no")).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");
    const first = await revoke(approval);
    expect(first).toMatchObject({ done: false, returned_to_review: 100 });
    expect((await one("select status from public.question_batch_approvals where id=$1", [approval])).status).toBe("ACTIVE");
    const rest = await run(() => revoke(approval));
    expect(rest.at(-1)).toMatchObject({ done: true, returned_to_review: 250 });
    expect((await one("select status, in_progress from public.question_batch_approvals where id=$1", [approval]))).toMatchObject({ status: "REVOKED", in_progress: false });
    expect(await count(`tags[1] like '%${id(500)}%' and validation_status='review' and status::text='inactive' and reviewed_by is null`)).toBe(253);
    await expect(revoke(approval)).rejects.toThrow("QB_APPROVAL_NOT_ACTIVE");
    // and the batch can be approved again
    expect((await run(() => approve(id(500)))).at(-1)).toMatchObject({ done: true, approved: 250 });
  });

  it("discards a batch that was never approved, in steps: the real guard and the real status check let it through, nothing is deleted, other batches are untouched", async () => {
    await as(1, "super_admin");
    await expect(discard(id(503), 100, "short")).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");
    const first = await discard(id(502), 20);                                            // the stopped batch: 30 saved questions, steps of 20
    expect(first).toMatchObject({ done: false, withdrawn_now: 20 });
    expect((await batch(502)).status).toBe("DISCARDING");
    const last = await discard(id(502), 20);
    expect(last).toMatchObject({ done: true, withdrawn: 30 });
    const b = await batch(502);
    expect(b.status).toBe("DISCARDED");
    expect(b.completed_at).not.toBeNull();
    expect(b.file_sha256).not.toBe(HASH("c"));
    expect(b.file_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.report).toMatchObject({ discarded_by: id(1), discard_note: "File was wrong, loading it again.", original_file_sha256: HASH("c"), questions_withdrawn: 30, expected_rows: 2600, status_before_discard: "LOADING" });
    expect(await count(`tags[1] like '%${id(502)}%' and status::text='archived' and validation_status='rejected' and editorial_metadata->>'discarded_batch'='${id(502)}'`)).toBe(30);
    expect(await count("true")).toBe(253 + 200 + 30 + 10 + 1);                           // nothing deleted
    expect(await count(`tags[1] like '%${id(503)}%' and status::text='inactive'`)).toBe(10);   // others untouched
    // the same file can now start a fresh batch: its fingerprint is free
    await db.exec(`insert into public.question_load_batches(id,file_name,file_sha256,scope,status,uploaded_by) values('${id(600)}','c.csv','${HASH("c")}','CURRICULUM','LOADING','${id(1)}')`);
    await expect(discard(id(502))).rejects.toThrow("QB_BATCH_ALREADY_DISCARDED");
    expect((await one("select current_setting('quizbox.owner_batch', true) f")).f).not.toBe("on");
  });

  it("will not discard a batch that is live, or whose approval is only half done", async () => {
    await as(1, "super_admin");
    await expect(discard(id(500))).rejects.toThrow("QB_BATCH_IS_LIVE");                  // approved and live
    expect((await approve(id(503), 4)).done).toBe(false);                                // half-approved: 4 of 10
    await expect(discard(id(503))).rejects.toThrow("QB_BATCH_IS_LIVE");                  // revoke first
    expect(await count("status::text='archived'")).toBe(30);
    const approval = (await one("select id from public.question_batch_approvals where batch_id=$1 and status='ACTIVE'", [id(503)])).id;
    await run(() => revoke(approval));
    expect((await run(() => discard(id(503)))).at(-1)).toMatchObject({ done: true, withdrawn: 10 });
  });

  it("is available to signed-in users only, and the rollback removes the step functions", async () => {
    const g = await db.query<Record<string, any>>(`select has_function_privilege('anon','public.qb_owner_approve_batch_step(uuid,text,integer,boolean,integer)','execute') a,
      has_function_privilege('authenticated','public.qb_owner_approve_batch_step(uuid,text,integer,boolean,integer)','execute') b,
      has_function_privilege('authenticated','public.qb_owner_revoke_batch_approval_step(uuid,text,integer)','execute') c,
      has_function_privilege('authenticated','public.qb_owner_batch_discard_step(uuid,text,integer)','execute') d`);
    expect(g.rows[0]).toEqual({ a: false, b: true, c: true, d: true });
    await db.exec(MIGRATION);                                                            // idempotent
    await db.exec(ROLLBACK);
    expect((await one("select count(*)::int n from pg_proc where proname like 'qb_owner_%_step'")).n).toBe(0);
    expect(((await db.query("select to_regprocedure('public.qb_owner_approve_batch(uuid,text,integer,boolean)') f")).rows[0] as { f: unknown }).f).not.toBeNull();   // the originals are still there
  });
});
