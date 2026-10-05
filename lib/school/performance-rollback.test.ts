import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryFixture } from "../competition/fixtures/database";

// Applies 20261008100000_school_performance, then its rollback, on the isolated in-memory database (never a hosted project).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite;
async function as(user: string | null) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec(user ? "set role authenticated" : "set role anon"); }
const school = async (action: string, inst: string) => (await db.query<{ v: any }>("select public.qb_school($1,$2::jsonb) v", [action, JSON.stringify({ institution_id: inst })])).rows[0].v;
const def = async () => (await db.query<{ d: string }>("select pg_get_functiondef('public.qb_school(text,jsonb)'::regprocedure) d")).rows[0].d;
const exists = async (sql: string) => (await db.query<{ e: boolean }>(`select exists(${sql}) e`)).rows[0].e;

describe("school performance migration rollback", () => {
  const inst = randomUUID(), curriculum = randomUUID(), cls = randomUUID();
  let original = "", migrated = "";

  beforeAll(async () => {
    ({ db } = await createDeliveryFixture());
    await db.exec("reset role; set session_replication_role=replica");
    await db.exec("create table if not exists gradebook(id uuid primary key default gen_random_uuid(),assignment_id uuid,class_id uuid,student_user_id uuid,percentage numeric,status text,graded_at timestamptz default now()); alter table assignments add column if not exists subject_name text;");
    const ghana = (await db.query<{ id: string }>("select id from markets where name='Ghana'")).rows[0].id;
    const authority = (await db.query<{ id: string }>("select id from curriculum_authorities where market_id=$1 limit 1", [ghana])).rows[0].id;
    await db.query("insert into curricula(id,code,country,market_id) values($1,'GH-RB','Ghana',$2)", [curriculum, ghana]);
    await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [curriculum, ghana, authority]);
    await db.query("insert into institutions(id,name) values($1,'Rollback School')", [inst]);
    await db.query("insert into institution_memberships(institution_id,user_id,role) values($1,$2,'admin')", [inst, id(3)]);
    await db.query("insert into classes(id,class_name,institution_id,teacher_user_id,status,curriculum_id,grade_code) values($1,'RB 7A',$2,$3,'active',$4,'B7')", [cls, inst, id(3), curriculum]);
    await db.exec("set session_replication_role=origin");
    original = await def(); // the definition shipped before the migration (20261004120000)
    await db.exec(read("../../supabase/migrations/20261008100000_school_performance.sql"));
    migrated = await def();
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("the migration really changed the function and added the helper (so the rollback has something to undo)", async () => {
    expect(migrated).not.toBe(original);
    expect(await exists("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='quizbox_ops' and p.proname='school_performance'")).toBe(true);
    await as(id(3));
    expect((await school("performance", inst)).summary).toBeDefined();
    expect((await school("overview", inst)).summary).toBeDefined();
  });

  it("the rollback restores the exact original function and removes only the helper", async () => {
    await db.exec("reset role");
    await db.exec(read("../../supabase/rollback/school_performance.sql"));
    expect(await def()).toBe(original);
    expect(await exists("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='quizbox_ops' and p.proname='school_performance'")).toBe(false);
    // Pre-existing objects the migration never touched are still there.
    expect(await exists("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='quizbox_ops' and p.proname='school_admin'")).toBe(true);
    expect(await exists("select 1 from pg_class where relname in ('institutions','institution_memberships','classes','class_memberships')  having count(*)=4")).toBe(true);
  });

  it("behaves as before the migration and keeps the original access boundary", async () => {
    await as(id(3));
    const overview = await school("overview", inst);
    expect(overview.classes).toEqual([expect.objectContaining({ name: "RB 7A", students: 0 })]);
    expect(overview.summary).toBeUndefined();
    expect(overview.classes[0].teacher_user_id).toBeUndefined();
    await expect(school("performance", inst)).rejects.toThrow("INVALID_SCHOOL_ACTION");
    await as(id(4));
    await expect(school("overview", inst)).rejects.toThrow("QB_SCHOOL_ADMIN_REQUIRED");
    await db.exec("reset role");
    const grants = (await db.query<{ a: boolean; n: boolean }>("select has_function_privilege('authenticated','public.qb_school(text,jsonb)','execute') a, has_function_privilege('anon','public.qb_school(text,jsonb)','execute') n")).rows[0];
    expect(grants).toEqual({ a: true, n: false });
  });
});
