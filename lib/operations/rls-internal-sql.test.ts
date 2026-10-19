import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261018140000_rls_internal_schemas.sql");
const ROLLBACK = read("../../supabase/rollback/rls_internal_schemas.sql");
let db: PGlite;
const rls = async (t: string) => (await db.query<{ v: boolean }>(`select relrowsecurity v from pg_class where oid = '${t}'::regclass`)).rows[0].v;

describe("row-level security on internal schemas (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated;
      create schema quizbox_private; create schema quizbox_factory; create schema quizbox_sources;
      create table quizbox_factory.jobs(id int); create table quizbox_sources.registry(id int);
      create table quizbox_sources.protected(id int); alter table quizbox_sources.protected enable row level security;   -- already on: must not be logged
      create table public.profiles(id int);                                                                         -- public tables are not this migration's business
      insert into quizbox_factory.jobs values (1);
      create function quizbox_factory.count_jobs() returns bigint language sql security definer as $$ select count(*) from quizbox_factory.jobs $$;
    `);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("switches RLS on for internal tables that had it off, logs exactly those, and leaves public tables alone", async () => {
    await db.exec(MIGRATION);
    expect(await rls("quizbox_factory.jobs")).toBe(true);
    expect(await rls("quizbox_sources.registry")).toBe(true);
    expect(await rls("public.profiles")).toBe(false);
    const logged = (await db.query<{ object: string }>("select object from quizbox_private.hardening_log where action = 'rls_enabled' order by object")).rows.map((r) => r.object);
    expect(logged).toEqual(["quizbox_factory.jobs", "quizbox_sources.registry"]);     // not "protected" (already on), not hardening_log itself
  });

  it("a browser role sees nothing even if a grant is added later, while the server function still works", async () => {
    await db.exec("grant usage on schema quizbox_factory to authenticated; grant select on quizbox_factory.jobs to authenticated");
    await db.exec("set role authenticated");
    expect((await db.query("select * from quizbox_factory.jobs")).rows).toEqual([]);
    await db.exec("reset role");
    expect(Number((await db.query<{ n: string | number }>("select quizbox_factory.count_jobs() n")).rows[0].n)).toBe(1);
  });

  it("is safe to run twice and rolls back exactly what it switched on", async () => {
    await db.exec(MIGRATION);
    expect((await db.query("select count(*)::int n from quizbox_private.hardening_log where action = 'rls_enabled'")).rows[0]).toEqual({ n: 2 });
    await db.exec(ROLLBACK);
    expect(await rls("quizbox_factory.jobs")).toBe(false);
    expect(await rls("quizbox_sources.protected")).toBe(true);                         // it was on before; still on
    expect((await db.query("select to_regclass('quizbox_private.hardening_log') t")).rows[0]).toEqual({ t: null });
  });
});
