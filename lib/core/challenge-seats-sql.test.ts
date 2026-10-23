import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Seat bundles for challenges and competitions (isolated PostgreSQL; the Challenges migrations and this one applied in order, unchanged; the Coin ledger is stubbed because it has its own tests).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CHAIN = ["20261021100000_challenges_foundation", "20261022100000_challenges_extensions", "20261023100000_challenges_moderation", "20261027100000_competitions_and_sharing", "20261029100000_quiz_studio"].map((n) => read(`../../supabase/migrations/${n}.sql`));
const MIGRATION = read("../../supabase/migrations/20261041100000_challenge_seats.sql");
const ROLLBACK = read("../../supabase/rollback/challenge_seats.sql");
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
    create table public.learner_subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid, plan text, status text default 'active', valid_from timestamptz default now(), valid_until timestamptz,
      source text default 'manual' check (source in ('manual','payment')), source_ref text, note text, created_by uuid);
    create schema quizbox_core;
    create table public.platform_settings(id uuid primary key default gen_random_uuid(), key text not null, scope_type text not null default 'global', scope_id uuid, value jsonb not null, description text not null default '');
    create unique index platform_settings_scope_key on public.platform_settings(key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
    create function quizbox_core.setting(p_key text) returns jsonb language sql stable as $$ select value from public.platform_settings where key = p_key and scope_type = 'global' $$;
    create function quizbox_core.flag(p_key text) returns boolean language sql stable as $$ select coalesce(quizbox_core.setting(p_key) = 'true'::jsonb, false) $$;
    grant usage on schema quizbox_core to anon, authenticated, service_role; grant execute on function quizbox_core.setting(text), quizbox_core.flag(text) to anon, authenticated, service_role;
    create table public.stub_wallet(user_id uuid primary key, balance bigint not null default 0); create table public.stub_spend(idem text primary key, user_id uuid, amount bigint);
    create function public.qb_coin_spend(p_user uuid, p_amount bigint, p_purpose text, p_ref text, p_idem text, p_entitlement jsonb default null) returns jsonb language plpgsql security definer as $$
      begin
        if exists (select 1 from public.stub_spend where idem = p_idem) then return jsonb_build_object('spent', p_amount, 'duplicate', true); end if;
        update public.stub_wallet set balance = balance - p_amount where user_id = p_user and balance >= p_amount;
        if not found then raise exception 'QB_INSUFFICIENT_BALANCE'; end if;
        insert into public.stub_spend values (p_idem, p_user, p_amount); return jsonb_build_object('spent', p_amount);
      end $$;
    create function public.qb_access_free_limit() returns integer language plpgsql stable as $$ begin return (select (value #>> '{}')::integer from public.platform_settings where key = 'test.allowance_limit' and jsonb_typeof(value) = 'number'); end $$;
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

const PLAYERS = Array.from({ length: 8 }, (_, i) => id(100 + i));
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
// Settings and wallets are closed to every browser role, so they are written as the database owner.
const setting = async (key: string, value: unknown) => { await db.exec("reset role"); return db.query("insert into public.platform_settings(key, value) values ($1, $2::jsonb) on conflict (key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set value = excluded.value", [key, JSON.stringify(value)]); };
const wallet = async (u: string, balance: number) => { await db.exec("reset role"); await db.query("insert into public.stub_wallet values ($1, $2) on conflict (user_id) do update set balance = excluded.balance", [u, balance]); };
const balance = async (u: string) => { await db.exec("reset role"); return Number((await q("select balance from public.stub_wallet where user_id=$1", [u]))?.balance ?? 0); };
const owner = async (sql: string, params: unknown[] = []) => { await db.exec("reset role"); return rpc(sql, params); };
// A live public quiz made by the teacher (the owner of the seats), with three typed questions.
const quiz = async (title: string) => {
  await as(TEACHER);
  const c = await create(title, "PUBLIC");
  await rpc("select public.challenge_set_questions($1,$2)", [c.id, typed(3)]);
  await rpc("select public.challenge_publish($1)", [c.id]);
  return c as { id: string; slug: string };
};
const fill = async (campaign: string, users: string[]) => { await db.exec("reset role"); for (const u of users) await db.query("insert into public.challenge_participants(campaign_id, user_id) values ($1,$2) on conflict do nothing", [campaign, u]); };
const join = async (u: string, slug: string) => { await as(u); return rpc("select public.challenge_join($1)", [slug]); };

beforeAll(async () => {
  await db.exec("reset role");
  for (const [i, p] of PLAYERS.entries()) {
    await db.query("insert into public.profiles values ($1,'STUDENT','active',$2,$3)", [p, `Player ${i}`, `p${i}@example.com`]);
    await db.query("insert into public.student_profiles(user_id, managed_by) values ($1, null)", [p]);
  }
  await db.exec(MIGRATION);
});

describe("seat bundles", () => {
  it("re-applies cleanly", async () => { await db.exec("reset role"); await db.exec(MIGRATION); });

  it("changes nothing while paid challenges are off: no cap, no limit on players", async () => {
    const c = await quiz("Everyone Welcome");
    expect((await owner("select seat_cap from public.challenge_campaigns where id=$1", [c.id]))).toBeNull();
    await fill(c.id, PLAYERS.slice(0, 7));
    expect((await join(PLAYERS[7], c.slug)).ok).toBe(true);
    await as(null); expect(await rpc("select public.qb_challenge_seat_status($1)", [c.slug])).toMatchObject({ capped: false, full: false });
  });

  it("with paid challenges on, a new quiz is free for 5 players, then full; people already in keep their place and the organiser is never blocked", async () => {
    await setting("flags.paid_challenges", true);
    const c = await quiz("Five Free");
    expect(await owner("select seat_cap from public.challenge_campaigns where id=$1", [c.id])).toBe(5);
    await fill(c.id, PLAYERS.slice(0, 5));
    await as(null); expect(await rpc("select public.qb_challenge_seat_status($1)", [c.slug])).toEqual({ capped: true, cap: 5, joined: 5, full: true });
    await as(PLAYERS[5]); await fails("select public.challenge_join($1)", [c.slug], /QUIZ_FULL/);
    await fails("select public.challenge_start($1,null,1)", [c.slug], /QUIZ_FULL/);                                             // starting without joining is full too
    expect((await join(PLAYERS[0], c.slug))).toMatchObject({ ok: true, already: true });                                       // already in: unaffected
    expect((await join(TEACHER, c.slug)).ok).toBe(true);                                                                        // the organiser can always join
  });

  it("leaves older quizzes without a cap, and class or school quizzes free", async () => {
    await setting("flags.paid_challenges", false);
    const legacy = await quiz("Made Before");
    await setting("flags.paid_challenges", true);
    await fill(legacy.id, PLAYERS.slice(0, 7));
    expect((await join(PLAYERS[7], legacy.slug)).ok).toBe(true);                                                                  // no cap was set, so no limit
    const forClass = await quiz("For One Class");
    await db.exec("reset role"); await db.query("insert into public.classes(id, class_name, teacher_user_id) values ($1,'Class A',$2)", [id(900), TEACHER]);
    await db.query("update public.challenge_campaigns set audience_class_id=$1 where id=$2", [id(900), forClass.id]);
    await fill(forClass.id, PLAYERS.slice(0, 6));
    await as(null); expect(await rpc("select public.qb_challenge_seat_status($1)", [forClass.slug])).toMatchObject({ capped: false, full: false });
    await as(TEACHER); await fails("select public.qb_challenge_seats_buy($1, 50)", [forClass.id], /QB_SEATS_NOT_NEEDED/);
  });

  it("sells a bundle for 1 Coin per player from the organiser's wallet, once, and charges only the difference on an upgrade", async () => {
    const c = await quiz("Bigger Quiz");
    await wallet(TEACHER, 100);
    await as(TEACHER);
    const info = await rpc("select public.qb_challenge_seats_info($1)", [c.id]);
    expect(info).toMatchObject({ enabled: true, free_seats: 5, seat_cap: 5, seats_paid: 0, class_targeted: false });
    const bought = await rpc("select public.qb_challenge_seats_buy($1, 20)", [c.id]);
    expect(bought).toMatchObject({ ok: true, already: false, seat_cap: 20, coins: 20 });
    expect(await balance(TEACHER)).toBe(80);
    await as(TEACHER); expect(await rpc("select public.qb_challenge_seats_buy($1, 20)", [c.id])).toMatchObject({ ok: true, already: true });   // a repeat charges nothing
    expect(await balance(TEACHER)).toBe(80);
    await as(TEACHER); expect(await rpc("select public.qb_challenge_seats_buy($1, 50)", [c.id])).toMatchObject({ seat_cap: 50, coins: 30 });   // upgrade: only the 30 more
    expect(await balance(TEACHER)).toBe(50);
    await fill(c.id, PLAYERS);                                                                                                      // eight players fit now
    await as(TEACHER); await fails("select public.qb_challenge_seats_buy($1, 30)", [c.id], /QB_INVALID_SEATS/);                       // cannot go down
    const row = await owner("select jsonb_build_object('cap', seat_cap, 'paid', seats_paid, 'at', seats_paid_at is not null, 'by', seats_paid_by) from public.challenge_campaigns where id=$1", [c.id]);
    expect(row).toEqual({ cap: 50, paid: 50, at: true, by: TEACHER });
  });

  it("refuses a bundle the organiser cannot afford, a silly size, someone else's quiz, and a purchase while the feature is off", async () => {
    const c = await quiz("Short Of Coins");
    await wallet(TEACHER, 10);
    await as(TEACHER);
    await fails("select public.qb_challenge_seats_buy($1, 100)", [c.id], /QB_INSUFFICIENT_BALANCE/);
    expect(await owner("select seat_cap from public.challenge_campaigns where id=$1", [c.id])).toBe(5);                           // nothing changed
    expect(await balance(TEACHER)).toBe(10);
    await as(TEACHER);
    for (const n of [5, 0, 1001, -3]) await fails("select public.qb_challenge_seats_buy($1,$2)", [c.id, n], /QB_INVALID_SEATS/);
    await as(PLAYERS[0]); await fails("select public.qb_challenge_seats_buy($1, 10)", [c.id], /NOT_AUTHORIZED/);
    await setting("flags.paid_challenges", false);
    await as(TEACHER); await fails("select public.qb_challenge_seats_buy($1, 10)", [c.id], /QB_FEATURE_DISABLED/);
    await setting("flags.paid_challenges", true);
  });

  it("gives the payer full access for the quiz period, at most 90 days, once per quiz", async () => {
    const c = await quiz("Access Quiz");
    await wallet(TEACHER, 200);
    await as(TEACHER); await rpc("select public.qb_challenge_seats_buy($1, 10)", [c.id]); await rpc("select public.qb_challenge_seats_buy($1, 20)", [c.id]);
    const subs = await owner("select jsonb_agg(jsonb_build_object('plan', plan, 'source', source, 'ref', source_ref, 'days', round(extract(epoch from (valid_until - now())) / 86400))) from public.learner_subscriptions where source_ref = $1", ["seats:" + c.id]);
    expect(subs).toHaveLength(1);                                                                                                 // the upgrade did not add a second grant
    expect(subs[0]).toMatchObject({ plan: "seats_access", source: "payment" }); expect(subs[0].days).toBeGreaterThan(88); expect(subs[0].days).toBeLessThanOrEqual(90);
    const short = await quiz("Short Quiz");
    await db.exec("reset role"); await db.query("update public.challenge_campaigns set ends_at = now() + interval '10 days' where id=$1", [short.id]);
    await as(TEACHER); await rpc("select public.qb_challenge_seats_buy($1, 10)", [short.id]);
    const days = await owner("select round(extract(epoch from (valid_until - now())) / 86400) from public.learner_subscriptions where source_ref = $1", ["seats:" + short.id]);
    expect(Number(days)).toBeLessThanOrEqual(10);
  });

  it("players of a paid quiz do not use their own free sessions; players of an unpaid quiz do", async () => {
    await setting("test.allowance_limit", 1);
    const paid = await quiz("Paid By Organiser"), free = await quiz("Free Quiz"), other = await quiz("Another Free Quiz");
    await wallet(TEACHER, 50); await as(TEACHER); await rpc("select public.qb_challenge_seats_buy($1, 10)", [paid.id]);
    const p = PLAYERS[1];
    await db.exec("reset role"); await db.query("delete from public.challenge_participants where user_id=$1", [p]);
    expect((await join(p, paid.slug)).ok).toBe(true);
    expect(await owner("select public.qb_free_sessions_used($1)", [p])).toBe(0);                                                     // the paid quiz was free for them
    expect((await join(p, free.slug)).ok).toBe(true);                                                                               // their one free session
    expect(await owner("select public.qb_free_sessions_used($1)", [p])).toBe(1);
    expect(await owner("select public.qb_challenge_allowance_blocked($1)", [p])).toBe(true);
    await as(p); await fails("select public.challenge_join($1)", [other.slug], /QB_FREE_ALLOWANCE_EXHAUSTED/);                        // an unpaid quiz is now blocked
    expect((await join(p, paid.slug))).toMatchObject({ ok: true, already: true });
    await setting("test.allowance_limit", null);
  });

  it("rolls back to the earlier functions, keeps the paid seats on the quizzes, and applies again", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect((await q("select count(*)::int n from pg_proc where proname in ('qb_challenge_full','qb_challenge_seats_buy','qb_challenge_seats_info','qb_challenge_seat_status')")).n).toBe(0);
    expect((await q("select count(*)::int n from public.challenge_campaigns where seats_paid > 0")).n).toBeGreaterThan(0);        // the columns and what was paid are kept
    const body = (await q("select pg_get_functiondef('public.challenge_join(text,text)'::regprocedure) d")).d as string;
    expect(body).not.toContain("QUIZ_FULL");
    await db.exec(MIGRATION);
    expect(((await q("select pg_get_functiondef('public.challenge_join(text,text)'::regprocedure) d")).d as string)).toContain("QUIZ_FULL");
  });
});
