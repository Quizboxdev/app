import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Learners keep to academic content (isolated PostgreSQL; the Challenges migrations and this one applied in order, unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CHAIN = ["20261021100000_challenges_foundation", "20261022100000_challenges_extensions", "20261023100000_challenges_moderation", "20261027100000_competitions_and_sharing", "20261029100000_quiz_studio"].map((n) => read(`../../supabase/migrations/${n}.sql`));
const MIGRATION = read("../../supabase/migrations/20261034100000_student_academic_limits.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, LEARNER] = [1, 2, 3].map(id);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const typed = (n = 3) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ question_text: `Typed question ${i + 1} here?`, options: ["one", "two", "three", "four"], correct_index: 0 })));
const create = (title: string, vis = "PUBLIC", fmt = "CHALLENGE") => rpc("select public.challenge_create($1,'x','general_knowledge',$2,3,300,1,null,null,null,$3,$4)", [title, vis, vis === "PRIVATE" ? "CODE12" : null, fmt]);
const get = (id: string) => rpc("select public.challenge_creator_get($1)", [id]);

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
      entity_type text, entity_id uuid, created_at timestamptz not null default now(), read_at timestamptz, market_id uuid, link text, category text not null default 'system');
    create table public.institutions(id uuid primary key, name text);
    create table public.institution_memberships(institution_id uuid, user_id uuid, role text, status text);
    create table public.classes(id uuid primary key, class_name text, status text default 'active', teacher_user_id uuid, institution_id uuid);
    create table public.class_memberships(class_id uuid, student_user_id uuid, status text default 'active');
    create table public.assessments(id uuid primary key default gen_random_uuid(), owner_user_id uuid, reference_type text);
    create table public.qb_access_settings(key text primary key, value jsonb not null);
    create table public.learner_subscriptions(user_id uuid, status text default 'active', valid_from timestamptz default now(), valid_until timestamptz);
    create function public.qb_access_free_limit() returns integer language sql stable as $$ select null::integer $$;
    create function public.qb_has_subscription(p_user uuid) returns boolean language sql stable as $$ select false $$;
    insert into public.profiles values ('${OWNER}','OWNER','active','Owner','o@example.com'),('${TEACHER}','TEACHER','active','Teacher','t@example.com'),('${LEARNER}','STUDENT','active','Kofi','k@example.com');
    insert into public.student_profiles(user_id, managed_by) values ('${LEARNER}', null);
    insert into public.questions(subject_code, grade, question_text, option_a, option_b, option_c, option_d, correct_answer, explanation)
      select 'MATH', 'B5', 'Bank question number ' || g || ' about fractions?', 'one', 'two', 'three', 'four', 'A', 'because' from generate_series(1, 8) g;
  `);
  for (const sql of CHAIN) await db.exec(sql);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("learners keep to academic content", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("a learner's quiz is link-only, curriculum, and has no prize, logo or reading material, even if the screen asks for more", async () => {
    await as(LEARNER);
    const c = await create("Fractions Fun", "PUBLIC");
    const card = (await get(c.id)).campaign;
    expect(card).toMatchObject({ category: "curriculum", visibility: "UNLISTED", reward_text: null, brand: {}, reader_enabled: false });
    await rpc("select public.challenge_update($1,$2)", [c.id, JSON.stringify({ visibility: "PUBLIC", reward_text: "A car" })]);
    expect((await get(c.id)).campaign).toMatchObject({ visibility: "UNLISTED", reward_text: null });
    await rpc("select public.challenge_set_brand($1,$2)", [c.id, JSON.stringify({ organiser_name: "Kofi Inc", accent: "#ff0000" })]);
    expect((await get(c.id)).campaign.brand).toEqual({});
    const priv = await create("Code Quiz", "PRIVATE");
    expect((await get(priv.id)).campaign.visibility).toBe("PRIVATE");                          // a code-only quiz stays code-only
  });

  it("a learner can only use bank questions: typed ones, uploaded material and prizes are refused", async () => {
    await as(LEARNER);
    const c = await create("Bank Only");
    await fails("select public.challenge_set_questions($1,$2)", [c.id, typed(3)], /ACADEMIC_ONLY/);
    await fails("select public.challenge_content_add($1,'My notes','notes','n.txt','',$2,true,null,'other',null)", [c.id, JSON.stringify([{ heading: null, body: "Some text that is long enough to count as a passage." }])], /ACADEMIC_ONLY/);
    await fails("select public.challenge_set_prizes($1,$2)", [c.id, JSON.stringify([{ rank_from: 1, rank_to: 1, kind: "cash", title: "Cash prize" }])], /ACADEMIC_ONLY/);
    expect((await rpc("select public.challenge_pull_bank($1,'MATH','B5',5)", [c.id])).added).toBe(5);
    const qs = (await get(c.id)).questions;
    expect(qs).toHaveLength(5); expect(qs.every((q: any) => q.source_question_id)).toBe(true);
  });

  it("a learner can remove a bank question, and the link to the bank is kept", async () => {
    await as(LEARNER);
    const c = await create("Remove One");
    await rpc("select public.challenge_pull_bank($1,'MATH','B5',4)", [c.id]);
    const before = (await get(c.id)).questions;
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(before.slice(1).map((q: any) => ({ question_text: q.question_text, options: q.options, correct_index: q.correct_index, explanation: q.explanation, stage_no: q.stage_no, source_question_id: q.source_question_id })))]);
    const after = (await get(c.id)).questions;
    expect(after).toHaveLength(3); expect(after.every((q: any) => q.source_question_id)).toBe(true);
    const first = after[0];
    await fails("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify([{ question_text: "Edited wording of the bank question?", options: first.options, correct_index: first.correct_index, source_question_id: first.source_question_id }])], /ACADEMIC_ONLY/);   // wording changed
    await fails("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify([{ question_text: first.question_text, options: first.options, correct_index: 1, source_question_id: first.source_question_id }])], /ACADEMIC_ONLY/);                       // answer changed
    await fails("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify([{ question_text: "Made up question text?", options: ["a", "b"], correct_index: 0, source_question_id: "00000000-0000-4000-8000-0000000fffff" }])], /ACADEMIC_ONLY/);   // not a real bank question
  });

  it("teachers and sponsors are unaffected: public, typed questions, prizes and branding all still work", async () => {
    await as(TEACHER);
    const c = await create("Teacher Quiz", "PUBLIC");
    expect((await get(c.id)).campaign).toMatchObject({ visibility: "PUBLIC", category: "general_knowledge" });
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, typed(3)]);
    await rpc("select public.challenge_set_prizes($1,$2)", [c.id, JSON.stringify([{ rank_from: 1, rank_to: 1, kind: "certificate", title: "Gold certificate" }])]);
    await rpc("select public.challenge_set_brand($1,$2)", [c.id, JSON.stringify({ organiser_name: "Efua School" })]);
    const got = await get(c.id);
    expect(got.questions).toHaveLength(3); expect(got.prizes).toHaveLength(1); expect(got.campaign.brand).toEqual({ organiser_name: "Efua School" }); expect(got.student_limited).toBe(false);
    await as(LEARNER); const mine = await create("Flag Check"); expect((await get(mine.id)).student_limited).toBe(true);
  });

  it("a learner can still join someone else's public competition", async () => {
    await as(TEACHER);
    const c = await create("Public Cup", "PUBLIC", "COMPETITION");
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, typed(3)]);
    await rpc("select public.challenge_publish($1)", [c.id]);
    await as(LEARNER); expect((await rpc("select public.challenge_join($1)", [c.slug])).ok).toBe(true);
  });
});
