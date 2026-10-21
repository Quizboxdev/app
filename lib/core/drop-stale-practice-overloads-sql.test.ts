import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The duplicate practice functions that broke the builder in production (PGRST203) are removed, and the grade-aware ones stay.
const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261033100000_drop_stale_practice_overloads.sql", import.meta.url), "utf8");
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create function public.qb_practice_menu() returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.qb_practice_menu(p_grade text default null) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.qb_start_quick_practice(p_topic_ids uuid[], p_count integer) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.qb_start_quick_practice(p_topic_ids uuid[], p_count integer default 10, p_grade text default null) returns jsonb language sql as $$ select '{}'::jsonb $$;
  `);
});
afterAll(async () => { await db.close(); });

const shapes = async () => (await db.query<{ p: string; a: string }>("select proname p, pg_get_function_identity_arguments(oid) a from pg_proc where pronamespace='public'::regnamespace and proname in ('qb_practice_menu','qb_start_quick_practice') order by 1,2")).rows.map((r) => `${r.p}(${r.a})`);

describe("stale practice overloads", () => {
  it("starts ambiguous, ends with one version of each, and can run twice", async () => {
    expect(await shapes()).toHaveLength(4);
    await db.exec(MIGRATION); await db.exec(MIGRATION);
    expect(await shapes()).toEqual(["qb_practice_menu(p_grade text)", "qb_start_quick_practice(p_topic_ids uuid[], p_count integer, p_grade text)"]);
  });
  it("a call with no grade now resolves to the single remaining function", async () => {
    expect((await db.query<any>("select public.qb_practice_menu() r")).rows[0].r).toEqual({});
    expect((await db.query<any>("select public.qb_start_quick_practice(array[]::uuid[], 5) r")).rows[0].r).toEqual({});
  });
});
