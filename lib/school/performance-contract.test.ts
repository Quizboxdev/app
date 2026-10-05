import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryFixture } from "../competition/fixtures/database";

// Runs qb_school('performance') against the isolated test database only (never hosted Supabase).
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
async function as(user: string | null) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec(user ? "set role authenticated" : "set role anon"); }
const school = async (action: string, inst: string) => (await db.query<{ v: any }>("select public.qb_school($1,$2::jsonb) v", [action, JSON.stringify({ institution_id: inst })])).rows[0].v;

describe("qb_school('performance') contract", () => {
  const inst = randomUUID(), other = randomUUID(), curriculum = randomUUID(), node = randomUUID(), thin = randomUUID();
  const [clsA, clsB, clsC, clsD, clsX] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [asgA, asgB] = [randomUUID(), randomUUID()];
  const s = [1, 2, 3, 4, 5].map((n) => id(100 + n));
  const member = new Map<string, string>();

  beforeAll(async () => {
    ({ db } = await createDeliveryFixture());
    await db.exec("reset role; set session_replication_role=replica");
    await db.exec("create table if not exists gradebook(id uuid primary key default gen_random_uuid(),assignment_id uuid,class_id uuid,student_user_id uuid,percentage numeric,status text,graded_at timestamptz default now()); alter table assignments add column if not exists subject_name text;");
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261008100000_school_performance.sql", import.meta.url), "utf8"));
    const ghana = (await db.query<{ id: string }>("select id from markets where name='Ghana'")).rows[0].id;
    const authority = (await db.query<{ id: string }>("select id from curriculum_authorities where market_id=$1 limit 1", [ghana])).rows[0].id;
    await db.query("insert into curricula(id,code,country,market_id) values($1,'GH-SCH','Ghana',$2)", [curriculum, ghana]);
    await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [curriculum, ghana, authority]);
    await db.query("insert into institutions(id,name) values($1,'Fixture School'),($2,'Other School')", [inst, other]);
    await db.query("insert into institution_memberships(institution_id,user_id,role) values($1,$2,'admin')", [inst, id(3)]);
    const cls = (c: string, name: string, grade: string, i: string, teacher: string | null) => db.query("insert into classes(id,class_name,institution_id,teacher_user_id,status,curriculum_id,grade_code) values($1,$2,$3,$4,'active',$5,$6)", [c, name, i, teacher, curriculum, grade]);
    await cls(clsA, "7A", "B7", inst, id(3)); await cls(clsB, "8A", "B8", inst, id(3)); await cls(clsC, "8B", "B8", inst, id(3)); await cls(clsD, "7B", "B7", inst, null); await cls(clsX, "9X", "B9", other, id(3));
    const enrol = async (c: string, u: string) => { const m = randomUUID(); member.set(`${c}|${u}`, m); await db.query("insert into class_memberships(id,class_id,student_user_id,student_name,status) values($1,$2,$3,$4,'active')", [m, c, u, `Learner ${u.slice(-3)}`]); };
    await enrol(clsA, s[0]); await enrol(clsA, s[1]); await enrol(clsA, s[2]); await enrol(clsB, s[3]); await enrol(clsX, s[4]);
    await db.query("insert into assignments(id,class_id,status,due_at,subject_name) values($1,$2,'PUBLISHED',now()-interval '1 day','Mathematics'),($3,$4,'published',now()+interval '3 days','Science')", [asgA, clsA, asgB, clsB]);
    for (const u of s.slice(0, 3)) await db.query("insert into assignment_targets(assignment_id,student_user_id,membership_id,status) values($1,$2,$3,'ACTIVE')", [asgA, u, member.get(`${clsA}|${u}`)]);
    const grade = (a: string, c: string, u: string, p: number, status: string, daysAgo: number) => db.query("insert into gradebook(assignment_id,class_id,student_user_id,percentage,status,graded_at) values($1,$2,$3,$4,$5,now()-($6||' days')::interval)", [a, c, u, p, status, daysAgo]);
    await grade(asgA, clsA, s[0], 80, "final", 10); await grade(asgA, clsA, s[0], 60, "final", 2); await grade(asgA, clsA, s[1], 40, "final", 3);
    await grade(asgB, clsB, s[3], 90, "final", 1); await grade(asgB, clsB, s[3], 10, "draft", 0); await grade(asgA, clsX, s[4], 100, "final", 1);
    await db.query("insert into curriculum_nodes(id,curriculum_id,code,title) values($1,$2,'B7.1.1','Fractions'),($3,$2,'B7.9.9','Thin evidence')", [node, curriculum, thin]);
    const event = (n: string, u: string, c: string, ok: boolean) => db.query("insert into learning_events(student_user_id,class_id,attempt_id,response_id,question_id,curriculum_node_id,mode,is_correct) values($1,$2,$3,$4,$5,$6,'ASSESSMENT',$7)", [u, c, randomUUID(), randomUUID(), randomUUID(), n, ok]);
    for (const ok of [true, true, true, true, false, false]) await event(node, s[0], clsA, ok);
    for (let i = 0; i < 3; i++) await event(thin, s[0], clsA, false); // below the 5-response floor: omitted
    await db.exec("set session_replication_role=origin");
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("aggregates per learner, never averaging averages, and separates assessed from enrolled", async () => {
    await as(id(3));
    const p = await school("performance", inst);
    expect(p.summary).toMatchObject({ learner_count: 4, assessed_learner_count: 3, average_score: 63.3, assignment_completion_rate: 66.7, due_target_count: 3, active_assignment_count: 1 });
    const byClass = Object.fromEntries(p.by_class.map((c: any) => [c.class_name, c]));
    expect(byClass["7A"]).toMatchObject({ learner_count: 3, assessed_count: 2, average_score: 50, completion_rate: 66.7 });
    expect(byClass["8A"]).toMatchObject({ learner_count: 1, assessed_count: 1, average_score: 90, completion_rate: 100 });
    expect(byClass["8B"]).toMatchObject({ learner_count: 0, assessed_count: 0, average_score: null, completion_rate: null });
    expect(byClass["7B"]).toMatchObject({ learner_count: 0, average_score: null });
    expect(p.by_grade).toEqual([expect.objectContaining({ grade: "B7", learner_count: 3, assessed_count: 2, average_score: 50 }), expect.objectContaining({ grade: "B8", learner_count: 1, assessed_count: 1, average_score: 90 })]);
    expect(p.by_subject).toEqual([{ subject: "Mathematics", assessed_count: 2, average_score: 50 }, { subject: "Science", assessed_count: 1, average_score: 90 }]);
  });

  it("flags thin indicator evidence and omits samples under 5 responses", async () => {
    const p = await school("performance", inst);
    expect(p.weak_indicators).toEqual([expect.objectContaining({ code: "B7.1.1", assessed_count: 1, response_count: 6, average_score: 66.7, low_evidence: true })]);
  });

  it("keeps other institutions out and rejects non-admins", async () => {
    const p = await school("performance", inst);
    expect(JSON.stringify(p)).not.toContain("9X");
    expect(p.summary.learner_count).toBe(4);
    await as(id(4));
    await expect(school("performance", inst)).rejects.toThrow("QB_SCHOOL_ADMIN_REQUIRED");
    await as(id(3));
    await expect(school("performance", other)).rejects.toThrow("QB_SCHOOL_ADMIN_REQUIRED");
  });

  it("does not let clients call the helper directly or read protected tables", async () => {
    await as(id(3));
    await expect(db.query("select quizbox_ops.school_performance($1)", [inst])).rejects.toThrow();
    await expect(db.query("select * from gradebook")).rejects.toThrow("permission denied"); // school admins gain no table access
  });

  it("returns stable teacher ids and server-side counts in the overview, and a real history cap", async () => {
    const o = await school("overview", inst);
    expect(o.classes.find((c: any) => c.name === "7A").teacher_user_id).toBe(id(3));
    expect(o.classes.find((c: any) => c.name === "7B").teacher_user_id).toBeNull();
    expect(o.summary).toMatchObject({ unique_learners: 4, joined_last_30d: 4 });
    expect((await school("history", inst)).length).toBe(4);
  });
});
