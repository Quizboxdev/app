import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The admin dashboard function (migration 20261077100000): one read-only call, staff only, with each section isolated so a missing table does not break the others.
const MIG = "supabase/migrations/20261077100000_admin_dashboard.sql";
const STAFF = "00000000-0000-0000-0000-0000000000a1", USER = "00000000-0000-0000-0000-0000000000b1";

async function setup(withLearning = true) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create schema quizbox_market; create function quizbox_market.is_super() returns boolean language sql as $$ select false $$;
    create schema quizbox_core; create function quizbox_core.is_staff() returns boolean language sql as $$ select coalesce(current_setting('test.staff', true), '') = 'on' $$;
    create table public.profiles (id uuid primary key default gen_random_uuid(), role text, created_at timestamptz default now());
    create table public.questions (id uuid primary key default gen_random_uuid(), grade text, status text, validation_status text);
    create table public.question_load_batches (id uuid primary key default gen_random_uuid(), status text);
    create table public.question_batch_approvals (id uuid primary key default gen_random_uuid(), batch_id uuid, status text);
    create table public.support_requests (id uuid primary key default gen_random_uuid(), status text, created_at timestamptz default now());
    create table public.markets (id uuid primary key default gen_random_uuid(), status text);
    ${withLearning ? "create table public.attempts (id uuid primary key default gen_random_uuid(), started_at timestamptz default now(), submitted_at timestamptz);" : ""}
    insert into public.profiles(role, created_at) values ('student', now()), ('student', now() - interval '3 days'), ('teacher', now() - interval '10 days'), ('student', now() - interval '40 days');
    insert into public.questions(grade, status, validation_status) values ('B4','active','approved'), ('B4','active','approved'), ('B4','inactive','review'), ('B7','active','approved'), ('B7','archived','review');
    insert into public.question_load_batches(status) values ('LOADED'), ('LOADED'), ('PARTIAL'), ('DISCARDED');
    insert into public.support_requests(status) values ('open'), ('open'), ('resolved');
    insert into public.markets(status) values ('ACTIVE'), ('CONFIGURING'), ('CONFIGURING');
  `);
  await db.exec(`insert into public.question_batch_approvals(batch_id, status) select id, 'ACTIVE' from public.question_load_batches where status = 'PARTIAL'`);
  if (withLearning) await db.exec(`insert into public.attempts(started_at, submitted_at) values (now(), now()), (now(), null), (now() - interval '9 days', now() - interval '9 days')`);
  await db.exec(readFileSync(MIG, "utf8"));
  return db;
}
const as = (db: PGlite, uid: string | null, staff = false) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false), set_config('test.staff', '${staff ? "on" : ""}', false)`);
const dash = async (db: PGlite, days = 30) => (await db.query<{ r: any }>(`select public.qb_admin_dashboard(${days}) as r`)).rows[0].r;

describe("admin dashboard", () => {
  it("is for staff only", async () => {
    const db = await setup();
    await as(db, USER);
    await expect(db.query(`select public.qb_admin_dashboard()`)).rejects.toThrow(/QB_FORBIDDEN/);
    await as(db, null);
    await expect(db.query(`select public.qb_admin_dashboard()`)).rejects.toThrow(/QB_FORBIDDEN/);
  });
  it("reports users, activity, content, queues, markets and a daily series", async () => {
    const db = await setup(); await as(db, STAFF, true);
    const d = await dash(db, 30);
    expect(d.days).toBe(30);
    expect(d.users).toMatchObject({ total: 4, new_7d: 2, new_prev_7d: 1, by_role: { student: 3, teacher: 1 } });
    expect(d.users.signups).toHaveLength(30);
    expect(d.users.signups[29]).toMatchObject({ added: 1 });
    expect(d.users.signups[0].week).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(d.learning).toMatchObject({ attempts_7d: 2, attempts_prev_7d: 1, attempts_total: 3 });
    expect(d.learning.daily[29]).toMatchObject({ started: 2, submitted: 1 });
    expect(d.content).toMatchObject({ live: 3, in_review: 1, batches_waiting: 2 });
    expect(d.content.by_class).toEqual([{ grade: "B4", live: 2, in_review: 1 }, { grade: "B7", live: 1, in_review: 0 }]);
    expect(d.queues).toMatchObject({ support_open: 2, support_waiting_for_user: 0 });
    expect(d.markets).toEqual({ ACTIVE: 1, CONFIGURING: 2 });
  });
  it("keeps the other sections when one table does not exist", async () => {
    const db = await setup(false); await as(db, STAFF, true);
    const d = await dash(db, 7);
    expect(d.learning).toBeNull();
    expect(d.schools).toBeNull();          // the directory table is not there in this stand-in schema
    expect(d.users.total).toBe(4);
    expect(d.users.signups).toHaveLength(7);
    expect(d.content.live).toBe(3);
  });
  it("limits the window to 7 to 90 days", async () => {
    const db = await setup(); await as(db, STAFF, true);
    expect((await dash(db, 3)).days).toBe(7);
    expect((await dash(db, 500)).days).toBe(90);
  });
});
