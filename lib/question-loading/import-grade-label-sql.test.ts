import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261124100000_import_shs_grade_label.sql");
const ROLLBACK = read("../../supabase/rollback/import_shs_grade_label.sql");
let db: PGlite;

// A stand-in for the import: the same grade line as the real function, against the real enum values.
const STUB = `
  create schema quizbox_private;
  create type public.qb_grade as enum ('B7','B8','B9','B4','B5','B6','B10','SHS1','SHS2','SHS3');
  create table public.node (source_grade_code text, grade_code text);
  create function quizbox_private.core_qb_content_ingest(p_spec jsonb, p_candidates jsonb, p_source_file text default 'candidate.json', p_provider text default 'human', p_model text default null)
  returns public.qb_grade language plpgsql as $f$
  declare n public.node; g public.qb_grade;
  begin
    select * into n from public.node limit 1;
    g := coalesce(n.source_grade_code,n.grade_code)::public.qb_grade;
    return g;
  end $f$;`;
const ingest = async () => (await db.query<{ g: string | null }>("select quizbox_private.core_qb_content_ingest('{}','[]') g")).rows[0].g;

describe("the import and a node grade printed as 'SHS 1'", () => {
  beforeAll(async () => { db = new PGlite(); await db.exec(STUB); });

  it("fails before the fix with the enum error seen when loading SHS files", async () => {
    await db.exec("truncate public.node; insert into public.node values ('SHS 1','SHS1')");
    await expect(ingest()).rejects.toThrow(/invalid input value for enum.*SHS 1/);
  });
  it("leaves the legacy grade empty after the fix, and still fills it for B7", async () => {
    await db.exec(MIGRATION);
    await db.exec("truncate public.node; insert into public.node values ('SHS 1','SHS1')");
    expect(await ingest()).toBeNull();
    await db.exec("truncate public.node; insert into public.node values ('B7','B7')");
    expect(await ingest()).toBe("B7");
    await db.exec("truncate public.node; insert into public.node values ('SHS1','SHS1')");
    expect(await ingest()).toBe("SHS1");
  });
  it("is safe to run twice, and the rollback restores the old behaviour", async () => {
    await db.exec(MIGRATION);
    await db.exec(ROLLBACK);
    await db.exec("truncate public.node; insert into public.node values ('SHS 1','SHS1')");
    await expect(ingest()).rejects.toThrow(/SHS 1/);
    await db.exec(ROLLBACK);   // second rollback is a no-op
  });
});
