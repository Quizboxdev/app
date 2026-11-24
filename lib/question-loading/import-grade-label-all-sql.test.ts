import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261124110000_grade_label_every_function.sql");
const ROLLBACK = read("../../supabase/rollback/grade_label_every_function.sql");
let db: PGlite;

// Three stand-ins with the same grade line as the real import, editorial guard and sponsor delivery; one already guarded, one that does not touch grades.
const STUB = `
  create schema quizbox_private; create schema quizbox_competition;
  create type public.qb_grade as enum ('B7','B8','B9','B4','B5','B6','B10','SHS1','SHS2','SHS3');
  create table public.node (source_grade_code text, grade_code text);
  create function quizbox_private.imp() returns public.qb_grade language plpgsql as $f$
    declare n public.node; begin select * into n from public.node limit 1; return coalesce(n.source_grade_code,n.grade_code)::public.qb_grade; end $f$;
  create function public.guard() returns public.qb_grade language plpgsql as $f$
    declare n public.node; begin select * into n from public.node limit 1; return coalesce(n.source_grade_code,n.grade_code)::public.qb_grade; end $f$;
  create function quizbox_competition.sponsor() returns public.qb_grade language plpgsql as $f$
    declare n public.node; begin select * into n from public.node limit 1; return coalesce(n.source_grade_code,n.grade_code)::public.qb_grade; end $f$;
  create function public.unrelated() returns integer language sql as $f$ select 1 $f$;`;
const run = async (fn: string) => (await db.query<{ g: string | null }>(`select ${fn}() g`)).rows[0].g;
const node = (s: string, g: string) => db.exec(`truncate public.node; insert into public.node values ('${s}','${g}')`);

describe("every function that casts a node grade into the legacy enum", () => {
  beforeAll(async () => { db = new PGlite(); await db.exec(STUB); });

  it("all fail on 'SHS 3' before the fix", async () => {
    await node("SHS 3", "SHS3");
    for (const fn of ["quizbox_private.imp", "public.guard", "quizbox_competition.sponsor"]) await expect(run(fn)).rejects.toThrow(/SHS 3/);
  });
  it("all leave the legacy grade empty for 'SHS 3' after the fix, and keep B7 and SHS3", async () => {
    await db.exec(MIGRATION);
    for (const fn of ["quizbox_private.imp", "public.guard", "quizbox_competition.sponsor"]) {
      await node("SHS 3", "SHS3"); expect(await run(fn)).toBeNull();
      await node("B7", "B7"); expect(await run(fn)).toBe("B7");
      await node("SHS3", "SHS3"); expect(await run(fn)).toBe("SHS3");
    }
    expect((await db.query<{ n: number }>("select public.unrelated() n")).rows[0].n).toBe(1);
  });
  it("running it again changes nothing, and the rollback restores the old behaviour", async () => {
    await db.exec(MIGRATION);
    await node("SHS 3", "SHS3"); expect(await run("public.guard")).toBeNull();
    await db.exec(ROLLBACK);
    for (const fn of ["quizbox_private.imp", "public.guard", "quizbox_competition.sponsor"]) await expect(run(fn)).rejects.toThrow(/SHS 3/);
  });
});
