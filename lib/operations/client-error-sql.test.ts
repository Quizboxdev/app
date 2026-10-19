import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261019100000_client_error_monitoring.sql");
const INTAKE = read("../../supabase/migrations/20261018150000_public_interest_intake.sql");
const ROLLBACK = read("../../supabase/rollback/client_error_monitoring.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${n ? id(n) : ""}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const report = (kind: string, route: string, digest: string, message: string) => db.query("select public.qb_record_client_error($1,$2,$3,$4)", [kind, route, digest, message]);

describe("client error monitoring (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role; create schema auth; create schema quizbox_private; create schema quizbox_market; create schema quizbox_sme;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select position(p in coalesce(current_setting('test.caps',true),'')) > 0 $$;
      create function quizbox_market.is_super() returns boolean language sql stable as $$ select quizbox_sme.has_capability('super_admin') $$;
      create table public.profiles(id uuid primary key);
      create table public.system_events(id uuid primary key default gen_random_uuid(), event_type text, entity_type text, severity text, details jsonb, created_at timestamptz default now());
    `);
    await db.exec(INTAKE);       // provides quizbox_private.consume_intake_budget, which the error log shares for its global cap
    await db.exec(MIGRATION);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("stores a path-only, scrubbed report and counts repeats instead of duplicating them", async () => {
    await report("RENDER", "/student/results/00000000-0000-4000-8000-000000000123?token=abc#x", "d1g3st", "Cannot read x of mail me@example.com id 1234567");
    await report("RENDER", "/student/results/00000000-0000-4000-8000-000000000999", "d1g3st", "again");
    const rows = (await db.query<{ details: any }>("select details from public.system_events where event_type = 'CLIENT_ERROR'")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].details).toMatchObject({ kind: "RENDER", route: "/student/results/:id", digest: "d1g3st", count: 2 });
    expect(rows[0].details.message).toBe("Cannot read x of mail [email] id [n]");
  });

  it("rejects unknown kinds and is callable by the server role only", async () => {
    await expect(report("HACK", "/", "x", "y")).rejects.toThrow("QB_INVALID_EVENT");
    for (const role of ["anon", "authenticated"]) { await db.exec(`set role ${role}`); await expect(report("RENDER", "/", "x", "y")).rejects.toThrow(); await db.exec("reset role"); }
    await db.exec("set role service_role"); await report("NETWORK", "/practise", "n3t", "Failed to fetch"); await db.exec("reset role");
  });

  it("shows staff a grouped summary and nobody else", async () => {
    await as(3);
    await expect(one("select public.qb_admin_client_errors(24) v")).rejects.toThrow("SUPPORT_ACCESS_REQUIRED");
    await as(2, "sme_support");
    const v = (await one("select public.qb_admin_client_errors(24) v")).v;
    expect(v).toMatchObject({ total: 3, last_hour: 3, hours: 24 });
    expect(v.groups[0]).toMatchObject({ route: "/student/results/:id", count: 2, kind: "RENDER" });
    expect(v.groups).toHaveLength(2);
  });

  it("caps the table with a global hourly limit and rolls back cleanly", async () => {
    await db.exec("insert into quizbox_private.intake_budgets(budget_key, window_start, used) values ('clienterr:global:h', to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 600) on conflict (budget_key, window_start) do update set used = 600");
    await report("RENDER", "/over-the-cap", "cap", "x");
    expect((await one("select count(*)::int n from public.system_events where details->>'route' = '/over-the-cap'")).n).toBe(0);
    await db.exec(ROLLBACK);
    expect((await db.query("select to_regprocedure('public.qb_record_client_error(text,text,text,text)') f")).rows[0]).toEqual({ f: null });
  });
});
