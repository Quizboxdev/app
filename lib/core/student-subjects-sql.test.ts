import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// qb_student_set_subjects (migration 20261078100000): a learner sets their own subjects from the workspace, validated against the market list, with no profile-edit cost.
const MIG = "supabase/migrations/20261078100000_student_subjects.sql";
const U = "00000000-0000-0000-0000-0000000000a1", T = "00000000-0000-0000-0000-0000000000a2", M = "00000000-0000-0000-0000-0000000000a3";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.markets (id uuid primary key, configuration jsonb);
    create table public.profiles (id uuid primary key, role text, primary_market_id uuid, default_market_id uuid);
    create table public.student_profiles (id uuid primary key default gen_random_uuid(), user_id uuid, status text, managed_by uuid, subjects text[], updated_at timestamptz);
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    insert into public.markets values ('${M}', '{"subjects":[{"code":"MATH"},{"code":"ENG"},{"code":"SCI"}]}');
    insert into public.profiles values ('${U}', 'student', '${M}', null), ('${T}', 'teacher', '${M}', null);
    insert into public.student_profiles(user_id, status, subjects) values ('${U}', 'active', '{}');
  `);
  await db.exec(readFileSync(MIG, "utf8"));
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const set = (db: PGlite, list: string) => db.query<{ r: string[] }>(`select public.qb_student_set_subjects(${list}) as r`).then((x) => x.rows[0].r);

describe("qb_student_set_subjects", () => {
  it("saves the learner's subjects, sorted and without duplicates, and records an audit entry", async () => {
    const db = await setup(); await as(db, U);
    expect(await set(db, "array['SCI','MATH','MATH']")).toEqual(["MATH", "SCI"]);
    expect((await db.query<{ subjects: string[] }>("select subjects from public.student_profiles")).rows[0].subjects).toEqual(["MATH", "SCI"]);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.audit_logs where action = 'student_subjects_set'")).rows[0].n).toBe(1);
  });
  it("can be changed again and cleared with no limit", async () => {
    const db = await setup(); await as(db, U);
    for (const l of ["array['MATH']", "array['ENG','MATH']", "array['SCI']", "array[]::text[]"]) await set(db, l);
    expect((await db.query<{ subjects: string[] }>("select subjects from public.student_profiles")).rows[0].subjects).toEqual([]);
  });
  it("refuses a subject the market does not offer", async () => {
    const db = await setup(); await as(db, U);
    await expect(set(db, "array['MATH','WITCHCRAFT']")).rejects.toThrow(/INVALID_SUBJECT/);
  });
  it("refuses anyone who is not a signed-in student, and managed accounts", async () => {
    const db = await setup();
    await as(db, null); await expect(set(db, "array['MATH']")).rejects.toThrow(/QB_AUTHENTICATION_REQUIRED/);
    await as(db, T); await expect(set(db, "array['MATH']")).rejects.toThrow(/NOT_A_STUDENT/);
    await db.exec(`update public.student_profiles set managed_by = '${T}'`); await as(db, U);
    await expect(set(db, "array['MATH']")).rejects.toThrow(/MANAGED_ACCOUNT/);
  });
});
