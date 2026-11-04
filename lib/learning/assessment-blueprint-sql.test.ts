import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const TOPICS = read("../../supabase/migrations/20261012140000_topic_assignment.sql");
const FAST = read("../../supabase/migrations/20261053100000_fast_subject_list.sql");
const BLUEPRINT = read("../../supabase/migrations/20261055100000_assessment_blueprint.sql");
const ROLLBACK = read("../../supabase/rollback/assessment_blueprint.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
const as = (n: number) => db.exec(`select set_config('request.jwt.claim.sub','${id(n)}',false)`);
const one = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0] ?? {};
const calls = async () => Number((await one("select count(*) n from public.avail_calls")).n);
const reset = () => db.exec("truncate public.avail_calls");

const TEACHER = 30, STUDENT = 31, OTHER_TEACHER = 32;
const CL_PRIMARY = id(40), CL_JHS = id(41), CL_SHS = id(42), CL_LEVEL_TEXT = id(43), CL_UNKNOWN = id(44);
// subject, grade, topics with their question counts (an even third easy, medium and hard)
const CATALOGUE: Array<{ subject: string; grade: string; topics: Array<[string, number]> }> = [
  { subject: "Mathematics", grade: "B6", topics: [["Fractions", 30], ["Decimals", 30], ["Shapes", 30]] },
  { subject: "Science", grade: "B6", topics: [["Plants", 30], ["Animals", 30]] },
  { subject: "English Language", grade: "B6", topics: [["Reading", 3], ["Grammar", 30]] },
  { subject: "Mathematics", grade: "B5", topics: [["Counting", 30]] },
  { subject: "Mathematics", grade: "B8", topics: [["Algebra", 30]] },
  { subject: "Science", grade: "B8", topics: [["Energy", 30]] },
];
const topicId: Record<string, string> = {};
const sec = (subject: string, quota: number, topics?: string[], difficulty?: string) =>
  ({ subject, quota, ...(topics ? { topic_ids: topics.map((t) => topicId[t]) } : {}), ...(difficulty ? { difficulty } : {}) });
const plan = (cls: string, sections: unknown[], difficulty: string | null = null) => one("select public.qb_blueprint_plan($1, $2::jsonb, $3) v", [cls, JSON.stringify(sections), difficulty]).then((r) => r.v);
const publish = async (cls: string, sections: unknown[], difficulty: string | null = null) => {
  await db.exec("truncate public.publish_capture");
  const v = (await one("select public.qb_publish_blueprint_assignment($1,'Term test','',$2::jsonb,$3,'ASSESSMENT',1,40,now(),null,null) v", [cls, JSON.stringify(sections), difficulty])).v;
  return { v, ids: (await one("select question_ids from public.publish_capture")).question_ids as string[] };
};
const subjectsOf = async (ids: string[]) => {
  const rows = (await db.query<{ subject_code: string; n: number }>("select subject_code, count(*)::int n from public.questions where id = any($1::uuid[]) group by 1 order by 1", [ids])).rows;
  return Object.fromEntries(rows.map((r) => [r.subject_code, r.n]));
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.classes(id uuid primary key, teacher_user_id uuid, curriculum_id uuid, tenant_id uuid, class_name text, grade text, grade_code text, education_level text);
    create table public.curriculum_nodes(id uuid primary key, curriculum_id uuid, parent_id uuid, node_type text, title text, code text, subject_code text, grade_code text, canonical_grade_code text, sort_order integer default 0, is_active boolean default true);
    create table public.curriculum_topics(id uuid primary key, curriculum_id uuid, indicator_node_id uuid, title text, sort_order integer default 0, status text default 'ACTIVE');
    create table public.topic_concepts(id uuid primary key default gen_random_uuid(), topic_id uuid, title text, sort_order integer default 0);
    create table public.questions(id uuid primary key default gen_random_uuid(), status text default 'active', validation_status text default 'approved', tenant_id uuid, source_type text,
      difficulty_label text, difficulty_code text, subject_code text, question_text text);
    create table public.question_topic_links(question_id uuid primary key, topic_id uuid, concept_id uuid);
    create table public.assignments(id uuid primary key default gen_random_uuid());
    create table public.assessments(id uuid primary key default gen_random_uuid());
    create table public.assessment_questions(assessment_id uuid, question_id uuid);
    create table public.attempts(id uuid primary key default gen_random_uuid(), assignment_id uuid, assessment_id uuid, student_user_id uuid);
    create table public.responses(id uuid primary key default gen_random_uuid(), attempt_id uuid, question_id uuid, is_correct boolean);
    create table public.avail_calls(n bigserial primary key);
    create table public.bad_questions(id uuid primary key);
    create function public.qb_question_is_available(q public.questions) returns boolean language plpgsql volatile as $$
      begin insert into public.avail_calls default values; return (q.tenant_id is null) and not exists (select 1 from public.bad_questions b where b.id = q.id); end $$;
    create function public.qb_public_tenant_id() returns uuid language sql as $$ select '${id(900)}'::uuid $$;
    create function public.qb_is_tenant_member(t uuid) returns boolean language sql as $$ select false $$;
    create function public.qb_is_platform_admin() returns boolean language sql as $$ select false $$;
    create function public.qb_can_manage_class(p_class_id uuid) returns boolean language sql stable as $$ select false $$;
    create table public.publish_capture(assignment_id uuid, selection_mode text, question_ids uuid[], node_ids uuid[], question_count int, mode text);
    create function public.qb_publish_assignment(p_class_id uuid,p_title text,p_description text,p_curriculum_node_ids uuid[],p_question_count integer,p_difficulty text,p_selection_mode text,
      p_question_ids uuid[],p_mode text,p_attempts_allowed integer,p_time_limit_minutes integer,p_start_at timestamptz,p_due_at timestamptz,p_target_student_ids uuid[],p_src uuid,p_node uuid)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare a uuid := gen_random_uuid();
    begin
      insert into public.assignments(id) values(a);
      insert into public.publish_capture values(a,p_selection_mode,p_question_ids,p_curriculum_node_ids,p_question_count,p_mode);
      return jsonb_build_object('assignment_id',a,'question_count',p_question_count,'status','PUBLISHED');
    end $$;
    insert into public.classes values
      ('${CL_PRIMARY}','${id(TEACHER)}','${id(200)}',null,'Class 6A','B6','B6',null),
      ('${CL_JHS}','${id(TEACHER)}','${id(200)}',null,'Class 8A','B8','B8',null),
      ('${CL_SHS}','${id(TEACHER)}','${id(200)}',null,'SHS 1 Science','B10','SHS1',null),
      ('${CL_LEVEL_TEXT}','${id(TEACHER)}','${id(200)}',null,'Basic 6 B','B6','', 'Primary School'),
      ('${CL_UNKNOWN}','${id(TEACHER)}','${id(200)}',null,'Odd class','X1','X1','Adult education');
  `);
  // Curriculum, topics and 30 questions per topic (a third each easy, medium, hard).
  let n = 1000;
  for (const { subject, grade, topics } of CATALOGUE) {
    for (const [title, count] of topics) {
      const node = id(n++), topic = id(n++); topicId[title] = topic;
      await db.exec(`
        insert into public.curriculum_nodes(id, curriculum_id, node_type, title, subject_code, grade_code, canonical_grade_code) values ('${node}','${id(200)}','learning_indicator','${title} indicator','${subject}','${grade}','${grade}');
        insert into public.curriculum_topics(id, curriculum_id, indicator_node_id, title) values ('${topic}','${id(200)}','${node}','${title}');
        with q as (insert into public.questions(subject_code, question_text, difficulty_label)
          select '${subject}', '${title} ' || g, case when g % 3 = 1 then 'easy' when g % 3 = 2 then 'medium' else 'hard' end from generate_series(1, ${count}) g returning id)
        insert into public.question_topic_links(question_id, topic_id) select id, '${topic}' from q;`);
    }
  }
  await db.exec(TOPICS);
  await db.exec(FAST.slice(FAST.indexOf("create or replace function public.qb_question_is_listable"), FAST.indexOf("revoke all on function public.qb_question_is_listable")));
}, 120_000);
afterAll(async () => { await db?.close(); });

describe("teacher topic list (before and after the blueprint migration)", () => {
  let before: unknown;
  it("is unchanged by the migration and no longer runs the full check on every question", async () => {
    await as(TEACHER);
    before = (await one("select public.qb_teacher_topics($1, null) v", [CL_PRIMARY])).v;
    expect((before as any[]).length).toBe(10);
    await db.exec(BLUEPRINT);
    await as(TEACHER); await reset();
    expect((await one("select public.qb_teacher_topics($1, null) v", [CL_PRIMARY])).v).toEqual(before);
    expect(await calls()).toBe(0);
  });
});

describe("blueprint plan", () => {
  it("plans one subject like the existing topic plan: the quota is spread evenly over the named topics", async () => {
    await as(TEACHER);
    const p = await plan(CL_PRIMARY, [sec("Mathematics", 10, ["Fractions", "Decimals", "Shapes"])]);
    expect(p.total).toBe(10);
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0].topics.map((t: any) => t.share).sort()).toEqual([3, 3, 4]);
    expect(p).not.toHaveProperty("question_ids");
    expect(p).not.toHaveProperty("shares");
  });

  it("builds a combined quiz from two subjects with their own quotas, no repeats, checking only a few candidates", async () => {
    await as(TEACHER); await reset();
    const { v, ids } = await publish(CL_PRIMARY, [sec("Mathematics", 10, ["Fractions", "Decimals"]), sec("Science", 6, ["Plants"])]);
    expect(v.question_count).toBe(16);
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
    expect(await subjectsOf(ids)).toEqual({ Mathematics: 10, Science: 6 });
    expect(await calls()).toBeLessThan(60);                                   // 150 questions are in these topics; only the candidates were checked
    expect(v.sections.map((s: any) => [s.subject, s.quota])).toEqual([["Mathematics", 10], ["Science", 6]]);
  });

  it("lets a section on 'any topic' choose its own topics and stay inside the quiz's grade", async () => {
    await as(TEACHER);
    const { ids } = await publish(CL_PRIMARY, [sec("Mathematics", 12), sec("Science", 4)]);
    expect(await subjectsOf(ids)).toEqual({ Mathematics: 12, Science: 4 });
    const grades = (await db.query<{ g: string }>("select distinct n.canonical_grade_code g from public.question_topic_links l join public.curriculum_topics t on t.id = l.topic_id join public.curriculum_nodes n on n.id = t.indicator_node_id where l.question_id = any($1::uuid[])", [ids])).rows;
    expect(grades).toEqual([{ g: "B6" }]);                                    // never the B5 Counting topic
  });

  it("hands a thin topic's share to the others on 'any topic', but blocks when a NAMED topic is short", async () => {
    await as(TEACHER);
    const p = await plan(CL_PRIMARY, [sec("English Language", 8)]);
    const shares = Object.fromEntries(p.sections[0].topics.map((t: any) => [t.title, t.share]));
    expect(shares.Reading + shares.Grammar).toBe(8);
    expect(shares.Reading).toBeLessThanOrEqual(3);
  });

  it("blocks a named topic that cannot supply its share", async () => {
    await as(TEACHER);
    await expect(plan(CL_PRIMARY, [sec("English Language", 8, ["Reading", "Grammar"])])).rejects.toThrow(/QB_TOPIC_SHORT: Reading has 3 available, 4 needed/);
    await expect(plan(CL_PRIMARY, [sec("English Language", 40)])).rejects.toThrow(/QB_TOPIC_SHORT/);
  });

  it("never hands out a question the full check refuses", async () => {
    await as(TEACHER);
    await db.exec(`insert into public.bad_questions select l.question_id from public.question_topic_links l where l.topic_id = '${topicId.Fractions}' and exists (select 1 from public.questions q where q.id = l.question_id and q.difficulty_label = 'easy' and q.question_text in ('Fractions 1','Fractions 4','Fractions 7','Fractions 10'))`);
    const { ids } = await publish(CL_PRIMARY, [sec("Mathematics", 9, ["Fractions"])]);
    expect(ids).toHaveLength(9);
    expect((await one("select count(*)::int n from public.bad_questions where id = any($1::uuid[])", [ids])).n).toBe(0);
    await db.exec("truncate public.bad_questions");
  });

  it("applies one difficulty to the whole quiz or to one section", async () => {
    await as(TEACHER);
    const { ids } = await publish(CL_PRIMARY, [sec("Mathematics", 6, ["Fractions"], "hard"), sec("Science", 6, ["Plants"])], "easy");
    const rows = (await db.query<{ subject_code: string; d: string; n: number }>("select subject_code, difficulty_label d, count(*)::int n from public.questions where id = any($1::uuid[]) group by 1, 2", [ids])).rows;
    expect(rows.filter((r) => r.subject_code === "Mathematics").every((r) => r.d === "hard")).toBe(true);   // the section's own level wins
    expect(rows.filter((r) => r.subject_code === "Science").every((r) => r.d === "easy")).toBe(true);
  });
});

describe("who may combine subjects, and the other rules", () => {
  const two = () => [sec("Mathematics", 4, ["Algebra"]), sec("Science", 4, ["Energy"])];
  it("allows a combined quiz for a Primary class, a JHS class and a class known only by its education level", async () => {
    await as(TEACHER);
    expect((await plan(CL_PRIMARY, [sec("Mathematics", 4, ["Fractions"]), sec("Science", 4, ["Plants"])])).total).toBe(8);
    expect((await plan(CL_JHS, two())).total).toBe(8);
    expect((await plan(CL_LEVEL_TEXT, [sec("Mathematics", 4, ["Fractions"]), sec("Science", 4, ["Plants"])])).total).toBe(8);
  });
  it("refuses a combined quiz for a Senior High class and for a class whose level is unknown, but allows one subject", async () => {
    await as(TEACHER);
    await expect(plan(CL_SHS, two())).rejects.toThrow("QB_COMBINED_LEVEL_NOT_ALLOWED");
    await expect(plan(CL_UNKNOWN, two())).rejects.toThrow("QB_COMBINED_LEVEL_NOT_ALLOWED");
    expect((await plan(CL_SHS, [sec("Mathematics", 6, ["Algebra"])])).total).toBe(6);
  });
  it("refuses a bad blueprint with a clear code", async () => {
    await as(TEACHER);
    await expect(plan(CL_PRIMARY, [])).rejects.toThrow("QB_BLUEPRINT_SECTIONS_INVALID");
    await expect(plan(CL_PRIMARY, [sec("Mathematics", 4), sec("Mathematics", 4)])).rejects.toThrow("QB_BLUEPRINT_DUPLICATE_SUBJECT");
    await expect(plan(CL_PRIMARY, [sec("Mathematics", 60), sec("Science", 41)])).rejects.toThrow("QB_TOPIC_TOTAL_INVALID");
    await expect(plan(CL_PRIMARY, [sec("Mathematics", 0)])).rejects.toThrow("QB_BLUEPRINT_INVALID");
    await expect(plan(CL_PRIMARY, [sec("Mathematics", 2, ["Fractions", "Decimals", "Shapes"])])).rejects.toThrow("QB_BLUEPRINT_QUOTA_TOO_SMALL");
    await expect(plan(CL_PRIMARY, [sec("Mathematics", 4, ["Plants"])])).rejects.toThrow("QB_TOPIC_UNAVAILABLE");          // a Science topic under Mathematics
    await expect(plan(CL_PRIMARY, [sec("Mathematics", 4, ["Fractions"]), sec("Science", 4, ["Energy"])])).rejects.toThrow("QB_BLUEPRINT_ONE_GRADE");   // B6 with B8
    await expect(plan(CL_PRIMARY, [sec("History", 4)])).rejects.toThrow("QB_TOPIC_UNAVAILABLE");
    await expect(plan(CL_PRIMARY, [sec("Mathematics", 4, ["Fractions"])], "impossible")).rejects.toThrow("QB_TOPIC_DIFFICULTY_INVALID");
  });
  it("is only for the class's own teacher", async () => {
    await as(OTHER_TEACHER);
    await expect(plan(CL_PRIMARY, [sec("Mathematics", 4, ["Fractions"])])).rejects.toThrow("CLASS_ACCESS_DENIED");
  });
});

describe("publishing and the learner's breakdown", () => {
  let assignment: string, ids: string[], assessment: string, attempt: string;
  it("records the sections and topic shares of the assignment", async () => {
    await as(TEACHER);
    const r = await publish(CL_PRIMARY, [sec("Mathematics", 8, ["Fractions", "Decimals"]), sec("Science", 4, ["Plants"])]);
    assignment = r.v.assignment_id; ids = r.ids;
    expect((await db.query("select position, subject, quota from public.assignment_sections where assignment_id = $1 order by position", [assignment])).rows).toEqual([
      { position: 1, subject: "Mathematics", quota: 8 }, { position: 2, subject: "Science", quota: 4 }]);
    expect((await db.query<{ n: number }>("select sum(question_share)::int n from public.assignment_topics where assignment_id = $1", [assignment])).rows[0].n).toBe(12);
  });

  it("shows a learner their score per subject and topic, weakest first, and the topics to work on", async () => {
    assessment = (await one("insert into public.assessments default values returning id")).id;
    for (const q of ids) await db.query("insert into public.assessment_questions values ($1,$2)", [assessment, q]);
    attempt = (await one("insert into public.attempts(assignment_id, assessment_id, student_user_id) values ($1,$2,$3) returning id", [assignment, assessment, id(STUDENT)])).id;
    // Mathematics: answer every question right except the Decimals ones; Science: all right but one
    const rows = (await db.query<{ id: string; subject_code: string; title: string }>(
      `select q.id, q.subject_code, t.title from public.questions q join public.question_topic_links l on l.question_id = q.id join public.curriculum_topics t on t.id = l.topic_id where q.id = any($1::uuid[])`, [ids])).rows;
    let skipScience = 1;
    for (const r of rows) {
      const correct = r.subject_code === "Mathematics" ? r.title !== "Decimals" : skipScience-- <= 0;
      await db.query("insert into public.responses(attempt_id, question_id, is_correct) values ($1,$2,$3)", [attempt, r.id, correct]);
    }
    await as(STUDENT);
    const b = (await one("select public.qb_attempt_breakdown($1) v", [attempt])).v;
    const maths = b.subjects.find((s: any) => s.subject === "Mathematics"), science = b.subjects.find((s: any) => s.subject === "Science");
    expect(maths).toMatchObject({ total: 8, correct: 4, percent: 50, position: 1 });
    expect(science).toMatchObject({ total: 4, correct: 3, percent: 75, position: 2 });
    expect(b.subjects.map((s: any) => s.subject)).toEqual(["Mathematics", "Science"]);       // weakest subject first
    expect(maths.topics.map((t: any) => [t.title, t.percent])).toEqual([["Decimals", 0], ["Fractions", 100]]);
    expect(b.weakest[0]).toMatchObject({ subject: "Mathematics", title: "Decimals", correct: 0, total: 4 });
    expect(b.weakest.every((w: any) => w.correct < w.total)).toBe(true);
  });

  it("keeps a learner's breakdown to that learner", async () => {
    await as(OTHER_TEACHER);
    await expect(one("select public.qb_attempt_breakdown($1) v", [attempt])).rejects.toThrow("ATTEMPT_NOT_FOUND");
  });
});

describe("rollback", () => {
  it("puts the teacher topic list back as it was and removes the blueprint functions", async () => {
    await db.exec(ROLLBACK);
    expect((await one("select to_regprocedure('public.qb_blueprint_plan(uuid,jsonb,text)') f")).f).toBeNull();
    expect((await one("select to_regprocedure('quizbox_topic.listable_questions(uuid,uuid,boolean)') f")).f).toBeNull();
    await as(TEACHER); await reset();
    expect(((await one("select public.qb_teacher_topics($1, null) v", [CL_PRIMARY])).v as any[]).length).toBe(10);
    expect(await calls()).toBeGreaterThan(100);                              // the old, full check on every question
  });
});
