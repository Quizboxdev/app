import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const SME = read("../../supabase/migrations/20261002200000_market_sme_foundation.sql");
const GOVERNANCE = read("../../supabase/migrations/20261002150000_question_factory_governance.sql");
const OWNER = read("../../supabase/migrations/20261014110000_owner_batch_approval.sql");
const TOPICS = read("../../supabase/migrations/20261012100000_topic_registry.sql");
const STEPS = read("../../supabase/migrations/20261052100000_owner_batch_steps.sql");
const FAST = read("../../supabase/migrations/20261072100000_batch_preview_fast.sql");
const MIGRATION = read("../../supabase/migrations/20261118100000_script_checked_batch_approval.sql");
const ROLLBACK = read("../../supabase/rollback/script_checked_batch_approval.sql");
// Taken verbatim from the migrations that created them: the review guard, the batch table and the batch-tag helper.
const GUARD = SME.slice(SME.indexOf("create function quizbox_sme.managed_review_guard()"), SME.indexOf("create trigger zz_sme_managed_review_guard"));
const BATCH_TABLE = TOPICS.slice(TOPICS.indexOf("create table public.question_load_batches ("), TOPICS.indexOf(");", TOPICS.indexOf("create table public.question_load_batches (")) + 2);
const QL_BATCHES = FAST.slice(FAST.indexOf("create or replace function public.qb_ql_batches"), FAST.indexOf("$fn$;", FAST.indexOf("create or replace function public.qb_ql_batches")) + 5);
// The editorial rule line the migration patches, exactly as the real guard has it.
const RULE = "if new.reviewed_by is null or new.reviewed_at is null or new.editorial_metadata->>'human_reviewed' is distinct from 'true' then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if;";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HASH = (c: string) => c.repeat(64);
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const count = async (where: string) => (await one(`select count(*)::int n from public.questions where ${where}`)).n as number;
const scripted = (batch: string, limit = 100, basis: string | null = "SCRIPT_CHECKED", note = "Script check (no human read): 20 of 25 sampled; 0 flagged.") =>
  one("select public.qb_owner_approve_batch_step($1,$2,$3,true,$4,$5) v", [batch, note, 20, limit, basis]).then((r) => r.v);
const owner = (batch: string, limit = 100) => one("select public.qb_owner_approve_batch_step($1,$2,$3,true,$4) v", [batch, "Read 25 of 250 questions; sound.", 25, limit]).then((r) => r.v);
const revoke = (approval: string) => one("select public.qb_owner_revoke_batch_approval_step($1,$2,$3) v", [approval, "Reviewers will take over this batch.", 100]).then((r) => r.v);
const meta = (text: string) => one("select editorial_metadata m, reviewed_by, status::text st, validation_status vs from public.questions where question_text=$1", [text]);

// Batches: 700 (25 valid), 701 (25 valid, for the owner basis), 702 (30 valid, approved in two steps), 703 (25 valid, for the revoke test), 704 (25 valid, for the rollback test).
describe("script-checked batch approval (isolated PostgreSQL; production review guard, batch table and tag helper installed verbatim)", () => {
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
      create function public.qb_content_validation_errors(p jsonb) returns jsonb language sql stable as $$ select '[]'::jsonb $$;
      create function public.qb_question_is_available(q public.questions) returns boolean language sql stable as $$ select q.status::text = 'active' and q.validation_status = 'approved' $$;
      create table public.sme_domain_assignments(id uuid primary key, reviewer_id uuid);
      create table public.sme_review_assignments(id uuid primary key, question_id uuid, reviewer_id uuid, review_completed_at timestamptz, question_version integer, review_kind text);
      create table public.sme_review_events(id uuid primary key, assignment_id uuid, decision text, review_completed_at timestamptz);
      create table public.curricula(id uuid primary key, market_id uuid);
      create table public.markets(id uuid primary key, configuration jsonb);
      create function quizbox_sme.domain_matches(a uuid, b uuid, c uuid, d uuid, e boolean, f boolean) returns boolean language sql as $$ select false $$;
      -- the platform's editorial guard, reduced to the rule the migration patches (the rule line itself is the production text)
      create function public.qb_question_editorial_guard() returns trigger language plpgsql security definer set search_path = '' as $g$ begin
        if new.validation_status = 'approved' and (tg_op = 'INSERT' or old.validation_status is distinct from 'approved') then
          ${RULE}
        end if; return new; end $g$;
      create trigger a_editorial before insert or update on public.questions for each row execute function public.qb_question_editorial_guard();
      insert into public.profiles values('${id(1)}'),('${id(2)}');
    `);
    await db.exec(QL_BATCHES);
    for (const [n, rows, h] of [[700, 25, "a"], [701, 25, "b"], [702, 30, "c"], [703, 25, "d"], [704, 25, "e"]] as const) {
      await db.exec(`insert into public.question_load_batches(id, file_name, file_sha256, scope, status, rows_total, rows_loaded, uploaded_by, report) values
        ('${id(n)}','f${n}.csv','${HASH(h)}','CURRICULUM','LOADED',${rows},${rows},'${id(1)}','{}')`);
      await db.exec(`insert into public.questions(question_text, tags) select 'Q${n}-'||g, array['source:QL:${id(n)}:'||g] from generate_series(1,${rows}) g`);
    }
    await db.exec(GUARD); await db.exec("create trigger zz_sme_managed_review_guard before update on public.questions for each row execute function quizbox_sme.managed_review_guard()");
    await db.exec(OWNER);
    await db.exec(STEPS);
    await db.exec(MIGRATION);
    await db.exec("grant select on all tables in schema public to authenticated");
  }, 120_000);
  afterAll(async () => { await db.close(); });

  it("patches a rule line that really exists in the production editorial guard", () => {
    expect(GOVERNANCE).toContain(RULE);
    expect(MIGRATION).toContain("EDITORIAL_GUARD_CONTRACT_MISMATCH");
  });

  it("approves on the script basis: the approval and every question say so, and nothing claims a human read", async () => {
    await as(1, "super_admin");
    const r = await scripted(id(700));
    expect(r).toMatchObject({ done: true, approved: 25, skipped: 0, published: true, basis: "SCRIPT_CHECKED" });
    expect(await one("select basis, status, in_progress, sample_reviewed from public.question_batch_approvals where batch_id=$1", [id(700)])).toMatchObject({ basis: "SCRIPT_CHECKED", status: "ACTIVE", in_progress: false, sample_reviewed: 20 });
    const q = await meta("Q700-1");
    expect(q).toMatchObject({ st: "active", vs: "approved", reviewed_by: id(1) });
    expect(q.m).toMatchObject({ human_reviewed: false, approval_basis: "SCRIPT_CHECKED" });
    expect(q.m.review_note).toMatch(/No person read the sample/);
    expect(await count("validation_status='approved' and editorial_metadata->>'human_reviewed'='true' and tags[1] like '%" + id(700) + "%'")).toBe(0);
    expect((await one("select current_setting('quizbox.owner_batch', true) f")).f).not.toBe("on");
  });

  it("leaves the owner approval exactly as it was: the default basis still stamps human_reviewed", async () => {
    await as(1, "super_admin");
    expect(await owner(id(701))).toMatchObject({ done: true, approved: 25, basis: "OWNER_BATCH" });
    expect((await meta("Q701-1")).m).toMatchObject({ human_reviewed: true, approval_basis: "OWNER_BATCH", review_note: "Owner-approved batch after a sample read (not subject-expert reviewed)" });
    expect((await one("select basis from public.question_batch_approvals where batch_id=$1", [id(701)])).basis).toBe("OWNER_BATCH");
  });

  it("is for a super admin only, refuses an unknown basis, a small sample and a short note", async () => {
    await as(2, "content_admin");
    await expect(scripted(id(703))).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(1, "super_admin");
    await expect(scripted(id(703), 100, "SOMETHING_ELSE")).rejects.toThrow("QB_APPROVAL_BASIS_INVALID");
    await expect(one("select public.qb_owner_approve_batch_step($1,$2,$3,true,100,'SCRIPT_CHECKED')", [id(703), "Script check, 5 sampled", 5])).rejects.toThrow("QB_OWNER_SAMPLE_TOO_SMALL");
    await expect(scripted(id(703), 100, "SCRIPT_CHECKED", "short")).rejects.toThrow("QB_APPROVAL_NOTE_REQUIRED");
    expect((await one("select count(*)::int n from public.question_batch_approvals where batch_id=$1", [id(703)])).n).toBe(0);
  });

  it("keeps its basis across steps, even when a later step asks for the default", async () => {
    await as(1, "super_admin");
    expect(await scripted(id(702), 20)).toMatchObject({ done: false, approved: 20, basis: "SCRIPT_CHECKED" });
    expect(await owner(id(702), 20)).toMatchObject({ done: true, approved: 30, basis: "SCRIPT_CHECKED" });   // continuing step ignores the argument
    expect(await count(`tags[1] like '%${id(702)}%' and editorial_metadata->>'human_reviewed'='false' and editorial_metadata->>'approval_basis'='SCRIPT_CHECKED'`)).toBe(30);
  });

  it("cannot be used outside the owner-batch functions: a super admin approving by hand with the basis written into the question is still refused", async () => {
    await as(1, "super_admin");
    await expect(db.exec(`update public.questions set validation_status='approved', reviewed_by='${id(1)}', reviewed_at=now(), editorial_metadata='{"approval_basis":"SCRIPT_CHECKED"}' where question_text='Q703-1'`)).rejects.toThrow("QB_HUMAN_REVIEW_REQUIRED");
    await db.exec("select set_config('quizbox.owner_batch','on',false)");   // even with the flag, a non-super cannot use it
    await as(2, "content_admin");
    await expect(db.exec(`update public.questions set validation_status='approved', reviewed_by='${id(2)}', reviewed_at=now(), editorial_metadata='{"approval_basis":"SCRIPT_CHECKED"}' where question_text='Q703-1'`)).rejects.toThrow("QB_HUMAN_REVIEW_REQUIRED");
    await db.exec("select set_config('quizbox.owner_batch','off',false)");
  });

  it("revokes a script approval like any other: every question is back in review, offline and without a stamp", async () => {
    await as(1, "super_admin");
    await scripted(id(703));
    const approval = (await one("select id from public.question_batch_approvals where batch_id=$1", [id(703)])).id;
    expect(await revoke(approval)).toMatchObject({ done: true, returned_to_review: 25 });
    expect(await count(`tags[1] like '%${id(703)}%' and validation_status='review' and status::text='inactive' and reviewed_by is null and editorial_metadata->>'approval_basis' is null`)).toBe(25);
  });

  it("is for signed-in users only, is safe to apply twice, and the rollback restores the guard and the original function", async () => {
    const g = await db.query<Record<string, any>>(`select has_function_privilege('anon','public.qb_owner_approve_batch_step(uuid,text,integer,boolean,integer,text)','execute') a, has_function_privilege('authenticated','public.qb_owner_approve_batch_step(uuid,text,integer,boolean,integer,text)','execute') b`);
    expect(g.rows[0]).toEqual({ a: false, b: true });
    await db.exec(MIGRATION);   // applying it again changes nothing and does not fail
  });

  it("rollback: the script basis stops working and the owner basis still does", async () => {
    await as(1, "super_admin");
    await db.exec(ROLLBACK);
    await expect(scripted(id(704))).rejects.toThrow();
    expect(await one("select public.qb_owner_approve_batch_step($1,$2,$3,true,100) v", [id(704), "Read 25 of 25 questions; sound.", 25]).then((r) => r.v)).toMatchObject({ done: true, approved: 25 });
    expect((await meta("Q704-1")).m).toMatchObject({ human_reviewed: true, approval_basis: "OWNER_BATCH" });
    await expect(db.exec(`update public.questions set validation_status='approved', reviewed_by='${id(1)}', reviewed_at=now(), editorial_metadata='{"approval_basis":"SCRIPT_CHECKED"}' where question_text='Q703-2'`)).rejects.toThrow("QB_HUMAN_REVIEW_REQUIRED");
  });
});
