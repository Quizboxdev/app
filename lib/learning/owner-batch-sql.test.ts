import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const SME = read("../../supabase/migrations/20261002200000_market_sme_foundation.sql");
const MIGRATION = read("../../supabase/migrations/20261014110000_owner_batch_approval.sql");
const ROLLBACK = read("../../supabase/rollback/owner_batch_approval.sql");
// The production review guard, taken verbatim from the migration that created it.
const GUARD = SME.slice(SME.indexOf("create function quizbox_sme.managed_review_guard()"), SME.indexOf("create trigger zz_sme_managed_review_guard"));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const BATCH = id(500);
const approve = (sample = 25, note = "Read 25 of 100 questions; sound.") => one("select public.qb_owner_approve_batch($1,$2,$3) v", [BATCH, note, sample]);

// users: 1 owner (super_admin), 2 teacher, 3 owner too. Batch 500 has 5 questions: 4 valid, 1 with a validation error, all in review; batch 501 is not loaded yet.
describe("owner-approved batch (isolated PostgreSQL; the production guard function is installed verbatim)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema quizbox_sme; create schema quizbox_market; create schema quizbox_core;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select position(p in coalesce(current_setting('test.caps',true),'')) > 0 $$;
      create function quizbox_market.is_super() returns boolean language sql stable as $$ select quizbox_sme.has_capability('super_admin') $$;
      create table public.platform_settings(key text, value jsonb);
      create function quizbox_core.setting(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns jsonb language sql stable as $$ select value from public.platform_settings where key = p_key $$;
      create table public.audit_stub(action text, entity uuid, details jsonb);
      create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql as $$ insert into public.audit_stub values (p_action, p_entity, p_details) $$;
      create table public.profiles(id uuid primary key);
      create table public.question_load_batches(id uuid primary key, file_name text, status text);
      create table public.questions(id uuid primary key default gen_random_uuid(), version integer default 1, validation_status text default 'review', status text default 'inactive',
        reviewed_by uuid, reviewed_at timestamptz, editorial_metadata jsonb default '{}', tags text[] default '{}', question_text text, option_a text, option_b text, option_c text,
        option_d text, correct_answer text, difficulty_label text, curriculum_id uuid);
      create function public.qb_content_validation_errors(p jsonb) returns jsonb language sql stable as $$ select case when p->>'question_text' like '%BAD%' then '["X"]'::jsonb else '[]'::jsonb end $$;
      create function public.qb_question_is_available(q public.questions) returns boolean language sql stable as
        $$ select q.status = 'active' and q.validation_status = 'approved' and public.qb_content_validation_errors(to_jsonb(q)) = '[]'::jsonb $$;
      -- dependencies of the production guard
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
      insert into public.profiles values('${id(1)}'),('${id(2)}'),('${id(3)}');
      insert into public.question_load_batches values('${BATCH}','b5.csv','LOADED'),('${id(501)}','later.csv','CHECKED');
      insert into public.questions(question_text, tags) values ('Q1','{"source:QL:${BATCH}:1"}'),('Q2','{"source:QL:${BATCH}:2"}'),('Q3','{"source:QL:${BATCH}:3"}'),('Q4','{"source:QL:${BATCH}:4"}'),
        ('BAD question','{"source:QL:${BATCH}:5"}'),('Other batch','{"source:QL:${id(501)}:1"}');
    `);
    await db.exec(GUARD); await db.exec("create trigger zz_sme_managed_review_guard before update on public.questions for each row execute function quizbox_sme.managed_review_guard()");
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("the production guard blocks even a super admin from approving without a subject domain (the problem this solves)", async () => {
    await as(1, "super_admin");
    await expect(db.exec(`update public.questions set validation_status='approved', reviewed_by='${id(1)}', reviewed_at=now(), editorial_metadata='{"human_reviewed":true}' where question_text='Q1'`)).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
    await db.exec(MIGRATION);
    await db.exec("grant select on all tables in schema public to authenticated");
  });

  it("previews without changing anything, and only for a super admin", async () => {
    await as(2, "content_admin");
    await expect(one("select public.qb_owner_batch_preview($1) v", [BATCH])).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(1, "super_admin");
    const p = (await one("select public.qb_owner_batch_preview($1) v", [BATCH])).v;
    expect(p).toMatchObject({ questions_found: 5, would_approve: 4, already_available_to_learners: 0, min_sample_required: 20 });
    expect(p.by_state).toEqual({ "review/inactive": 5 });
    expect(p.sample.length).toBe(5);
    expect((await one("select count(*)::int n from public.questions where validation_status='review'")).n).toBe(6);
  });

  it("refuses without super admin, a loaded batch, a long enough note or a big enough sample", async () => {
    await as(2, "content_admin");
    await expect(approve()).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(1, "super_admin");
    await expect(one("select public.qb_owner_approve_batch($1,$2,$3) v", [id(501), "Read the whole sample carefully.", 25])).rejects.toThrow("QB_BATCH_NOT_LOADED");
    await expect(approve(5)).rejects.toThrow("QB_OWNER_SAMPLE_TOO_SMALL");
    await expect(approve(25, "short")).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");
    expect((await one("select count(*)::int n from public.question_batch_approvals")).n).toBe(0);
  });

  it("approves only the valid questions of that batch, publishes them, labels them honestly and resets the flag", async () => {
    await as(1, "super_admin");
    const r = (await approve()).v;
    expect(r).toMatchObject({ questions_found: 5, approved: 4, skipped: 1, published: true });
    const rows = (await db.query<Record<string, any>>("select question_text, validation_status, status, reviewed_by, editorial_metadata m from public.questions order by question_text")).rows;
    const by = Object.fromEntries(rows.map((x) => [x.question_text, x]));
    expect(by.Q1).toMatchObject({ validation_status: "approved", status: "active", reviewed_by: id(1) });
    expect(by.Q1.m).toMatchObject({ approval_basis: "OWNER_BATCH", human_reviewed: true, approval_id: r.approval_id });
    expect(by["BAD question"]).toMatchObject({ validation_status: "review", status: "inactive" });      // invalid: left for review
    expect(by["Other batch"]).toMatchObject({ validation_status: "review", status: "inactive" });       // another batch: untouched
    expect((await one("select count(*)::int n from public.questions q where public.qb_question_is_available(q)")).n).toBe(4);
    expect((await one("select current_setting('quizbox.owner_batch', true) f")).f).not.toBe("on");   // transaction-local: gone after the call
    expect((await one("select count(*)::int n from public.audit_stub where action='questions.owner_batch_approved'")).n).toBe(1);
    // outside the function the guard is back: a super admin still cannot approve by hand
    await expect(db.exec(`update public.questions set validation_status='approved', reviewed_by='${id(1)}', reviewed_at=now(), editorial_metadata='{"human_reviewed":true}' where question_text='Other batch'`)).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
    await expect(approve()).rejects.toThrow("QB_BATCH_ALREADY_APPROVED");
  });

  it("revokes cleanly: the questions return to review and offline, and the batch can be approved again", async () => {
    await as(1, "super_admin");
    const a = (await one("select id from public.question_batch_approvals where status='ACTIVE'")).id;
    await as(2, "content_admin");
    await expect(one("select public.qb_owner_revoke_batch_approval($1,$2) v", [a, "Reviewers will take over."])).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(1, "super_admin");
    await expect(one("select public.qb_owner_revoke_batch_approval($1,$2) v", [a, "no"])).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");
    expect((await one("select public.qb_owner_revoke_batch_approval($1,$2) v", [a, "Reviewers will take over this batch."])).v).toMatchObject({ returned_to_review: 4 });
    const q1 = await one("select validation_status, status, reviewed_by, editorial_metadata m from public.questions where question_text='Q1'");
    expect(q1).toMatchObject({ validation_status: "review", status: "inactive", reviewed_by: null });
    expect(q1.m.approval_basis).toBeUndefined();
    expect((await one("select count(*)::int n from public.questions q where public.qb_question_is_available(q)")).n).toBe(0);
    expect((await approve(30)).v).toMatchObject({ approved: 4 });
  });

  it("rolls back cleanly: the original guard is back and the objects are gone", async () => {
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regprocedure('public.qb_owner_approve_batch(uuid,text,integer,boolean)') f")).rows[0]).toEqual({ f: null });
    await as(1, "super_admin");
    await expect(db.exec(`update public.questions set validation_status='approved', reviewed_by='${id(1)}', reviewed_at=now(), editorial_metadata='{"human_reviewed":true}' where question_text='Other batch'`)).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
  });
});
