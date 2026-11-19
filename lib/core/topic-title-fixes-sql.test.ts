import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Four mis-typed topic names are corrected (20261119110000) and nothing else changes, on an isolated PostgreSQL.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261119110000_topic_title_fixes.sql");
const ROLLBACK = read("../../supabase/rollback/topic_title_fixes.sql");
const CONV = "Conversation - Talking about Oneself, Family, People, Customs";
let db: PGlite;
const title = async (id: number) => (await db.query<{ title: string }>("select title from public.curriculum_nodes where id = $1", [id])).rows[0].title;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.curriculum_nodes(id int primary key, node_type text, subject_code text, grade_code text, title text, identity_key text, parent_id int);
    insert into public.curriculum_nodes values
      (1,'sub_strand','English Language','B4','${CONV},','k1',null), (2,'sub_strand','English Language','B5','${CONV},','k2',null), (3,'sub_strand','English Language','B6','${CONV},','k3',null),
      (4,'sub_strand','English Language','B5','Using action Words','k4',null), (5,'sub_strand','English Language','B4','Using Action Words','k5',null),
      (6,'sub_strand','Creative Arts','B5','Planning, Making And Composing','k6',null), (7,'sub_strand','Creative Arts','B4','Planning, Making and Composing','k7',null),
      (8,'sub_strand','Ghanaian Language','B5','Integrating Grammar in Written Language (Use of action words)','k8',null),
      (9,'learning_indicator','English Language','B5','Using action Words','k9',null), (10,'sub_strand','Mathematics','B5','Numbers,','k10',null);
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("topic title fixes", () => {
  it("removes the trailing comma in all three grades", async () => { for (const id of [1, 2, 3]) expect(await title(id)).toBe(CONV); });
  it("capitalises Action in the B5 English topic and And in the B5 Creative Arts topic", async () => {
    expect(await title(4)).toBe("Using Action Words"); expect(await title(6)).toBe("Planning, Making and Composing");
  });
  it("leaves everything else alone: other grades, other subjects, indicators, other titles with commas, identity keys", async () => {
    expect(await title(5)).toBe("Using Action Words"); expect(await title(7)).toBe("Planning, Making and Composing");
    expect(await title(8)).toBe("Integrating Grammar in Written Language (Use of action words)");
    expect(await title(9)).toBe("Using action Words"); expect(await title(10)).toBe("Numbers,");
    expect((await db.query<{ n: number }>("select count(*)::int n from public.curriculum_nodes where identity_key = 'k' || id")).rows[0].n).toBe(10);
  });
  it("running it again changes nothing", async () => { await db.exec(MIGRATION); expect(await title(4)).toBe("Using Action Words"); expect(await title(2)).toBe(CONV); });
  it("rollback puts the old titles back", async () => {
    await db.exec(ROLLBACK);
    expect(await title(2)).toBe(`${CONV},`); expect(await title(4)).toBe("Using action Words"); expect(await title(9)).toBe("Using action Words");
  });
});
