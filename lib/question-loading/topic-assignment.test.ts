import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactoryFixture, fixtureId as id } from "../content/factory/fixture";

// Teacher assignment by topic (20261012140000): even spread across topics, difficulty and concept coverage, no repeats, a short topic blocks.
// qb_publish_assignment is replaced by a recorder so the wrapper's hand-over (MANUAL mode, exact ids, indicator nodes) can be checked.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite, market: string, curriculum: string, source: string, ind: string[];
const TEACHER = id(30), OTHER = id(31), ADMIN = id(13), CLASS = id(40);
const topicIds: Record<string, string> = {};
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
const call = async (sql: string, args: unknown[] = []) => (await db.query<{ v: any }>(sql, args)).rows[0].v;
const plan = (topics: string[], total: number, difficulty: string | null = null) =>
  call("select public.qb_topic_assignment_plan($1,$2::uuid[],$3,$4) v", [CLASS, topics.map((t) => topicIds[t]), total, difficulty]);
const publish = (topics: string[], total: number, over: { difficulty?: string | null; targets?: string[] | null } = {}) =>
  call("select public.qb_publish_topic_assignment($1,'Energy check','',$2::uuid[],$3,$4,'PRACTICE',2,20,now(),null,$5::uuid[]) v",
    [CLASS, topics.map((t) => topicIds[t]), total, over.difficulty ?? null, over.targets ?? null]);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let serial = 0;
const q = (topic_key: string, node: string, concept: string, difficulty: string) => ({
  topic_key, concept, indicator_node_id: node, subject: "Computing", grade: "B7",
  question_text: `Which part of a computer is described in situation number ${++serial} that a learner meets at school?`,
  answer_type: "SINGLE_CHOICE", option_a: `Memory unit ${serial}`, option_b: `Display unit ${serial}`, option_c: `Input device ${serial}`, option_d: `Power supply ${serial}`,
  correct_answer: "C", explanation: `The input device sends information into the computer; the other parts store, show or power it (${serial}).`,
  difficulty, cognitive_level: "Understand", source_reference: "NaCCA Computing B7 p.12" });
const block = (key: string, node: string, concepts: string[], easy: number, medium: number, hard: number) => [
  ...Array.from({ length: easy }, (_, i) => q(key, node, concepts[i % concepts.length], "easy")),
  ...Array.from({ length: medium }, (_, i) => q(key, node, concepts[i % concepts.length], "medium")),
  ...Array.from({ length: hard }, (_, i) => q(key, node, concepts[i % concepts.length], "hard")),
];

beforeAll(async () => {
  const f = await createFactoryFixture();
  ({ db, market, curriculum, source, ind } = f);
  await db.exec("reset role");
  await db.exec(read("../../supabase/migrations/20261012100000_topic_registry.sql"));
  await db.exec(read("../../supabase/migrations/20261012120000_question_load.sql"));
  // Stand-ins for the publisher and class tables this migration calls; the real ones are covered by their own migrations.
  await db.exec(`
    alter table classes add column if not exists teacher_user_id uuid, add column if not exists curriculum_id uuid, add column if not exists tenant_id uuid, add column if not exists class_name text;
    create or replace function qb_can_manage_class(p_class_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select false $$;
    create table publish_capture(assignment_id uuid, class_id uuid, selection_mode text, question_ids uuid[], node_ids uuid[], question_count int, mode text, targets uuid[]);
    create function qb_publish_assignment(p_class_id uuid,p_title text,p_description text,p_curriculum_node_ids uuid[],p_question_count integer,p_difficulty text,p_selection_mode text,
      p_question_ids uuid[],p_mode text,p_attempts_allowed integer,p_time_limit_minutes integer,p_start_at timestamptz,p_due_at timestamptz,p_target_student_ids uuid[],p_src uuid,p_node uuid)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare a uuid:=gen_random_uuid();
    begin
      insert into public.assignments(id) values(a);
      insert into public.publish_capture values(a,p_class_id,p_selection_mode,p_question_ids,p_curriculum_node_ids,p_question_count,p_mode,p_target_student_ids);
      return jsonb_build_object('assignment_id',a,'question_count',p_question_count,'status','PUBLISHED');
    end $$;`);
  await db.exec(read("../../supabase/migrations/20261012140000_topic_assignment.sql"));
  await db.query("insert into classes(id,teacher_user_id,curriculum_id,class_name) values($1,$2,$3,'Class 7A')", [CLASS, TEACHER, curriculum]);
  // A real teacher belongs to the market; availability is market-aware, exactly as the publisher sees it.
  await db.query("insert into profiles(id,role,status,country,default_market_id,full_name) values($1,'TEACHER','active','Ghana',$2,'Teacher One')", [TEACHER, market]);
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'teacher@example.invalid',now())", [TEACHER]);
  await db.query("insert into user_market_memberships(user_id,market_id,active) values($1,$2,true)", [TEACHER, market]);
  await as(ADMIN);
  const rows = [
    ...block("t-hw", ind[0], ["input devices", "output devices", "storage"], 6, 8, 6),
    ...block("t-sw", ind[1], ["system software", "application software", "utilities"], 6, 8, 6),
    ...block("t-ni", ind[2], ["networks"], 2, 1, 1),
  ];
  const r = await call("select public.qb_question_load($1::jsonb) v", [JSON.stringify({
    scope: "CURRICULUM", market_id: market, curriculum_id: curriculum, source_document_ids: [source], file_name: "t3.csv", file_sha256: sha("t3"), rows,
    topics: [
      { key: "t-hw", indicator_node_id: ind[0], title: "Parts of a computer", concepts: ["input devices", "output devices", "storage"] },
      { key: "t-sw", indicator_node_id: ind[1], title: "Types of software", concepts: ["system software", "application software", "utilities"] },
      { key: "t-ni", indicator_node_id: ind[2], title: "Computer networks", concepts: ["networks"] },
    ] })]);
  expect(r).toMatchObject({ status: "LOADED", rows_loaded: 44 });
  // Approve and activate every loaded question and open the topics to teachers (the review and activation rules have their own tests).
  await db.exec("reset role");
  await db.exec("alter table public.questions disable trigger user");
  await db.exec("update public.questions set validation_status='approved', status='active' where id in (select question_id from public.question_topic_links)");
  await db.exec("alter table public.questions enable trigger user");
  await db.exec("update public.curriculum_topics set status='ACTIVE', target_questions=1");
  for (const t of (await db.query<{ id: string; title: string }>("select id, title from public.curriculum_topics")).rows) {
    topicIds[{ "Parts of a computer": "hw", "Types of software": "sw", "Computer networks": "ni" }[t.title]!] = t.id;
  }
}, 300_000);
afterAll(async () => { await db?.close(); });

describe("teacher topic list", () => {
  it("shows the class's active topics with where they sit in the curriculum and what is available", async () => {
    await as(TEACHER);
    const list = await call("select public.qb_teacher_topics($1,'Computing') v", [CLASS]);
    expect(list).toHaveLength(3);
    const hw = list.find((t: any) => t.title === "Parts of a computer");
    expect(hw).toMatchObject({ subject: "Computing", grade: "B7", strand: "Introduction to computing", available: 20, easy: 6, medium: 8, hard: 6, concepts: ["input devices", "output devices", "storage"] });
    expect(await call("select public.qb_teacher_topics($1,'Science') v", [CLASS])).toEqual([]);
  });
});

describe("even spread", () => {
  it("splits a total equally across topics and draws each share across the difficulty levels", async () => {
    await as(TEACHER);
    const p = await plan(["hw", "sw"], 30);
    expect(p.shares).toHaveLength(2);
    for (const s of p.shares) expect(s).toMatchObject({ share: 15, easy: 5, medium: 5, hard: 5 });
    expect(p).not.toHaveProperty("question_ids");
  });

  it("shares the remainder, one extra each, with the topics that have the most questions first", async () => {
    await as(TEACHER);
    const p = await plan(["hw", "sw", "ni"], 7);
    // 7 over 3 topics: base 2, one extra. hw and sw have 20 each (hw sorts first), ni has 4.
    const by = Object.fromEntries(p.shares.map((s: any) => [s.title, s.share]));
    expect(by).toEqual({ "Parts of a computer": 3, "Types of software": 2, "Computer networks": 2 });
    expect(p.shares.reduce((n: number, s: any) => n + s.share, 0)).toBe(7);
  });

  it("blocks and names the topic that cannot supply its share, without choosing anything", async () => {
    await as(TEACHER);
    await expect(plan(["hw", "sw", "ni"], 30)).rejects.toThrow(/QB_TOPIC_SHORT: Computer networks has 4 available, 10 needed/);
    await expect(publish(["hw", "sw", "ni"], 30)).rejects.toThrow(/QB_TOPIC_SHORT/);
    await db.exec("reset role");
    expect((await db.query<{ n: string }>("select count(*)::text n from publish_capture")).rows[0].n).toBe("0");
  });

  it("can restrict to one difficulty and says when that level is too thin", async () => {
    await as(TEACHER);
    const ok = await plan(["hw", "sw"], 10, "medium");
    for (const s of ok.shares) expect(s).toMatchObject({ share: 5, easy: 0, medium: 5, hard: 0 });
    await expect(plan(["hw"], 8, "hard")).rejects.toThrow(/QB_TOPIC_SHORT: Parts of a computer has 6 available at hard level, 8 needed/);
  });

  it("fills a thin level from the neighbouring levels instead of failing", async () => {
    await as(TEACHER);
    // ni has 2 easy, 1 medium, 1 hard: 4 questions in a share of 4 uses all of them.
    const p = await plan(["ni"], 4);
    expect(p.shares[0]).toMatchObject({ share: 4, easy: 2, medium: 1, hard: 1 });
  });
});

describe("publishing a topic assignment", () => {
  it("hands the publisher exactly the chosen questions, with no repeats, every concept covered and indicator nodes of the topics", async () => {
    await as(TEACHER);
    const out = await publish(["hw", "sw"], 30, { targets: [id(50), id(51)] });
    expect(out).toMatchObject({ status: "PUBLISHED" });
    expect(out.topics).toHaveLength(2);
    await db.exec("reset role");
    const cap = (await db.query<{ selection_mode: string; question_ids: string[]; node_ids: string[]; question_count: number; mode: string; targets: string[] }>("select * from publish_capture")).rows[0];
    expect(cap).toMatchObject({ selection_mode: "MANUAL", question_count: 30, mode: "PRACTICE", targets: [id(50), id(51)] });
    expect(new Set(cap.question_ids).size).toBe(30);
    expect([...cap.node_ids].sort()).toEqual([ind[0], ind[1]].sort());
    const perTopic = (await db.query<{ title: string; n: string; concepts: string }>(
      `select t.title, count(*)::text n, count(distinct l.concept_id)::text concepts from question_topic_links l join curriculum_topics t on t.id = l.topic_id
       where l.question_id = any($1::uuid[]) group by t.title order by t.title`, [cap.question_ids])).rows;
    expect(perTopic).toEqual([{ title: "Parts of a computer", n: "15", concepts: "3" }, { title: "Types of software", n: "15", concepts: "3" }]);
    const covered = (await db.query<{ topic: string; share: number }>(
      "select t.title topic, a.question_share share from assignment_topics a join curriculum_topics t on t.id = a.topic_id order by t.title")).rows;
    expect(covered).toEqual([{ topic: "Parts of a computer", share: 15 }, { topic: "Types of software", share: 15 }]);
  });

  it("draws different questions on a second assignment only by chance, never outside the topic or the approved set", async () => {
    await as(TEACHER);
    await publish(["hw"], 12);
    await db.exec("reset role");
    const last = (await db.query<{ question_ids: string[] }>("select question_ids from publish_capture order by ctid desc limit 1")).rows[0].question_ids;
    const outside = (await db.query<{ n: string }>(
      `select count(*)::text n from unnest($1::uuid[]) u(id) left join question_topic_links l on l.question_id = u.id left join questions q on q.id = u.id
       where l.topic_id is distinct from $2::uuid or q.validation_status <> 'approved' or q.status::text <> 'active'`, [last, topicIds.hw])).rows[0].n;
    expect(outside).toBe("0");
  });
});

describe("concept coverage", () => {
  it("takes one question per concept before a second of any, so a small share still probes every concept", async () => {
    await as(TEACHER);
    // Parts of a computer has 8 medium questions over 3 concepts (3, 3, 2). Random picking of 3 misses a concept about two times in three.
    for (let i = 0; i < 8; i++) {
      await publish(["hw"], 3, { difficulty: "medium" });
      await db.exec("reset role");
      const ids = (await db.query<{ question_ids: string[] }>("select question_ids from publish_capture order by ctid desc limit 1")).rows[0].question_ids;
      const distinct = (await db.query<{ n: string }>("select count(distinct concept_id)::text n from question_topic_links where question_id = any($1::uuid[])", [ids])).rows[0].n;
      expect(distinct).toBe("3");
      await as(TEACHER);
    }
  });
});

describe("who and what is allowed", () => {
  it("refuses a teacher who does not own the class, signed-out visitors, closed topics and bad totals", async () => {
    await as(OTHER);
    await expect(plan(["hw"], 5)).rejects.toThrow(/CLASS_ACCESS_DENIED/);
    await expect(call("select public.qb_teacher_topics($1,null) v", [CLASS])).rejects.toThrow(/CLASS_ACCESS_DENIED/);
    await as(null);
    await expect(plan(["hw"], 5)).rejects.toThrow(/permission denied/);
    await as(TEACHER);
    await expect(plan(["hw", "sw"], 1)).rejects.toThrow(/QB_TOPIC_TOTAL_INVALID/);
    await expect(plan(["hw"], 101)).rejects.toThrow(/QB_TOPIC_TOTAL_INVALID/);
    await expect(plan([], 5)).rejects.toThrow(/QB_TOPIC_COUNT_INVALID/);
    await expect(plan(["hw"], 5, "extreme")).rejects.toThrow(/QB_TOPIC_DIFFICULTY_INVALID/);
    await db.exec("reset role");
    await db.query("update curriculum_topics set status='DRAFT' where id=$1", [topicIds.ni]);
    await as(TEACHER);
    await expect(plan(["hw", "ni"], 6)).rejects.toThrow(/QB_TOPIC_UNAVAILABLE/);
    await expect(call("select public.qb_teacher_topics($1,null) v", [CLASS])).resolves.toHaveLength(2);
  });
});
