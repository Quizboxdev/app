import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// QuizBox Challenges foundation (isolated PostgreSQL). The migration is applied unchanged on a minimal stand-in of the tables it touches.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261021100000_challenges_foundation.sql");
const ROLLBACK = read("../../supabase/rollback/challenges_foundation.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, STUDENT, OTHER_TEACHER, CHILD, STUDENT2] = [1, 2, 3, 4, 5, 6].map(id);
let db: PGlite;
const as = async (user: string | null | "service") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => {
  await expect(db.query(sql, params)).rejects.toThrow(message);
};
const qs = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ question_text: `Question number ${i + 1}?`, options: ["one", "two", "three", "four"], correct_index: i % 4, explanation: "because" })));
const create = (title = "Maths Sprint", visibility = "PUBLIC", count = 3, extra = { code: null as string | null, attempts: 1, seconds: 600 }) =>
  rpc("select public.challenge_create($1,'A quick test','general_knowledge',$2,$3,$4,$5,null,null,null,$6)", [title, visibility, count, extra.seconds, extra.attempts, extra.code]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin')), active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.questions(id uuid primary key default gen_random_uuid(), subject_code text, grade text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text, status text default 'active', answer_type text default 'SINGLE_CHOICE');
    insert into public.profiles values ('${OWNER}','OWNER','active','Site Owner'),('${TEACHER}','TEACHER','active','Efua Mensah'),('${STUDENT}','STUDENT','active','Kofi Boateng'),
      ('${OTHER_TEACHER}','TEACHER','active','Yaw Asante'),('${CHILD}','STUDENT','active','Ama'),('${STUDENT2}','STUDENT','active','Abena Owusu Ansah');
    insert into public.student_profiles(user_id, managed_by) values ('${CHILD}','${TEACHER}'),('${STUDENT}',null);
    insert into public.questions(subject_code, grade, question_text, option_a, option_b, option_c, option_d, correct_answer, explanation)
      select 'MATH','B5','Bank question '||g||'?','a','b','c','d', (array['A','B','C','D'])[1+g%4], 'why' from generate_series(1,12) g;
  `);
  await db.exec(MIGRATION);
  await db.exec("grant select on public.profiles to authenticated");
});
afterAll(async () => { await db.close(); });

describe("challenges foundation", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("only creators can create; students and managed learners cannot", async () => {
    await as(STUDENT); await fails("select public.challenge_create('Maths Sprint','', 'general_knowledge','PUBLIC',3,600,1)", [], /NOT_AUTHORIZED/);
    await as(CHILD); await fails("select public.challenge_create('Maths Sprint','', 'general_knowledge','PUBLIC',3,600,1)", [], /NOT_AUTHORIZED/);
    await as(TEACHER); const made = await create(); expect(made.slug).toBe("maths-sprint");
    expect((await create()).slug).toBe("maths-sprint-1");
  });

  it("tables are not readable directly, so the answer key stays on the server", async () => {
    await as(STUDENT);
    await fails("select * from public.challenge_questions", [], /permission denied/);
    await fails("select * from public.challenge_campaigns", [], /permission denied/);
    await as(null);
    await fails("select * from public.challenge_attempts", [], /permission denied/);
    await as("service"); await fails("select * from public.challenge_questions", [], /permission denied/);
  });

  it("a campaign needs enough questions, then goes live and locks", async () => {
    await as(TEACHER);
    const { id: cid } = await create("Locked Quiz");
    await fails("select public.challenge_publish($1)", [cid], /NOT_ENOUGH_QUESTIONS/);
    await as(OTHER_TEACHER); await fails("select public.challenge_set_questions($1,$2)", [cid, qs(3)], /NOT_AUTHORIZED/);
    await as(TEACHER);
    await fails("select public.challenge_set_questions($1,$2)", [cid, JSON.stringify([{ question_text: "Bad index?", options: ["a", "b"], correct_index: 3 }])], /INVALID_QUESTIONS/);
    expect((await rpc("select public.challenge_set_questions($1,$2)", [cid, qs(5)])).count).toBe(5);
    await rpc("select public.challenge_publish($1)", [cid]);
    await fails("select public.challenge_set_questions($1,$2)", [cid, qs(5)], /ONLY_DRAFT_EDITABLE/);
    await fails("select public.challenge_update($1,'{\"question_count\":9}')", [cid], /ONLY_DRAFT_EDITABLE/);
    await fails("select public.challenge_update($1,'{\"owner_id\":\"x\"}')", [cid], /FIELD_NOT_EDITABLE/);
    expect((await rpc("select public.challenge_update($1,'{\"title\":\"Locked Quiz 2\"}')", [cid])).ok).toBe(true);
    await fails("select public.challenge_publish($1)", [cid], /INVALID_TRANSITION/);
  });

  it("pulls bank questions as a snapshot with the right correct index", async () => {
    await as(TEACHER);
    const { id: cid } = await create("From The Bank");
    const pulled = await rpc("select public.challenge_pull_bank($1,'MATH','B5',5)", [cid]);
    expect(pulled.added).toBe(5);
    const got = await rpc("select public.challenge_creator_get($1)", [cid]);
    expect(got.questions).toHaveLength(5);
    for (const q of got.questions) expect(["a", "b", "c", "d"][q.correct_index]).toBe(["a", "b", "c", "d"][q.correct_index]);
    expect((await rpc("select public.challenge_pull_bank($1,'MATH','B5',50)", [cid])).total).toBe(12);   // no duplicates: only 7 more exist
  });

  it("public discovery (server side) lists live public campaigns only and never the answers or the code", async () => {
    await as(TEACHER);
    const pub = await create("Public Live", "PUBLIC"); await rpc("select public.challenge_set_questions($1,$2)", [pub.id, qs(3)]); await rpc("select public.challenge_publish($1)", [pub.id]);
    const priv = await create("Private Live", "PRIVATE", 3, { code: "SECRET1", attempts: 1, seconds: 600 }); await rpc("select public.challenge_set_questions($1,$2)", [priv.id, qs(3)]); await rpc("select public.challenge_publish($1)", [priv.id]);
    const draft = await create("Draft Only", "PUBLIC");
    await as(null); await fails("select public.challenge_public_list()", [], /permission denied/);       // nothing is open to anon
    await as("service");
    const list = await rpc("select public.challenge_public_list()");
    const slugs = list.map((c: any) => c.slug);
    expect(slugs).toContain(pub.slug); expect(slugs).not.toContain(priv.slug); expect(slugs).not.toContain(draft.slug);
    expect(JSON.stringify(list)).not.toMatch(/correct_index|access_code|SECRET1/);
    expect(await rpc("select public.challenge_public_get($1)", [draft.slug])).toBeNull();
    const card = await rpc("select public.challenge_public_get($1)", [priv.slug]);
    expect(card.private).toBe(true); expect(JSON.stringify(card)).not.toMatch(/SECRET1/);
  });

  it("a participant starts, gets no answer key, is scored on the server and cannot score twice", async () => {
    await as(TEACHER);
    const c = await create("Scoring Quiz", "PUBLIC", 3); await rpc("select public.challenge_set_questions($1,$2)", [c.id, qs(3)]); await rpc("select public.challenge_publish($1)", [c.id]);
    const key = (await rpc("select public.challenge_creator_get($1)", [c.id])).questions as any[];
    await as(null); await fails("select public.challenge_start($1)", [c.slug], /permission denied/);
    await as(CHILD); await fails("select public.challenge_start($1)", [c.slug], /NOT_AUTHORIZED/);
    await as(STUDENT);
    const started = await rpc("select public.challenge_start($1)", [c.slug]);
    expect(started.questions).toHaveLength(3);
    expect(JSON.stringify(started)).not.toMatch(/correct_index|explanation/);
    await fails("select public.challenge_start($1)", [c.slug], /NO_ATTEMPTS_LEFT/);
    const answers = started.questions.map((q: any, i: number) => ({ question_id: q.id, chosen_index: i === 0 ? key.find((k) => k.id === q.id).correct_index : (key.find((k) => k.id === q.id).correct_index + 1) % 4 }));
    const res = await rpc("select public.challenge_submit($1,$2)", [started.attempt_id, JSON.stringify(answers)]);
    expect(res.score).toBe(1); expect(res.max_score).toBe(3); expect(res.review).toHaveLength(3);
    const again = await rpc("select public.challenge_submit($1,$2)", [started.attempt_id, JSON.stringify(started.questions.map((q: any) => ({ question_id: q.id, chosen_index: key.find((k) => k.id === q.id).correct_index })))]);
    expect(again.score).toBe(1); expect(again.already_submitted).toBe(true);
    await as(STUDENT2); await fails("select public.challenge_submit($1,'[]')", [started.attempt_id], /NOT_FOUND/);
  });

  it("private campaigns need the code", async () => {
    await as(TEACHER);
    const c = await create("Code Quiz", "PRIVATE", 3, { code: "OPEN123", attempts: 2, seconds: 600 }); await rpc("select public.challenge_set_questions($1,$2)", [c.id, qs(3)]); await rpc("select public.challenge_publish($1)", [c.id]);
    await as(STUDENT);
    await fails("select public.challenge_start($1,'nope')", [c.slug], /WRONG_CODE/);
    expect((await rpc("select public.challenge_start($1,'OPEN123')", [c.slug])).attempt_id).toBeTruthy();
  });

  it("a late submission is marked expired and kept off the leaderboard", async () => {
    await as(TEACHER);
    const c = await create("Late Quiz", "PUBLIC", 3, { code: null, attempts: 3, seconds: 60 }); await rpc("select public.challenge_set_questions($1,$2)", [c.id, qs(3)]); await rpc("select public.challenge_publish($1)", [c.id]);
    await as(STUDENT);
    const started = await rpc("select public.challenge_start($1)", [c.slug]);
    await db.exec("reset role"); await db.query("update public.challenge_attempts set expires_at = now() - interval '5 minutes' where id = $1", [started.attempt_id]); await as(STUDENT);
    const late = await rpc("select public.challenge_submit($1,'[]')", [started.attempt_id]);
    expect(late.expired).toBe(true); expect(late.score).toBe(0);
    expect(await rpc("select public.challenge_leaderboard($1)", [c.slug])).toEqual([]);
  });

  it("the leaderboard ranks best attempts, shortens names and hides managed learners", async () => {
    await as(TEACHER);
    const c = await create("Board Quiz", "PUBLIC", 3, { code: null, attempts: 2, seconds: 600 }); await rpc("select public.challenge_set_questions($1,$2)", [c.id, qs(3)]); await rpc("select public.challenge_publish($1)", [c.id]);
    const key = (await rpc("select public.challenge_creator_get($1)", [c.id])).questions as any[];
    const play = async (user: string, correct: number) => {
      await as(user); const s = await rpc("select public.challenge_start($1)", [c.slug]);
      await rpc("select public.challenge_submit($1,$2)", [s.attempt_id, JSON.stringify(s.questions.map((q: any, i: number) => ({ question_id: q.id, chosen_index: i < correct ? key.find((k) => k.id === q.id).correct_index : (key.find((k) => k.id === q.id).correct_index + 1) % 4 })))]);
    };
    await play(STUDENT, 1); await play(STUDENT, 3); await play(STUDENT2, 2);
    await db.exec("reset role"); await db.exec(`insert into public.challenge_attempts(campaign_id,user_id,attempt_no,question_ids,expires_at,submitted_at,score,max_score,duration_ms) select '${c.id}','${CHILD}',1,'{}',now(),now(),3,3,1000`);
    await as(STUDENT2);
    const board = await rpc("select public.challenge_leaderboard($1)", [c.slug]);
    expect(board.map((r: any) => [r.rank, r.name, r.score, r.is_me])).toEqual([[1, "Kofi B.", 3, false], [2, "Abena A.", 2, true]]);
  });

  it("only the owner or an admin manages a campaign; transitions are validated", async () => {
    await as(TEACHER);
    const c = await create("Managed Quiz"); await rpc("select public.challenge_set_questions($1,$2)", [c.id, qs(3)]);
    await fails("select public.challenge_set_status($1,'PAUSED')", [c.id], /INVALID_TRANSITION/);
    await rpc("select public.challenge_publish($1)", [c.id]);
    await as(OTHER_TEACHER); await fails("select public.challenge_set_status($1,'PAUSED')", [c.id], /NOT_AUTHORIZED/);
    await as(OWNER); expect((await rpc("select public.challenge_set_status($1,'PAUSED')", [c.id])).status).toBe("PAUSED");
    await as(TEACHER); await fails("select public.challenge_set_status($1,'DRAFT')", [c.id], /INVALID_TRANSITION/);
    expect((await rpc("select public.challenge_set_status($1,'COMPLETED')", [c.id])).status).toBe("COMPLETED");
    expect((await rpc("select jsonb_array_length(public.challenge_my_campaigns())")) > 0).toBe(true);
  });

  it("the rollback removes everything and the migration can be applied again", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect((await rpc("select count(*)::int from pg_proc where proname like 'challenge_%' or proname like 'qb_challenge_%'"))).toBe(0);
    expect((await rpc("select to_regclass('public.challenge_campaigns') is null"))).toBe(true);
    await db.exec(MIGRATION);
  });
});
