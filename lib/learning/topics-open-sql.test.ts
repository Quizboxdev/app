import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261056100000_topics_for_teachers.sql");
const ROLLBACK = read("../../supabase/rollback/topics_for_teachers.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number | null, caps = "") => db.exec(`select set_config('request.jwt.claim.sub','${n === null ? "" : id(n)}',false), set_config('test.caps','${caps}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const statuses = async (subject: string) => Object.fromEntries((await db.query<{ title: string; status: string }>(
  "select t.title, t.status from public.curriculum_topics t join public.curriculum_nodes n on n.id = t.indicator_node_id where n.subject_code = $1 order by t.title", [subject])).rows.map((r) => [r.title, r.status]));

// Mathematics B6: Fractions (50 approved of 50: ready), Decimals (49 of 50: not ready), Shapes (50 but archived: not ready). Science B6: Plants (50: ready). Mathematics B8: Algebra (50: ready).
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth; create schema quizbox_sme;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select auth.uid() is not null and position(p in coalesce(current_setting('test.caps',true),'')) > 0 $$;
    create table public.curriculum_nodes(id uuid primary key, subject_code text, grade_code text, canonical_grade_code text);
    create table public.curriculum_topics(id uuid primary key, indicator_node_id uuid, title text, status text default 'DRAFT', target_questions integer default 50, updated_at timestamptz);
    create table public.questions(id uuid primary key default gen_random_uuid(), status text default 'active', validation_status text default 'approved');
    create table public.question_topic_links(question_id uuid primary key, topic_id uuid);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text not null, entity_type text, status text default 'pass', details jsonb default '{}', created_at timestamptz default now());
  `);
  const topics: Array<[number, string, string, string, number, string]> = [
    [1, "Fractions", "Mathematics", "B6", 50, "active"], [2, "Decimals", "Mathematics", "B6", 49, "active"], [3, "Shapes", "Mathematics", "B6", 50, "archived"],
    [4, "Plants", "Science", "B6", 50, "active"], [5, "Algebra", "Mathematics", "B8", 50, "active"],
  ];
  for (const [n, title, subject, grade, count, status] of topics) {
    await db.exec(`
      insert into public.curriculum_nodes values ('${id(100 + n)}','${subject}','${grade}','${grade}');
      insert into public.curriculum_topics(id, indicator_node_id, title) values ('${id(200 + n)}','${id(100 + n)}','${title}');
      with q as (insert into public.questions(status) select '${status}' from generate_series(1, ${count}) returning id)
      insert into public.question_topic_links select id, '${id(200 + n)}' from q;`);
  }
  await db.exec(MIGRATION);
}, 60_000);
afterAll(async () => { await db?.close(); });

describe("opening topics to teachers", () => {
  it("is for content admins and the owner only", async () => {
    await as(null);
    await expect(one("select public.qb_topics_overview() v")).rejects.toThrow("QB_TOPIC_ACCESS_DENIED");
    await as(5, "reviewer");
    await expect(one("select public.qb_topics_overview() v")).rejects.toThrow("QB_TOPIC_ACCESS_DENIED");
    await expect(one("select public.qb_topics_set_open(true) v")).rejects.toThrow("QB_TOPIC_ACCESS_DENIED");
  });

  it("shows, per subject and grade, what is open, ready and not ready", async () => {
    await as(1, "content_admin");
    const v = (await one("select public.qb_topics_overview() v")).v as any[];
    const row = (subject: string, grade: string) => v.find((r) => r.subject === subject && r.grade === grade);
    expect(row("Mathematics", "B6")).toMatchObject({ topics: 3, open: 0, ready: 1, not_ready: 2, approved_questions: 99 });   // Fractions ready; Decimals short; Shapes archived
    expect(row("Science", "B6")).toMatchObject({ ready: 1, not_ready: 0 });
    expect(row("Mathematics", "B8")).toMatchObject({ ready: 1 });
  });

  it("opens only the ready topics of the chosen subject and grade, and says how many were not ready", async () => {
    await as(1, "content_admin");
    const r = (await one("select public.qb_topics_set_open(true, 'Mathematics', 'B6') v")).v;
    expect(r).toEqual({ changed: 1, not_ready: 2, opened: true });
    expect(await statuses("Mathematics")).toEqual({ Algebra: "DRAFT", Decimals: "DRAFT", Fractions: "ACTIVE", Shapes: "DRAFT" });
    expect((await statuses("Science")).Plants).toBe("DRAFT");                       // another subject untouched
  });

  it("opens everything that is ready when no subject or grade is given, and is safe to repeat", async () => {
    await as(1, "content_admin");
    expect((await one("select public.qb_topics_set_open(true) v")).v).toMatchObject({ changed: 2, not_ready: 2 });   // Plants and Algebra
    expect((await one("select public.qb_topics_set_open(true) v")).v).toMatchObject({ changed: 0, not_ready: 2 });
    const all = Object.fromEntries((await db.query<{ title: string; status: string }>("select title, status from public.curriculum_topics")).rows.map((r) => [r.title, r.status]));
    expect(all).toEqual({ Fractions: "ACTIVE", Decimals: "DRAFT", Shapes: "DRAFT", Plants: "ACTIVE", Algebra: "ACTIVE" });
  });

  it("opens a topic only when it meets the same rule as opening it by hand (never one below its target)", async () => {
    await as(1, "content_admin");
    await db.exec("update public.curriculum_topics set target_questions = 10 where title = 'Decimals'");
    expect((await one("select public.qb_topics_set_open(true, 'Mathematics', 'B6') v")).v).toMatchObject({ changed: 1, not_ready: 1 });   // Decimals now qualifies; Shapes (archived questions) still does not
    expect((await statuses("Mathematics")).Shapes).toBe("DRAFT");
  });

  it("withdraws open topics back to draft for the chosen subject, and records each use in the audit log", async () => {
    await as(1, "content_admin");
    expect((await one("select public.qb_topics_set_open(false, 'Science', null) v")).v).toEqual({ changed: 1, not_ready: 0, opened: false });
    expect((await statuses("Science")).Plants).toBe("DRAFT");
    const log = (await db.query<{ action: string; details: any; actor_user_id: string }>("select action, details, actor_user_id from public.audit_logs order by created_at, id")).rows;
    expect(log.map((l) => l.action)).toEqual(["topics_opened", "topics_opened", "topics_opened", "topics_opened", "topics_withdrawn"]);
    expect(log[0]).toMatchObject({ actor_user_id: id(1), details: { subject: "Mathematics", grade: "B6", changed: 1, not_ready: 2 } });
  });

  it("rolls back by removing the two functions and leaves the topics as they are", async () => {
    await db.exec(ROLLBACK);
    expect((await one("select to_regprocedure('public.qb_topics_set_open(boolean,text,text)') f")).f).toBeNull();
    expect((await one("select to_regprocedure('public.qb_topics_overview()') f")).f).toBeNull();
    expect((await statuses("Mathematics")).Fractions).toBe("ACTIVE");
  });
});
