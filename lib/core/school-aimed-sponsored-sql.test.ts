import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Sponsored school pilot: staff aim a challenge at one verified school, behind flags.sponsor_school_aiming (isolated PostgreSQL; the Challenges migrations,
// the competitions migration and this one applied in order, unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const FOUNDATION = read("../../supabase/migrations/20261021100000_challenges_foundation.sql");
const EXTENSIONS = read("../../supabase/migrations/20261022100000_challenges_extensions.sql");
const MODERATION = read("../../supabase/migrations/20261023100000_challenges_moderation.sql");
const COMPETITIONS = read("../../supabase/migrations/20261027100000_competitions_and_sharing.sql");
const MIGRATION = read("../../supabase/migrations/20261068100000_school_aimed_sponsored.sql");
const ROLLBACK = read("../../supabase/rollback/school_aimed_sponsored.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, SCHOOL_ADMIN, LEARNER, CLASSMATE, OUTSIDER, CHILD, SPONSOR, CAMPAIGN_ADMIN] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);
const CLASS = id(100), OTHER_CLASS = id(101), CLASS_3 = id(102), INST = id(200), INST_INACTIVE = id(201), INST_3 = id(202);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const qs = (n = 3) => Array.from({ length: n }, (_, i) => ({ question_text: `Sponsor question ${i + 1}?`, options: ["one", "two", "three", "four"], correct_index: 0, stage_no: 1 }));
const flag = async (on: boolean) => { await db.exec("reset role"); await db.query("update public.platform_settings set value = $1::jsonb where key = 'flags.sponsor_school_aiming'", [on ? "true" : "false"]); };
const sponsorQuiz = async (title: string) => {
  await as(SPONSOR);
  const c = await rpc("select public.challenge_create($1,'A quiz from our sponsor','sponsor','PUBLIC',3,300,1)", [title]);
  await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(qs())]);
  return c;
};
const before: Record<string, unknown> = {};
const WHO = { OWNER, TEACHER, SCHOOL_ADMIN, LEARNER, CAMPAIGN_ADMIN, SPONSOR } as const;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema quizbox_core;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.platform_settings(key text not null, scope_type text not null default 'global', scope_id uuid, value jsonb not null, description text not null default '');
    create unique index platform_settings_scope_key on public.platform_settings(key,scope_type,coalesce(scope_id,'00000000-0000-0000-0000-000000000000'));
    create function quizbox_core.setting(p_key text,p_scope_type text default 'global',p_scope uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
      select coalesce((select value from public.platform_settings where key=p_key and scope_type=p_scope_type and scope_id is not distinct from p_scope),(select value from public.platform_settings where key=p_key and scope_type='global')); $$;
    create function quizbox_core.flag(p_key text,p_scope_type text default 'global',p_scope uuid default null) returns boolean language sql stable security definer set search_path='' as $$
      select coalesce(quizbox_core.setting(p_key,p_scope_type,p_scope)='true'::jsonb,false); $$;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin')), active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.questions(id uuid primary key default gen_random_uuid(), subject_code text, grade text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text, status text default 'active', answer_type text default 'SINGLE_CHOICE');
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text not null, type text not null, title text not null, message text not null,
      entity_type text, entity_id uuid, created_at timestamptz not null default now(), read_at timestamptz, market_id uuid, link text check (link is null or link ~ '^/[A-Za-z0-9/_\\-?=&.]*$'), category text not null default 'system' check (category in ('reward','system','payment')));
    create table public.institutions(id uuid primary key, name text, status text not null default 'active', updated_at timestamptz not null default now());
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
      ('${CHILD}','STUDENT','active','Little One',null),('${SPONSOR}','SPONSOR','active','Bank Sponsor','s@example.com'),('${CAMPAIGN_ADMIN}','TEACHER','active','Campaign Staff','c@example.com');
    insert into public.student_profiles(user_id, managed_by) values ('${LEARNER}',null),('${CLASSMATE}',null),('${OUTSIDER}',null),('${CHILD}','${TEACHER}');
    insert into public.institutions(id, name, status) values ('${INST}','Accra Academy','active'),('${INST_INACTIVE}','Closed School','inactive'),('${INST_3}','Kumasi Day School','active');
    insert into public.institution_memberships values ('${INST}','${SCHOOL_ADMIN}','admin','active'),('${INST}','${TEACHER}','teacher','active');
    insert into public.classes values ('${CLASS}','JHS 2A','active','${TEACHER}','${INST}'),('${OTHER_CLASS}','JHS 3B','active','${OWNER}',null),('${CLASS_3}','JHS 1C','active',null,'${INST_3}');
    insert into public.class_memberships values ('${CLASS}','${CLASSMATE}','active'),('${CLASS}','${LEARNER}','active'),('${CLASS}','${CHILD}','active');
  `);
  await db.exec(FOUNDATION); await db.exec(EXTENSIONS); await db.exec(MODERATION); await db.exec(COMPETITIONS);
  await db.exec(`insert into public.user_capabilities(user_id, capability) values ('${CAMPAIGN_ADMIN}','campaign_admin')`);
  // What the audience list returns BEFORE this migration, for every kind of user.
  for (const [name, user] of Object.entries(WHO)) { await as(user); before[name] = await rpc("select public.challenge_my_audiences()"); }
  await db.exec("reset role"); await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("sponsored school pilot", () => {
  it("re-applies cleanly and ships with the flag off", async () => {
    await db.exec(MIGRATION);
    expect(await rpc("select value from public.platform_settings where key = 'flags.sponsor_school_aiming'")).toBe(false);
    expect(await rpc("select count(*)::int from public.platform_settings where key = 'flags.sponsor_school_aiming'")).toBe(1);
  });

  it("flag off: the audience list is exactly what it was, and staff behave as before (an unverified school can still be aimed at)", async () => {
    for (const [name, user] of Object.entries(WHO)) { await as(user); expect(await rpc("select public.challenge_my_audiences()")).toEqual(before[name]); }
    await as(OWNER);
    expect(await rpc("select public.challenge_my_audiences()")).toEqual({ classes: [{ id: OTHER_CLASS, name: "JHS 3B" }], institutions: [] });   // not a staff picker
    const c = await rpc("select public.challenge_create('Flag off','x','general_knowledge','PUBLIC',3,300,1)");
    await rpc("select public.challenge_set_audience($1,null,$2)", [c.id, INST_3]);
    await rpc("select public.challenge_set_audience($1,$2,null)", [c.id, CLASS_3]);
    expect((await rpc("select public.challenge_public_get($1)", [c.slug])).audience).toBe("CLASS");
  });

  it("flag on: staff are offered every active school (verified or not), and only verified schools' classes; others see the same as before", async () => {
    await flag(true);
    await as(OWNER);
    expect(await rpc("select public.challenge_my_audiences()")).toEqual({ classes: [], institutions: [
      { id: INST, name: "Accra Academy", verified: false }, { id: INST_3, name: "Kumasi Day School", verified: false }] });                 // the closed school is not offered
    await as(CAMPAIGN_ADMIN); expect((await rpc("select public.challenge_my_audiences()")).institutions).toHaveLength(2);
    for (const name of ["TEACHER", "SCHOOL_ADMIN", "LEARNER", "SPONSOR"] as const) { await as(WHO[name]); expect(await rpc("select public.challenge_my_audiences()")).toEqual(before[name]); }
  });

  it("only the owner, an admin or a super admin can mark a school verified, and a note pointing to the evidence is required", async () => {
    for (const who of [CAMPAIGN_ADMIN, TEACHER, SCHOOL_ADMIN, SPONSOR, LEARNER]) { await as(who); await fails("select public.institution_set_verified($1,true,'EMIS + letter on file')", [INST], /NOT_AUTHORIZED/); }
    await as(null); await expect(db.query("select public.institution_set_verified($1,true,'x')", [INST])).rejects.toThrow(/permission denied/);
    await as(OWNER);
    await fails("select public.institution_set_verified($1,true,null)", [INST], /VERIFICATION_NOTE_REQUIRED/);
    await fails("select public.institution_set_verified($1,true,'   ')", [INST], /VERIFICATION_NOTE_REQUIRED/);
    await fails("select public.institution_set_verified($1,true,$2)", [INST, "x".repeat(301)], /VERIFICATION_NOTE_TOO_LONG/);
    await fails("select public.institution_set_verified($1,true,'EMIS + letter on file')", [id(999)], /NOT_FOUND/);
  });

  it("flag on: staff cannot aim at an unverified school or its class; school administrators and teachers keep their own", async () => {
    await as(OWNER);
    const c = await rpc("select public.challenge_create('Guarded','x','general_knowledge','PUBLIC',3,300,1)");
    await fails("select public.challenge_set_audience($1,null,$2)", [c.id, INST], /SCHOOL_NOT_VERIFIED/);
    await fails("select public.challenge_set_audience($1,$2,null)", [c.id, CLASS_3], /SCHOOL_NOT_VERIFIED/);
    await rpc("select public.challenge_set_audience($1,$2,null)", [c.id, OTHER_CLASS]);                                       // a class with no school is untouched
    await as(CAMPAIGN_ADMIN);
    const d = await rpc("select public.challenge_create('Guarded 2','x','general_knowledge','PUBLIC',3,300,1)");
    await fails("select public.challenge_set_audience($1,null,$2)", [d.id, INST], /SCHOOL_NOT_VERIFIED/);
    await as(SCHOOL_ADMIN);                                                                                                    // their own school, still unverified: allowed
    const own = await rpc("select public.challenge_create('Own school','x','general_knowledge','PUBLIC',3,300,1)");
    await rpc("select public.challenge_set_audience($1,null,$2)", [own.id, INST]);
    await as(TEACHER);
    const mine = await rpc("select public.challenge_create('Own class','x','general_knowledge','PUBLIC',3,300,1)");
    await rpc("select public.challenge_set_audience($1,$2,null)", [mine.id, CLASS]);
    await as(SCHOOL_ADMIN); await fails("select public.challenge_set_audience($1,null,$2)", [own.id, INST_3], /NOT_AUTHORIZED/);   // never someone else's school
  });

  it("the pilot: a sponsor's quiz, a verified school, aimed by staff, published; members are told, the school is not named publicly, children stay out", async () => {
    const c = await sponsorQuiz("Bank Cup");
    await db.exec("reset role"); await db.query(`update public.challenge_campaigns set brand = '{"organiser_name":"Example Bank"}'::jsonb where id = $1`, [c.id]);
    await as(SPONSOR); await fails("select public.challenge_set_audience($1,null,$2)", [c.id, INST], /NOT_AUTHORIZED/);                // sponsors cannot pick a school
    await as(OWNER);
    expect(await rpc("select public.institution_set_verified($1,true,'EMIS no and signed letter on file')", [INST])).toEqual({ ok: true, verified: true });
    expect(await rpc("select public.challenge_my_audiences()")).toEqual({ classes: [{ id: CLASS, name: "Accra Academy · JHS 2A" }], institutions: [
      { id: INST, name: "Accra Academy", verified: true }, { id: INST_3, name: "Kumasi Day School", verified: false }] });
    await rpc("select public.challenge_set_audience($1,null,$2)", [c.id, INST]);
    const card = await rpc("select public.challenge_public_get($1)", [c.slug]);
    expect(card).toMatchObject({ audience: "SCHOOL", visibility: "UNLISTED", category: "sponsor", brand: { organiser_name: "Example Bank" } });
    expect(JSON.stringify(card)).not.toContain("Accra Academy");                                                              // the school is never named on the card
    await rpc("select public.challenge_publish($1)", [c.id]);
    await as(OUTSIDER); expect((await rpc("select public.challenge_public_list(60,0,null)")).some((x: any) => x.slug === c.slug)).toBe(false);
    await fails("select public.challenge_start($1)", [c.slug], /NOT_IN_AUDIENCE/);
    await as(LEARNER); expect((await rpc("select public.challenge_start($1)", [c.slug])).questions).toHaveLength(3);
    await as(CLASSMATE); expect((await rpc("select public.challenge_start($1)", [c.slug])).questions).toHaveLength(3);
    await as(CHILD); await fails("select public.challenge_start($1)", [c.slug], /NOT_AUTHORIZED/);                             // a managed under-13 learner in the class stays out
    await db.exec("reset role");
    const told = (await db.query<any>("select recipient_user_id, link from public.notifications where title = 'A new challenge for you' and message = 'Bank Cup'")).rows;
    expect(told.map((r) => r.recipient_user_id).sort()).toEqual([CLASSMATE, LEARNER, SCHOOL_ADMIN, TEACHER].sort());          // not the child, not the publisher
    expect(told.every((r) => r.link === `/challenges/${c.slug}`)).toBe(true);
    const audit = (await db.query<any>("select action from public.audit_logs where entity_id = $1 order by action", [INST])).rows;
    expect(audit).toEqual([{ action: "institution_verified" }]);
  });

  it("removing the mark blocks the next aim but not the campaign already live; the mark itself is cleared", async () => {
    await as(OWNER);
    expect(await rpc("select public.institution_set_verified($1,false,null)", [INST])).toEqual({ ok: true, verified: false });
    await db.exec("reset role");
    expect((await db.query<any>("select verified_at, verified_by, verification_note from public.institutions where id = $1", [INST])).rows[0]).toEqual({ verified_at: null, verified_by: null, verification_note: null });
    await as(OWNER);
    const c = await rpc("select public.challenge_create('Second','x','general_knowledge','PUBLIC',3,300,1)");
    await fails("select public.challenge_set_audience($1,null,$2)", [c.id, INST], /SCHOOL_NOT_VERIFIED/);
    await db.exec("reset role");
    expect((await rpc("select count(*)::int from public.challenge_campaigns where audience_institution_id = $1 and status = 'LIVE'", [INST]))).toBe(1);
  });

  it("flag back off: staff behave as before again", async () => {
    await flag(false);
    await as(OWNER);
    const c = await rpc("select public.challenge_create('Back off','x','general_knowledge','PUBLIC',3,300,1)");
    await rpc("select public.challenge_set_audience($1,null,$2)", [c.id, INST]);
    expect(await rpc("select public.challenge_my_audiences()")).toEqual(before.OWNER);
  });

  it("the rollback restores the earlier functions exactly and removes the new ones; the verification columns stay", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await rpc("select count(*)::int from pg_proc where proname in ('qb_school_aiming_on','qb_school_verifier','institution_set_verified')")).toBe(0);
    await flag(true);                                                                                                           // the flag means nothing once rolled back
    for (const [name, user] of Object.entries(WHO)) { await as(user); expect(await rpc("select public.challenge_my_audiences()")).toEqual(before[name]); }
    await as(OWNER);
    const c = await rpc("select public.challenge_create('After rollback','x','general_knowledge','PUBLIC',3,300,1)");
    await rpc("select public.challenge_set_audience($1,null,$2)", [c.id, INST_3]);
    await db.exec("reset role");
    expect(await rpc("select count(*)::int from information_schema.columns where table_name = 'institutions' and column_name in ('verified_at','verified_by','verification_note')")).toBe(3);
    await db.exec(MIGRATION);                                                                                                   // and it can be applied again
  });
});
