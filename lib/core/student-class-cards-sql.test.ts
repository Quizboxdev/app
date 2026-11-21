import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// qb_student_class_cards (migration 20261121100000): a learner sees only their own active classes, with the teacher's name, the learner count and the open work.
const SQL = readFileSync("supabase/migrations/20261121100000_student_class_cards.sql", "utf8");
const S1 = "00000000-0000-0000-0000-0000000000a1", S2 = "00000000-0000-0000-0000-0000000000a2", T1 = "00000000-0000-0000-0000-0000000000b1";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create type public.qb_status as enum ('active', 'archived'); create type public.assignment_status as enum ('draft', 'published');
    create table public.profiles (id uuid primary key, full_name text);
    create table public.classes (id uuid primary key default gen_random_uuid(), class_name text, teacher_user_id uuid);
    create table public.class_memberships (id uuid primary key default gen_random_uuid(), class_id uuid, student_user_id uuid, status public.qb_status default 'active', joined_at timestamptz default now());
    create table public.assignments (id uuid primary key default gen_random_uuid(), class_id uuid, status public.assignment_status, due_at timestamptz);
    create role authenticated; create role anon;
    insert into public.profiles values ('${S1}', 'Ama'), ('${S2}', 'Kojo'), ('${T1}', 'Mrs Owusu');
    insert into public.classes(id, class_name, teacher_user_id) values ('11111111-1111-1111-1111-111111111111', 'Class A', '${T1}'), ('22222222-2222-2222-2222-222222222222', 'Class B', null);
    insert into public.class_memberships(class_id, student_user_id, status) values
      ('11111111-1111-1111-1111-111111111111', '${S1}', 'active'), ('11111111-1111-1111-1111-111111111111', '${S2}', 'active'),
      ('22222222-2222-2222-2222-222222222222', '${S1}', 'archived');
    insert into public.assignments(class_id, status, due_at) values
      ('11111111-1111-1111-1111-111111111111', 'published', null), ('11111111-1111-1111-1111-111111111111', 'published', now() + interval '1 day'),
      ('11111111-1111-1111-1111-111111111111', 'published', now() - interval '1 day'), ('11111111-1111-1111-1111-111111111111', 'draft', null);
  `);
  await db.exec(SQL);
  return db;
}
const cards = async (db: PGlite, uid: string | null) => {
  await db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
  return (await db.query<{ r: any[] }>("select public.qb_student_class_cards() as r")).rows[0].r;
};

describe("qb_student_class_cards", () => {
  it("returns the teacher name, learner count and open work for an active class only", async () => {
    const db = await setup();
    const r = await cards(db, S1);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ class_id: "11111111-1111-1111-1111-111111111111", teacher_name: "Mrs Owusu", learners: 2, open_assignments: 2 });
  });
  it("returns nothing for a signed-out caller and never another learner's classes", async () => {
    const db = await setup();
    expect(await cards(db, null)).toEqual([]);
    expect((await cards(db, S2)).map((c: any) => c.class_id)).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });
  it("returns no teacher contact details", async () => {
    const db = await setup();
    expect(Object.keys((await cards(db, S1))[0]).sort()).toEqual(["class_id", "learners", "open_assignments", "teacher_name"]);
  });
  it("is safe to run twice", async () => { const db = await setup(); await db.exec(SQL); });
});
