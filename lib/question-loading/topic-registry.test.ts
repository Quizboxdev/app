import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The topic-registry migration is applied to an isolated PostgreSQL with minimal stand-ins for the tables it references.
const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261012100000_topic_registry.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../../supabase/rollback/topic_registry.sql", import.meta.url), "utf8");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1), TEACHER = id(2), CURRICULUM = id(10), NODE_A = id(21), NODE_B = id(22), STRAND = id(23);

const STUBS = `
  create role anon; create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create schema quizbox_sme;
  create function quizbox_sme.has_capability(p text) returns boolean language sql stable as $$ select auth.uid() = '${ADMIN}'::uuid $$;
  create table public.profiles (id uuid primary key);
  create table public.curricula (id uuid primary key);
  create table public.curriculum_nodes (id uuid primary key, curriculum_id uuid not null, node_type text not null, code text not null, is_active boolean not null default true);
  create table public.questions (id uuid primary key default gen_random_uuid(), status text not null default 'active', validation_status text, difficulty_label text);
  grant usage on schema auth, quizbox_sme to authenticated;
  grant execute on all functions in schema auth, quizbox_sme to authenticated;
  grant usage on schema public to authenticated, anon;
`;

let db: PGlite;
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
const call = async (sql: string, args: unknown[] = []) => (await db.query<{ v: any }>(`select ${sql} v`, args)).rows[0].v;
async function seedQuestions(topic: string, concept: string | null, n: number, over: { status?: string; validation?: string; difficulty?: string } = {}) {
  await db.exec("reset role");
  for (let i = 0; i < n; i++) {
    const q = await db.query<{ id: string }>("insert into public.questions(status, validation_status, difficulty_label) values ($1,$2,$3) returning id",
      [over.status ?? "active", over.validation ?? "approved", over.difficulty ?? ["easy", "medium", "hard"][i % 3]]);
    await db.query("insert into public.question_topic_links(question_id, topic_id, concept_id) values ($1,$2,$3)", [q.rows[0].id, topic, concept]);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUBS);
  await db.exec(`insert into public.profiles values ('${ADMIN}'), ('${TEACHER}');
    insert into public.curricula values ('${CURRICULUM}');
    insert into public.curriculum_nodes values ('${NODE_A}','${CURRICULUM}','learning_indicator','B7.1.1.1.1'), ('${NODE_B}','${CURRICULUM}','learning_indicator','B7.1.1.2.1'), ('${STRAND}','${CURRICULUM}','strand','S1');`);
  await db.exec(MIGRATION);
  await db.exec("grant select on public.questions, public.curriculum_nodes to authenticated");
}, 120_000);
afterAll(async () => { await db.close(); });

describe("topic registry migration", () => {
  it("lets a content admin create a topic with concepts, normalising names and updating in place", async () => {
    await as(ADMIN);
    const r = await call("public.qb_topic_save($1::jsonb)", [JSON.stringify({ indicator_node_id: NODE_A, title: "Sanitation Challenges in the Community", concepts: ["Environment types", "Poor sanitation effects", "Sanitation solutions"] })]);
    expect(r).toMatchObject({ status: "DRAFT", concepts: 3 });
    const again = await call("public.qb_topic_save($1::jsonb)", [JSON.stringify({ indicator_node_id: NODE_A, title: "  sanitation challenges IN the community ", concepts: ["Environment types", "Sanitation solutions", "Cultural practices"], target_questions: 30 })]);
    expect(again.topic_id).toBe(r.topic_id);
    const topics = (await db.query<{ n: string; target: number }>("select count(*)::text n, max(target_questions) target from public.curriculum_topics")).rows[0];
    expect(topics).toEqual({ n: "1", target: 30 });
    const concepts = (await db.query<{ title: string }>("select title from public.topic_concepts order by sort_order")).rows.map((x) => x.title);
    expect(concepts).toEqual(["Environment types", "Sanitation solutions", "Cultural practices"]);
  });

  it("rejects non-indicator nodes, bad titles and bad concept lists", async () => {
    await as(ADMIN);
    const bad = (p: object) => call("public.qb_topic_save($1::jsonb)", [JSON.stringify(p)]);
    await expect(bad({ indicator_node_id: STRAND, title: "A strand topic", concepts: ["one"] })).rejects.toThrow("QB_TOPIC_INVALID_INDICATOR");
    await expect(bad({ indicator_node_id: NODE_A, title: "ab", concepts: ["one"] })).rejects.toThrow("QB_TOPIC_INVALID_TITLE");
    await expect(bad({ indicator_node_id: NODE_A, title: "Fine title", concepts: [] })).rejects.toThrow("QB_TOPIC_INVALID_CONCEPTS");
    await expect(bad({ indicator_node_id: NODE_A, title: "Fine title", concepts: Array.from({ length: 13 }, (_, i) => `Concept ${i}`) })).rejects.toThrow("QB_TOPIC_INVALID_CONCEPTS");
  });

  it("denies everyone who is not a content admin, including anonymous callers", async () => {
    const p = JSON.stringify({ indicator_node_id: NODE_A, title: "Not allowed here", concepts: ["one"] });
    await as(TEACHER);
    await expect(call("public.qb_topic_save($1::jsonb)", [p])).rejects.toThrow("QB_TOPIC_ACCESS_DENIED");
    await expect(call("public.qb_topic_readiness($1)", [CURRICULUM])).rejects.toThrow("QB_TOPIC_ACCESS_DENIED");
    await as(null);
    await expect(call("public.qb_topic_save($1::jsonb)", [p])).rejects.toThrow();
    await expect(db.query("select * from public.curriculum_topics")).rejects.toThrow();
  });

  it("keeps a concept that questions point at when it is dropped from the list", async () => {
    await as(ADMIN);
    const t = await call("public.qb_topic_save($1::jsonb)", [JSON.stringify({ indicator_node_id: NODE_B, title: "Sources and uses of energy", concepts: ["Energy sources", "Energy utilisation"] })]);
    const concept = (await db.query<{ id: string }>("select id from public.topic_concepts where topic_id = $1 and title = 'Energy utilisation'", [t.topic_id])).rows[0].id;
    await seedQuestions(t.topic_id, concept, 1);
    await as(ADMIN);
    await call("public.qb_topic_save($1::jsonb)", [JSON.stringify({ indicator_node_id: NODE_B, title: "Sources and uses of energy", concepts: ["Energy sources"] })]);
    const left = (await db.query<{ title: string }>("select title from public.topic_concepts where topic_id = $1 order by sort_order", [t.topic_id])).rows.map((x) => x.title);
    expect(left).toEqual(["Energy utilisation", "Energy sources"].sort((a, b) => left.indexOf(a) - left.indexOf(b)));
    expect(left).toContain("Energy utilisation");
  });

  it("offers a topic to teachers only once it has enough approved, active questions", async () => {
    await as(ADMIN);
    const t = await call("public.qb_topic_save($1::jsonb)", [JSON.stringify({ indicator_node_id: NODE_A, title: "Mapping and locating places", concepts: ["Map scale", "Map types"], target_questions: 6 })]);
    await seedQuestions(t.topic_id, null, 4);
    await seedQuestions(t.topic_id, null, 3, { validation: "review" });
    await seedQuestions(t.topic_id, null, 2, { status: "inactive" });
    await as(ADMIN);
    await expect(call("public.qb_topic_set_status($1,'ACTIVE')", [t.topic_id])).rejects.toThrow("QB_TOPIC_NOT_READY:4/6");
    await seedQuestions(t.topic_id, null, 2);
    await as(ADMIN);
    expect(await call("public.qb_topic_set_status($1,'ACTIVE')", [t.topic_id])).toMatchObject({ status: "ACTIVE" });
    await expect(call("public.qb_topic_set_status($1,'LIVE')", [t.topic_id])).rejects.toThrow("QB_TOPIC_INVALID_STATUS");
    await as(TEACHER);
    const visible = (await db.query<{ title: string }>("select title from public.curriculum_topics")).rows.map((x) => x.title);
    expect(visible).toEqual(["Mapping and locating places"]);
    const concepts = (await db.query("select * from public.topic_concepts")).rows;
    expect(concepts).toHaveLength(2);
  });

  it("reports readiness per topic with difficulty and concept counts", async () => {
    await as(ADMIN);
    const rows = await call("public.qb_topic_readiness($1)", [CURRICULUM]);
    const mapping = rows.find((r: any) => r.title === "Mapping and locating places");
    expect(mapping).toMatchObject({ status: "ACTIVE", target: 6, approved: 6, ready: true, indicator_code: "B7.1.1.1.1" });
    expect(mapping.easy + mapping.medium + mapping.hard).toBe(6);
    expect(rows.find((r: any) => r.title.toLowerCase().startsWith("sanitation challenges"))).toMatchObject({ approved: 0, ready: false, target: 30 });
  });

  it("makes the same file impossible to record twice, and the tables read-only to ordinary users", async () => {
    await db.exec("reset role");
    const sha = "a".repeat(64);
    await db.query("insert into public.question_load_batches(file_name, file_sha256, scope, uploaded_by) values ('b.csv', $1, 'CURRICULUM', $2)", [sha, ADMIN]);
    await expect(db.query("insert into public.question_load_batches(file_name, file_sha256, scope, uploaded_by) values ('c.csv', $1, 'CURRICULUM', $2)", [sha, ADMIN])).rejects.toThrow();
    await as(TEACHER);
    await expect(db.query("insert into public.curriculum_topics(curriculum_id, indicator_node_id, title, title_key) values ($1,$2,'Sneaky topic','sneaky topic')", [CURRICULUM, NODE_A])).rejects.toThrow();
    expect((await db.query("select * from public.question_load_batches")).rows).toHaveLength(0);
    await as(ADMIN);
    expect((await db.query("select * from public.question_load_batches")).rows).toHaveLength(1);
  });

  it("rolls back cleanly", async () => {
    await db.exec("reset role");
    await db.exec(ROLLBACK);
    const left = await db.query("select to_regclass('public.curriculum_topics') t, to_regclass('public.question_load_batches') b");
    expect(left.rows[0]).toEqual({ t: null, b: null });
    await db.exec(MIGRATION);
  });
});
