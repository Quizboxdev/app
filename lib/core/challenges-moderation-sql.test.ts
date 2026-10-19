import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Challenges moderation and notifications (isolated PostgreSQL; the three Challenges migrations applied in order, unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const FOUNDATION = read("../../supabase/migrations/20261021100000_challenges_foundation.sql");
const EXTENSIONS = read("../../supabase/migrations/20261022100000_challenges_extensions.sql");
const MODERATION = read("../../supabase/migrations/20261023100000_challenges_moderation.sql");
const ROLLBACK = read("../../supabase/rollback/challenges_moderation.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, R1, R2, R3, R4, PLAYER, CHILD] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
let db: PGlite;
const as = async (user: string | null | "service") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const qs = JSON.stringify(Array.from({ length: 3 }, (_, i) => ({ question_text: `Moderation question ${i + 1}?`, options: ["one", "two", "three", "four"], correct_index: 0 })));
const goLive = async (title: string, prizes?: unknown[]) => {
  await as(TEACHER);
  const c = await rpc("select public.challenge_create($1,'x','general_knowledge','PUBLIC',3,300,1)", [title]);
  await rpc("select public.challenge_set_questions($1,$2)", [c.id, qs]);
  if (prizes) await rpc("select public.challenge_set_prizes($1,$2)", [c.id, JSON.stringify(prizes)]);
  await rpc("select public.challenge_publish($1)", [c.id]);
  return c;
};
const inbox = async (user: string) => { await db.exec("reset role"); return (await db.query<any>("select title, category, link from public.notifications where recipient_user_id=$1 order by created_at", [user])).rows; };

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
    insert into public.profiles values ('${OWNER}','OWNER','active','Site Owner','o@example.com'),('${TEACHER}','TEACHER','active','Efua Mensah','t@example.com'),('${R1}','STUDENT','active','Reporter One','r1@example.com'),
      ('${R2}','STUDENT','active','Reporter Two','r2@example.com'),('${R3}','STUDENT','active','Reporter Three','r3@example.com'),('${R4}','STUDENT','active','Reporter Four','r4@example.com'),
      ('${PLAYER}','STUDENT','active','Kofi Boateng','k@example.com'),('${CHILD}','STUDENT','active','Ama',null);
    insert into public.student_profiles(user_id, managed_by) values ('${CHILD}','${TEACHER}');
  `);
  await db.exec(FOUNDATION); await db.exec(EXTENSIONS); await db.exec(MODERATION);
});
afterAll(async () => { await db.close(); });

describe("challenge moderation and notifications", () => {
  it("re-applies cleanly", async () => { await db.exec(MODERATION); });

  it("only signed-in, non-managed people can report; owners cannot report their own; private campaigns cannot be reported", async () => {
    const c = await goLive("Report Target");
    await as(null); await fails("select public.challenge_report($1,'spam')", [c.slug], /permission denied/);
    await as(CHILD); await fails("select public.challenge_report($1,'spam')", [c.slug], /NOT_AUTHORIZED/);
    await as(TEACHER); await fails("select public.challenge_report($1,'spam')", [c.slug], /NOT_AUTHORIZED/);
    await as(R1); await fails("select public.challenge_report($1,'not-a-reason')", [c.slug], /check|violates/);
    await as(TEACHER);
    const priv = await rpc("select public.challenge_create('Private One','x','general_knowledge','PRIVATE',3,300,1,null,null,null,'CODE12')");
    await rpc("select public.challenge_set_questions($1,$2)", [priv.id, qs]); await rpc("select public.challenge_publish($1)", [priv.id]);
    await as(R1); await fails("select public.challenge_report($1,'spam')", [priv.slug], /NOT_FOUND/);
  });

  it("hides a challenge after three different reporters, tells the owner, and an admin can dismiss", async () => {
    const c = await goLive("Hidden By Reports");
    await as(R1); await rpc("select public.challenge_report($1,'misleading','Answers are wrong')", [c.slug]); await rpc("select public.challenge_report($1,'spam')", [c.slug]);   // a second report from the same person changes nothing
    await as(R2); await rpc("select public.challenge_report($1,'misleading')", [c.slug]);
    await as("service"); expect((await rpc("select public.challenge_public_list()")).map((x: any) => x.slug)).toContain(c.slug);
    await as(R3); await rpc("select public.challenge_report($1,'inappropriate')", [c.slug]);
    await as("service");
    expect((await rpc("select public.challenge_public_list()")).map((x: any) => x.slug)).not.toContain(c.slug);
    await as(PLAYER); await fails("select public.challenge_start($1)", [c.slug], /CHALLENGE_NOT_LIVE/);
    expect((await inbox(TEACHER)).map((n: any) => n.title)).toContain("Your challenge is hidden for review");

    await as(R1); await fails("select public.challenge_reports_list()", [], /NOT_AUTHORIZED/);
    await as(OWNER);
    const list = await rpc("select public.challenge_reports_list()");
    const mine = list.filter((r: any) => r.slug === c.slug);
    expect(mine).toHaveLength(3); expect(mine[0]).toMatchObject({ moderation_state: "UNDER_REVIEW", open_reports: 3 });
    await rpc("select public.challenge_report_resolve($1,'DISMISS','Looked fine')", [mine[0].id]);
    await as("service"); expect((await rpc("select public.challenge_public_list()")).map((x: any) => x.slug)).toContain(c.slug);
    await as(OWNER); expect((await rpc("select public.challenge_reports_list()")).filter((r: any) => r.slug === c.slug)).toHaveLength(0);
  });

  it("a take-down hides the page from the public, keeps it visible to the owner and blocks publishing until restored", async () => {
    const c = await goLive("Taken Down");
    await as(R1); await rpc("select public.challenge_report($1,'copyright')", [c.slug]);
    await as(OWNER);
    const rep = (await rpc("select public.challenge_reports_list()")).find((r: any) => r.slug === c.slug);
    await fails("select public.challenge_report_resolve($1,'DELETE')", [rep.id], /INVALID_TRANSITION/);
    await rpc("select public.challenge_report_resolve($1,'TAKE_DOWN','Uses copyrighted text')", [rep.id]);
    await as("service"); expect(await rpc("select public.challenge_public_get($1)", [c.slug])).toBeNull();
    expect(await rpc("select public.challenge_leaderboard($1)", [c.slug])).toEqual([]);
    await as(TEACHER);
    expect((await rpc("select public.challenge_public_get($1)", [c.slug])).title).toBe("Taken Down");
    expect((await rpc("select public.challenge_creator_get($1)", [c.id])).campaign.moderation_state).toBe("TAKEN_DOWN");
    await rpc("select public.challenge_set_status($1,'PAUSED')", [c.id]);
    await fails("select public.challenge_publish($1)", [c.id], /TAKEN_DOWN/);
    expect((await inbox(TEACHER)).some((n: any) => n.title === "Your challenge was taken down")).toBe(true);
    await as(OWNER); await rpc("select public.challenge_report_resolve($1,'RESTORE')", [rep.id]);
    await as(TEACHER); await rpc("select public.challenge_publish($1)", [c.id]);
  });

  it("tells winners when prizes are worked out and when delivery changes, and never blocks if notifications are unavailable", async () => {
    const c = await goLive("Prize Notice", [{ rank_from: 1, title: "Trophy", kind: "goods" }]);
    const k = (await rpc("select public.challenge_creator_get($1)", [c.id])).questions as any[];
    await as(PLAYER);
    const s = await rpc("select public.challenge_start($1)", [c.slug]);
    await rpc("select public.challenge_submit($1,$2)", [s.attempt_id, JSON.stringify(s.questions.map((q: any) => ({ question_id: q.id, chosen_index: k.find((x) => x.id === q.id).correct_index })))]);
    await as(TEACHER); await rpc("select public.challenge_set_status($1,'COMPLETED')", [c.id]); await rpc("select public.challenge_finalize($1)", [c.id]);
    expect((await inbox(PLAYER)).map((n: any) => [n.title, n.category, n.link])).toEqual([["You won a prize", "reward", "/play"]]);
    await as(TEACHER);
    const award = (await rpc("select public.challenge_awards_list($1)", [c.id]))[0];
    await rpc("select public.challenge_award_update($1,'FULFILLED','Delivered')", [award.award_id]);
    expect((await inbox(PLAYER)).map((n: any) => n.title)).toEqual(["You won a prize", "Your prize has been delivered"]);
    await db.exec("reset role"); await db.exec("alter table public.notifications rename to notifications_off");
    await as(TEACHER); await rpc("select public.challenge_award_update($1,'CONTACTED')", [award.award_id]);     // still succeeds
    await db.exec("reset role"); await db.exec("alter table public.notifications_off rename to notifications");
  });

  it("the rollback removes moderation and the earlier migrations restore the previous behaviour", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK); await db.exec(FOUNDATION); await db.exec(EXTENSIONS);
    expect(await rpc("select count(*)::int from pg_proc where proname in ('challenge_report','challenge_reports_list','challenge_report_resolve','qb_challenge_notify')")).toBe(0);
    expect(await rpc("select to_regclass('public.challenge_reports') is null")).toBe(true);
    await db.exec(MODERATION);
  });
});
