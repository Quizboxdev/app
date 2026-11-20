import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A learner who joins a class after work was published to it now receives that work (20261118110000), on an isolated PostgreSQL.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261118110000_class_join_assignment_catch_up.sql");
const ROLLBACK = read("../../supabase/rollback/class_join_assignment_catch_up.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLASS = id(1), FAMILY_CLASS = id(2), OTHER_CLASS = id(3), WORKSPACE = id(9);
let db: PGlite;
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const targets = async (student: string) => Number((await one("select count(*) n from public.assignment_targets where student_id = $1", [student])).n);
const assign = (n: number, cls: string, over: { status?: string; mode?: string; due?: string | null } = {}) =>
  db.query("insert into public.assignments(id, class_id, status, recipient_mode, due_at) values ($1,$2,$3,$4,$5)", [id(200 + n), cls, over.status ?? "published", over.mode ?? "class", over.due === undefined ? null : over.due]);
const join = (n: number, cls: string, status = "active") => db.query("insert into public.class_memberships(id, class_id, student_id, status) values ($1,$2,$3,$4)", [id(300 + n), cls, id(100 + n), status]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create type public.qb_status as enum ('active','inactive');
    create type public.assignment_status as enum ('draft','published','closed');
    create type public.recipient_mode as enum ('class','selected');
    create schema quizbox_private;
    create table public.classes(id uuid primary key, family_workspace_id uuid);
    create table public.assignments(id uuid primary key, class_id uuid, status public.assignment_status, recipient_mode public.recipient_mode, due_at timestamptz);
    create table public.class_memberships(id uuid primary key, class_id uuid, student_id uuid, status public.qb_status, unique(class_id, student_id));
    create table public.assignment_targets(id uuid primary key default gen_random_uuid(), assignment_id uuid, class_id uuid, student_id uuid, membership_id uuid, status public.qb_status default 'active', unique(assignment_id, student_id));
    insert into public.classes values ('${CLASS}', null), ('${FAMILY_CLASS}', '${WORKSPACE}'), ('${OTHER_CLASS}', null);
  `);
  // Work that existed before the migration, and a member who is already in the class (the backfill case).
  await assign(1, CLASS); await assign(2, CLASS, { mode: "selected" }); await assign(3, CLASS, { status: "draft" });
  await assign(4, CLASS, { due: "2000-01-01T00:00:00Z" }); await assign(5, CLASS, { due: "2999-01-01T00:00:00Z" });
  await assign(6, FAMILY_CLASS); await assign(7, OTHER_CLASS);
  await join(1, CLASS); await join(9, FAMILY_CLASS);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("a learner who joins after work was published", () => {
  it("the backfill gives a current member the open class-wide work only", async () => {
    // Open class-wide work: assignments 1 (no due date) and 5 (due far ahead). Not 2 (chosen learners), 3 (draft), 4 (past due).
    const rows = (await db.query<{ assignment_id: string }>("select assignment_id from public.assignment_targets where student_id = $1 order by assignment_id", [id(101)])).rows.map((r) => r.assignment_id);
    expect(rows).toEqual([id(201), id(205)]);
  });
  it("a new member receives the same open work and nothing else", async () => {
    await join(2, CLASS);
    const rows = (await db.query<{ assignment_id: string }>("select assignment_id from public.assignment_targets where student_id = $1 order by assignment_id", [id(102)])).rows.map((r) => r.assignment_id);
    expect(rows).toEqual([id(201), id(205)]);
  });
  it("the target points at the member's own membership and class", async () => {
    const r = await one("select membership_id, class_id from public.assignment_targets where student_id = $1 and assignment_id = $2", [id(102), id(201)]);
    expect(r.membership_id).toBe(id(302)); expect(r.class_id).toBe(CLASS);
  });
  it("work in another class is not added", async () => { expect(await targets(id(102))).toBe(2); });
  it("a family class is left alone", async () => { expect(await targets(id(109))).toBe(0); });
  it("an inactive membership gets nothing until it becomes active, then it does", async () => {
    await join(3, CLASS, "inactive");
    expect(await targets(id(103))).toBe(0);
    await db.query("update public.class_memberships set status = 'active' where id = $1", [id(303)]);
    expect(await targets(id(103))).toBe(2);
  });
  it("rejoining does not duplicate targets", async () => {
    await db.query("update public.class_memberships set status = 'inactive' where id = $1", [id(302)]);
    await db.query("update public.class_memberships set status = 'active' where id = $1", [id(302)]);
    expect(await targets(id(102))).toBe(2);
  });
  it("running the migration again changes nothing", async () => {
    await db.exec(MIGRATION);
    expect(await targets(id(101))).toBe(2);
  });
});

describe("rollback", () => {
  it("joining stops adding work, and the rows already added stay", async () => {
    await db.exec(ROLLBACK);
    await join(4, CLASS);
    expect(await targets(id(104))).toBe(0);
    expect(await targets(id(102))).toBe(2);
  });
});
