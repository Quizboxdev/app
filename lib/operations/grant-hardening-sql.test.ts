import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261018120000_grant_hardening_table_maintenance.sql");
const ROLLBACK = read("../../supabase/rollback/grant_hardening_table_maintenance.sql");
let db: PGlite;
const priv = async (role: string, table: string, p: string) => (await db.query<{ v: boolean }>(`select has_table_privilege('${role}', '${table}', '${p}') v`)).rows[0].v;

describe("grant hardening: table maintenance rights (isolated PostgreSQL)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create schema quizbox_sme;
      create table public.questions(id int); create table quizbox_sme.pool(id int); create table public.other_app(id int);
      grant all on all tables in schema public to anon, authenticated; grant all on all tables in schema quizbox_sme to anon, authenticated;
    `);
  }, 60_000);
  afterAll(async () => { await db.close(); });

  it("removes TRUNCATE, REFERENCES and TRIGGER from both client roles and keeps read and write", async () => {
    expect(await priv("authenticated", "public.questions", "TRUNCATE")).toBe(true);
    await db.exec(MIGRATION);
    for (const role of ["anon", "authenticated"]) for (const t of ["public.questions", "quizbox_sme.pool"]) {
      for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER"]) expect(await priv(role, t, p)).toBe(false);
      for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(await priv(role, t, p)).toBe(true);
    }
  });

  it("tables created later do not get the rights back", async () => {
    await db.exec("create table public.later(id int); grant select on public.later to authenticated;");
    expect(await priv("authenticated", "public.later", "TRUNCATE")).toBe(false);
  });

  it("rolls back to the defaults", async () => {
    await db.exec(ROLLBACK);
    expect(await priv("authenticated", "public.questions", "TRUNCATE")).toBe(true);
  });
});
