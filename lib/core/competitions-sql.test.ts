import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Competitions, sharing and the free allowance (isolated PostgreSQL; the Challenges migrations and this one applied in order, unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const FOUNDATION = read("../../supabase/migrations/20261021100000_challenges_foundation.sql");
const EXTENSIONS = read("../../supabase/migrations/20261022100000_challenges_extensions.sql");
const MODERATION = read("../../supabase/migrations/20261023100000_challenges_moderation.sql");
const MIGRATION = read("../../supabase/migrations/20261027100000_competitions_and_sharing.sql");
const ROLLBACK = read("../../supabase/rollback/competitions_and_sharing.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, SCHOOL_ADMIN, LEARNER, CLASSMATE, OUTSIDER, CHILD, SPONSOR] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
const CLASS = id(100), OTHER_CLASS = id(101), INST = id(200);
let db: PGlite;
const as = async (user: string | null | "service") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const qs = (stage: number, n = 3) => Array.from({ length: n }, (_, i) => ({ question_text: `Round ${stage} question ${i + 1}?`, options: ["one", "two", "three", "four"], correct_index: 0, stage_no: stage }));
const round = (title: string, extra: Record<string, unknown> = {}) => ({ title, question_count: 3, time_limit_seconds: 300, pass_percent: 0, ...extra });
// Answers every question; the first `right` correct.
const play = async (slug: string, stage: number, right: number) => {
  const a = await rpc("select public.challenge_start($1,null,$2)", [slug, stage]);
  const answers = a.questions.map((q: any, i: number) => ({ question_id: q.id, chosen_index: i < right ? 0 : 1 }));
  return rpc("select public.challenge_submit($1,$2)", [a.attempt_id, JSON.stringify(answers)]);
};
const soon = () => new Date(Date.now() + 3_600_000).toISOString();
const competition = async (owner: string, rounds: unknown[], visibility = "PUBLIC") => {
  await as(owner);
  const c = await rpc("select public.challenge_create('Spelling Cup','x','general_knowledge',$1,3,300,1,null,null,null,$2,'COMPETITION')", [visibility, visibility === "PRIVATE" ? "CODE12" : null]);
  await rpc("select public.challenge_set_stages($1,$2)", [c.id, JSON.stringify(rounds)]);
  await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(rounds.flatMap((_, i) => qs(i + 1)))]);
  return c;
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin')), active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.questions(id uuid primary key default gen_random_uuid(), subject_code text, grade text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text, status text default 'active', answer_type text default 'SINGLE_CHOICE');
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text not null, type text not null, title text not null, message text not null,
      entity_type text, entity_id uuid, created_at timestamptz not null default now(), read_at timestamptz, market_id uuid, link text check (link is null or link ~ '^/[A-Za-z0-9/_\\-?=&.]*$'), category text not null default 'system' check (category in ('reward','system','payment')));
    create table public.institutions(id uuid primary key, name text);
    create table public.institution_memberships(institution_id uuid, user_id uuid, role text, status text);
    create table public.classes(id uuid primary key, class_name text, status text default 'active', teacher_user_id uuid, institution_id uuid);
    create table public.class_memberships(class_id uuid, student_user_id uuid, status text default 'active');
    create table public.assessments(id uuid primary key default gen_random_uuid(), owner_user_id uuid, reference_type text);
    create table public.qb_access_settings(key text primary key, value jsonb not null);
    create table public.learner_subscriptions(user_id uuid, status text default 'active', valid_from timestamptz default now(), valid_until timestamptz);
    create function public.qb_access_free_limit() returns integer language sql stable as $$ select case when jsonb_typeof(value)='number' then (value #>> '{}')::integer end from public.qb_access_settings where key='free_practice_sessions' $$;
    create function public.qb_has_subscription(p_user uuid) returns boolean language sql stable as $$ select exists(select 1 from public.learner_subscriptions s where s.user_id=p_user and s.status='active' and s.valid_until>now()) $$;
    insert into public.profiles values ('${OWNER}','OWNER','active','Site Owner','o@example.com'),('${TEACHER}','TEACHER','active','Efua Mensah','t@example.com'),('${SCHOOL_ADMIN}','TEACHER','active','Head Teacher','h@example.com'),
      ('${LEARNER}','STUDENT','active','Kofi Boateng','k@example.com'),('${CLASSMATE}','STUDENT','active','Ama Owusu','a@example.com'),('${OUTSIDER}','STUDENT','active','Yaw Mensah','y@example.com'),
      ('${CHILD}','STUDENT','active','Little One',null),('${SPONSOR}','SPONSOR','active','Bank Sponsor','s@example.com');
    insert into public.student_profiles(user_id, managed_by) values ('${LEARNER}',null),('${CLASSMATE}',null),('${OUTSIDER}',null),('${CHILD}','${TEACHER}');
    insert into public.institutions values ('${INST}','Accra Academy');
    insert into public.institution_memberships values ('${INST}','${SCHOOL_ADMIN}','admin','active'),('${INST}','${TEACHER}','teacher','active');
    insert into public.classes values ('${CLASS}','JHS 2A','active','${TEACHER}','${INST}'),('${OTHER_CLASS}','JHS 3B','active','${OWNER}',null);
    insert into public.class_memberships values ('${CLASS}','${CLASSMATE}','active'),('${CLASS}','${LEARNER}','active');
  `);
  await db.exec(FOUNDATION); await db.exec(EXTENSIONS); await db.exec(MODERATION); await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("competitions and sharing", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("learners can create and share, with a lower daily limit; managed learners cannot", async () => {
    await as(LEARNER);
    for (let i = 0; i < 5; i++) expect((await rpc("select public.challenge_create($1,'x','general_knowledge','UNLISTED',3,300,1)", [`Learner Quiz ${i}`])).format).toBe("CHALLENGE");
    await fails("select public.challenge_create('One Too Many','x','general_knowledge','UNLISTED',3,300,1)", [], /RATE_LIMITED/);
    await as(CHILD); await fails("select public.challenge_create('Child Quiz','x','general_knowledge','UNLISTED',3,300,1)", [], /NOT_AUTHORIZED/);
    await as(CLASSMATE);
    expect((await rpc("select public.challenge_create('Mine','x','general_knowledge','PUBLIC',3,300,1,null,null,null,null,'COMPETITION')")).format).toBe("COMPETITION");
    await fails("select public.challenge_create('Bad','x','general_knowledge','PUBLIC',3,300,1,null,null,null,null,'LEAGUE')", [], /INVALID_FORMAT/);
  });

  it("a Challenge has one round; a Competition has up to six, and 'top N through' needs a closing time and a later round", async () => {
    await as(TEACHER);
    const ch = await rpc("select public.challenge_create('Speed Test','x','general_knowledge','PUBLIC',3,300,1)");
    await fails("select public.challenge_set_stages($1,$2)", [ch.id, JSON.stringify([round("A"), round("B")])], /CHALLENGE_SINGLE_ROUND/);
    const co = await rpc("select public.challenge_create('Cup','x','general_knowledge','PUBLIC',3,300,1,null,null,null,null,'COMPETITION')");
    await fails("select public.challenge_set_stages($1,$2)", [co.id, JSON.stringify([round("A", { advance_top_n: 2 }), round("B")])], /INVALID_STAGES/);               // no closing time
    await fails("select public.challenge_set_stages($1,$2)", [co.id, JSON.stringify([round("A"), round("B", { advance_top_n: 2, ends_at: soon() })])], /INVALID_STAGES/);   // last round cannot pass anyone on
    expect((await rpc("select public.challenge_set_stages($1,$2)", [co.id, JSON.stringify([round("A", { advance_top_n: 2, ends_at: soon() }), round("B"), round("Final")])])).stages).toBe(3);
  });

  it("passes the top N through only after the round closes; others are told they are not through", async () => {
    const c = await competition(TEACHER, [round("Qualifier", { advance_top_n: 1, ends_at: soon() }), round("Final")]);
    await rpc("select public.challenge_publish($1)", [c.id]);
    await as(LEARNER); await play(c.slug, 1, 3);
    await as(CLASSMATE); await play(c.slug, 1, 2);
    await as(OUTSIDER);                                                                                              // never played round 1
    await as(LEARNER);
    await fails("select public.challenge_start($1,null,2)", [c.slug], /ROUND_STILL_RUNNING/);
    expect((await rpc("select public.challenge_my_progress($1)", [c.slug])).map((s: any) => s.state)).toEqual(["USED", "WAITING"]);
    await db.exec("reset role"); await db.query("update public.challenge_stages set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 hours' where campaign_id = $1 and stage_no = 1", [c.id]);
    await as(LEARNER); expect((await rpc("select public.challenge_start($1,null,2)", [c.slug])).stage_no).toBe(2);
    await as(CLASSMATE); await fails("select public.challenge_start($1,null,2)", [c.slug], /NOT_THROUGH/);
    expect((await rpc("select public.challenge_my_progress($1)", [c.slug])).map((s: any) => s.state)).toEqual(["CLOSED", "NOT_THROUGH"]);
    await as(OUTSIDER); await fails("select public.challenge_start($1,null,2)", [c.slug], /STAGE_LOCKED/);
  });

  it("aims a campaign at a class or a school: only the teacher or administrator can, members can join, others cannot, and members are told", async () => {
    await as(CLASSMATE);
    const mine = await rpc("select public.challenge_create('Mine','x','general_knowledge','PUBLIC',3,300,1)");
    await fails("select public.challenge_set_audience($1,$2,null)", [mine.id, CLASS], /NOT_AUTHORIZED/);
    await as(TEACHER);
    const c = await rpc("select public.challenge_create('Class Quiz','x','general_knowledge','PUBLIC',3,300,1)");
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(qs(1))]);
    await fails("select public.challenge_set_audience($1,$2,null)", [c.id, OTHER_CLASS], /NOT_AUTHORIZED/);
    await fails("select public.challenge_set_audience($1,$2,$3)", [c.id, CLASS, INST], /INVALID_AUDIENCE/);
    expect(await rpc("select public.challenge_my_audiences()")).toMatchObject({ classes: [{ id: CLASS, name: "JHS 2A" }], institutions: [] });
    await rpc("select public.challenge_set_audience($1,$2,null)", [c.id, CLASS]);
    await rpc("select public.challenge_publish($1)", [c.id]);
    expect((await rpc("select public.challenge_public_get($1)", [c.slug])).audience).toBe("CLASS");
    expect((await rpc("select public.challenge_public_get($1)", [c.slug])).visibility).toBe("UNLISTED");                // never listed publicly
    expect((await rpc("select jsonb_array_length(public.challenge_public_list(60,0,null))")) as number).toBeGreaterThanOrEqual(0);
    expect((await rpc("select public.challenge_public_list(60,0,null)")).some((x: any) => x.slug === c.slug)).toBe(false);
    await as(CLASSMATE); expect((await rpc("select public.challenge_start($1)", [c.slug])).questions).toHaveLength(3);
    await as(OUTSIDER); await fails("select public.challenge_start($1)", [c.slug], /NOT_IN_AUDIENCE/);
    expect(await rpc("select public.challenge_leaderboard($1)", [c.slug])).toEqual([]);
    await db.exec("reset role");
    const told = (await db.query<any>("select recipient_user_id, link from public.notifications where title = 'A new challenge for you' order by recipient_user_id")).rows;
    expect(told.map((r) => r.recipient_user_id).sort()).toEqual([LEARNER, CLASSMATE].sort()); expect(told[0].link).toBe(`/challenges/${c.slug}`);

    await as(SCHOOL_ADMIN);
    expect((await rpc("select public.challenge_my_audiences()")).institutions).toEqual([{ id: INST, name: "Accra Academy" }]);
    const s = await competition(SCHOOL_ADMIN, [round("Round 1")]);
    await rpc("select public.challenge_set_audience($1,null,$2)", [s.id, INST]);
    await rpc("select public.challenge_publish($1)", [s.id]);
    await as(LEARNER); expect((await rpc("select public.challenge_start($1)", [s.slug])).stage_count).toBe(1);        // a learner in one of the school's classes
    await as(OUTSIDER); await fails("select public.challenge_start($1)", [s.slug], /NOT_IN_AUDIENCE/);
  });

  it("a learner's first join uses the free allowance; once it is used up they must subscribe, but rounds already joined continue", async () => {
    await as(OWNER);
    await db.exec("reset role"); await db.exec(`insert into public.qb_access_settings values ('free_practice_sessions','2'::jsonb)`);
    const make = async (t: string) => { await as(TEACHER); const c = await rpc("select public.challenge_create($1,'x','general_knowledge','PUBLIC',3,300,3)", [t]);
      await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(qs(1))]); await rpc("select public.challenge_publish($1)", [c.id]); return c; };
    const a = await make("Allowance A"), b = await make("Allowance B"), d = await make("Allowance D");
    await as(OUTSIDER);
    expect((await rpc("select public.qb_my_access()"))).toMatchObject({ gated: true, free_limit: 2, used: 0, remaining: 2, exhausted: false });
    await play(a.slug, 1, 3); await play(b.slug, 1, 3);
    expect((await rpc("select public.qb_my_access()"))).toMatchObject({ used: 2, remaining: 0, exhausted: true });
    await play(a.slug, 1, 2);                                                                                         // second try of one already joined: allowed
    await fails("select public.challenge_start($1)", [d.slug], /QB_FREE_ALLOWANCE_EXHAUSTED/);
    await as(OWNER); await db.exec("reset role"); await db.query("insert into public.learner_subscriptions(user_id, valid_until) values ($1, now() + interval '30 days')", [OUTSIDER]);
    await as(OUTSIDER); expect((await rpc("select public.challenge_start($1)", [d.slug])).questions).toHaveLength(3);        // subscribed: unlimited
    await as(TEACHER); await play(d.slug, 1, 3);                                                                       // the owner testing their own and teachers are never gated
    await as(OWNER); await db.exec("reset role"); await db.exec(`update public.qb_access_settings set value = 'null'::jsonb where key = 'free_practice_sessions'`);
  });

  it("lists by format and records shares for visible campaigns only", async () => {
    await as("service");
    const comps = await rpc("select public.challenge_public_list(60,0,'COMPETITION')"), chs = await rpc("select public.challenge_public_list(60,0,'CHALLENGE')");
    expect(comps.every((x: any) => x.format === "COMPETITION")).toBe(true); expect(chs.every((x: any) => x.format === "CHALLENGE")).toBe(true);
    expect(comps.length).toBeGreaterThan(0);
    await db.exec("reset role"); const count = () => rpc("select count(*)::int from public.challenge_events where event='campaign_shared'");
    const before = (await count()) as number;
    await as("service"); await db.query("select public.challenge_track_share($1)", [comps[0].slug]);
    await as(OUTSIDER); await fails("select public.challenge_track_share('x')", [], /permission denied/);
    await db.exec("reset role"); expect(await count()).toBe(before + 1);
  });

  it("the rollback removes the new functions", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await rpc("select count(*)::int from pg_proc where proname in ('challenge_set_audience','challenge_my_audiences','qb_challenge_cleared','challenge_track_share')")).toBe(0);
  });
});
