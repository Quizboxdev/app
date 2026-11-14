import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The owner batch steps (approve, revoke, discard) must behave as before while finding a batch through the index (migrations 20261072100000 and 20261073100000). Runs the real migration SQL on a small stand-in schema.
const MIG = "supabase/migrations";
const A = "7a5d568d-0006-46ef-b6d4-9c260eaac16a", B = "11111111-2222-3333-4444-555555555555";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
    create schema quizbox_market; create function quizbox_market.is_super() returns boolean language sql as $$ select true $$;
    create table public.question_load_batches (id uuid primary key, file_name text, status text, file_sha256 text, report jsonb default '{}'::jsonb, completed_at timestamptz);
    create table public.questions (id uuid primary key default gen_random_uuid(), tags text[], validation_status text, status text, reviewed_by uuid, reviewed_at timestamptz, editorial_metadata jsonb);
    create table public.question_batch_approvals (id uuid primary key default gen_random_uuid(), batch_id uuid, approved_by uuid, note text, sample_reviewed integer, questions_approved integer not null default 0,
      questions_skipped integer not null default 0, published boolean not null default true, status text not null default 'ACTIVE', in_progress boolean not null default false, created_at timestamptz default now(), revoked_at timestamptz, revoked_by uuid, revoke_note text);
    create function public.qb_content_validation_errors(j jsonb) returns jsonb language sql as $$ select case when (j -> 'tags') ? 'invalid' then '["bad"]'::jsonb else '[]'::jsonb end $$;
    create function public.qb_question_is_available(q public.questions) returns boolean language sql as $$ select true $$;
  `);
  for (const f of ["20261072100000_batch_preview_fast.sql", "20261073100000_owner_batch_steps_fast.sql"]) await db.exec(readFileSync(`${MIG}/${f}`, "utf8"));
  await db.exec(`insert into public.question_load_batches values ('${A}', 'a.csv', 'LOADED', 'sha-a'), ('${B}', 'b.csv', 'LOADED', 'sha-b')`);
  await db.exec(`insert into public.questions(tags, validation_status, status, editorial_metadata) select array['source:QL:${A}:' || g], 'review', 'inactive', '{}' from generate_series(1, 250) g`);
  await db.exec(`insert into public.questions(tags, validation_status, status, editorial_metadata) select array['source:QL:${A}:' || (250 + g), 'invalid'], 'review', 'inactive', '{}' from generate_series(1, 3) g`);
  await db.exec(`insert into public.questions(tags, validation_status, status, editorial_metadata) select array['source:QL:${B}:' || g], 'review', 'inactive', '{}' from generate_series(1, 120) g`);
  return db;
}
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;

describe("owner batch steps use the batch index and keep their behaviour", () => {
  it("approves in steps of 100, skips invalid questions, and leaves other batches alone", async () => {
    const db = await setup();
    const call = () => one(db, `select public.qb_owner_approve_batch_step('${A}', 'Read 20 questions and their answers. Approved for loading', 20, true, 100) as r`);
    const s1 = await call(), s2 = await call(), s3 = await call();
    expect([s1.done, s1.approved]).toEqual([false, 100]);
    expect([s2.done, s2.approved]).toEqual([false, 200]);
    expect(s3).toMatchObject({ done: true, approved: 250, skipped: 3, questions_found: 253 });
    const live = await one(db, `select count(*)::int as r from public.questions where status = 'active' and validation_status = 'approved'`);
    expect(live).toBe(250);
    const other = await one(db, `select count(*)::int as r from public.questions where tags[1] like 'source:QL:${B}:%' and validation_status = 'review'`);
    expect(other).toBe(120);
    await expect(call()).rejects.toThrow(/QB_BATCH_ALREADY_APPROVED/);
  });
  it("revokes an approval in steps and returns the questions to review", async () => {
    const db = await setup();
    for (let i = 0; i < 3; i++) await db.exec(`select public.qb_owner_approve_batch_step('${A}', 'Read 20 questions and their answers. Approved for loading', 20, true, 100)`);
    const id = await one(db, `select id::text as r from public.question_batch_approvals where batch_id = '${A}'`);
    let last: any;
    for (let i = 0; i < 4 && !(last && last.done); i++) last = await one(db, `select public.qb_owner_revoke_batch_approval_step('${id}', 'Revoking for the test run', 100) as r`);
    expect(last).toMatchObject({ done: true, returned_to_review: 250 });
    expect(await one(db, `select count(*)::int as r from public.questions where validation_status = 'approved'`)).toBe(0);
    expect(await one(db, `select status as r from public.question_batch_approvals where id = '${id}'`)).toBe("REVOKED");
  });
  it("discards an unapproved batch in steps and frees its file fingerprint", async () => {
    const db = await setup();
    const s1 = await one(db, `select public.qb_owner_batch_discard_step('${B}', 'Discarding this batch in the test', 100) as r`);
    const s2 = await one(db, `select public.qb_owner_batch_discard_step('${B}', 'Discarding this batch in the test', 100) as r`);
    expect(s1.done).toBe(false);
    expect(s2).toMatchObject({ done: true, withdrawn: 120 });
    expect(await one(db, `select count(*)::int as r from public.questions where tags[1] like 'source:QL:${B}:%' and status = 'archived'`)).toBe(120);
    expect(await one(db, `select (file_sha256 <> 'sha-b')::text as r from public.question_load_batches where id = '${B}'`)).toBe("true");
    expect(await one(db, `select count(*)::int as r from public.questions where tags[1] like 'source:QL:${A}:%' and status = 'archived'`)).toBe(0);
  });
});
