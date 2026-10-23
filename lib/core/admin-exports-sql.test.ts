import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Admin data exports (isolated PostgreSQL). The Marketplace tables are the real ones (that migration is applied); the other tables are stubs with the columns the exports read.
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MARKET = read("../../supabase/migrations/20261043100000_marketplace.sql");
const MIGRATION = read("../../supabase/migrations/20261045100000_admin_exports.sql");
const ROLLBACK = read("../../supabase/rollback/admin_exports.sql");
const MORE = read("../../supabase/migrations/20261046100000_admin_exports_more.sql");
const MORE_ROLLBACK = read("../../supabase/rollback/admin_exports_more.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, FINANCE, SUPPORT, TEACHER, CHILD, STUDENT, CONTENT] = [1, 2, 3, 4, 5, 6, 7].map(id);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const run = (dataset: string, from: string | null = null, to: string | null = null, cat: string | null = null, limit = 50000) => rpc("select public.qb_export_run($1,$2::timestamptz,$3::timestamptz,$4,$5)", [dataset, from, to, cat, limit]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text, country text default 'Ghana', region text, school_name text, created_at timestamptz not null default now());
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, is_minor boolean not null default false);
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, actor_role text, action text, entity_type text, entity_id uuid, status text, details jsonb, created_at timestamptz not null default now());
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text not null, type text not null, title text not null, message text not null, created_at timestamptz not null default now(), read_at timestamptz, link text, category text not null default 'system');
    create table public.platform_settings(id uuid primary key default gen_random_uuid(), key text not null, scope_type text not null default 'global', scope_id uuid, value jsonb not null, description text not null default '');
    create unique index platform_settings_scope_key on public.platform_settings(key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid));
    create schema quizbox_core;
    create function quizbox_core.setting(p_key text) returns jsonb language sql stable as $$ select value from public.platform_settings where key = p_key and scope_type = 'global' $$;
    create function quizbox_core.flag(p_key text) returns boolean language sql stable as $$ select coalesce(quizbox_core.setting(p_key) = 'true'::jsonb, false) $$;
    create function quizbox_core.is_staff(p_roles text[] default array['super_admin']) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and (exists(select 1 from public.profiles where id = auth.uid() and lower(role) = 'owner') or exists(select 1 from public.user_capabilities where user_id = auth.uid() and active and capability = any(p_roles))) $$;
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql security definer as $$
      insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, p_entity_type, p_entity, 'pass', p_details) $$;
    grant usage on schema quizbox_core to anon, authenticated, service_role; grant execute on all functions in schema quizbox_core to anon, authenticated, service_role;
    create table public.payment_intents(id uuid primary key default gen_random_uuid(), reference text not null unique, payer_user_id uuid, beneficiary_user_id uuid not null, provider text not null default 'paystack', method text not null default 'mobile_money', currency_code text not null default 'GHS',
      amount_minor bigint not null, coins bigint not null, status text not null default 'initiated', reconciliation_status text not null default 'unreconciled', credited_tx_id uuid, settled_at timestamptz, metadata jsonb not null default '{}', created_at timestamptz not null default now());
    create function public.qb_coin_spend(p_user uuid, p_amount bigint, p_purpose text, p_ref text, p_idem text, p_entitlement jsonb default null) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create table public.learner_subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid, plan text, status text default 'active', valid_from timestamptz default now(), valid_until timestamptz, source text default 'manual', source_ref text, note text, created_at timestamptz not null default now(), revoked_at timestamptz);
    create table public.wallets(id uuid primary key default gen_random_uuid(), user_id uuid);
    create table public.coin_transactions(id uuid primary key default gen_random_uuid(), wallet_id uuid, bucket text, kind text, amount bigint, balance_after bigint, reason text default '', created_at timestamptz not null default now());
    create table public.refund_cases(id uuid primary key default gen_random_uuid(), payment_reference text, beneficiary_user_id uuid, kind text, status text, coins_credited bigint default 0, decision_note text default '', requested_at timestamptz not null default now(), decided_at timestamptz);
    create table public.price_list(id uuid primary key default gen_random_uuid(), code text, name text, audience text, kind text, period text, price_minor integer, currency text default 'GHS', active boolean default false, updated_at timestamptz not null default now());
    create table public.sme_payout_batches(id uuid primary key default gen_random_uuid(), currency_code text, period_start timestamptz, period_end timestamptz, status text, paid_at timestamptz, created_at timestamptz not null default now());
    create table public.sme_payout_items(payout_batch_id uuid, amount numeric);
    create table public.reviewer_earnings(id uuid primary key default gen_random_uuid(), reviewer_id uuid, earning_type text, quantity numeric, base_amount numeric, multiplier numeric, bonus_amount numeric, deduction_amount numeric, final_amount numeric, currency_code text, status text default 'pending_qa', earned_at timestamptz not null default now(), payable_at timestamptz, payout_batch_id uuid);
    create table public.reviewer_earning_states(id bigint generated always as identity primary key, earning_id uuid, status text);
    create table public.sme_review_events(id uuid primary key default gen_random_uuid(), reviewer_id uuid, question_id uuid, decision text, review_duration_seconds integer, revision_count integer, final_status text, qa_reversal boolean, dispute boolean, review_completed_at timestamptz not null default now());
    create table public.support_requests(id uuid primary key default gen_random_uuid(), reference text, requester_email text, category text, subject text, status text, priority text, source text, created_at timestamptz not null default now(), resolved_at timestamptz);
    create table public.help_articles(id uuid primary key default gen_random_uuid(), slug text, title text, category text, audiences text[], state text, views int default 0, helpful_yes int default 0, helpful_no int default 0, updated_at timestamptz not null default now(), published_at timestamptz);
    create table public.challenge_campaigns(id uuid primary key default gen_random_uuid(), owner_id uuid, title text, category text, format text default 'CHALLENGE', status text, visibility text, question_count int, starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now());
    create table public.challenge_participants(campaign_id uuid, user_id uuid);
    create table public.challenge_attempts(id uuid primary key default gen_random_uuid(), campaign_id uuid, user_id uuid, attempt_no int, score int, max_score int, duration_ms int, started_at timestamptz not null default now(), submitted_at timestamptz, expired boolean default false);
    create table public.questions(id uuid primary key default gen_random_uuid(), subject_name text, grade text, status text, created_at timestamptz not null default now());
    create table public.question_load_batches(id uuid primary key default gen_random_uuid(), file_name text, scope text, status text, rows_total int, rows_loaded int, rows_rejected int, uploaded_by uuid, created_at timestamptz not null default now(), completed_at timestamptz);
    alter table public.student_profiles add column grade text, add column school_name text, add column region text, add column status text default 'active', add column created_at timestamptz not null default now();
    create table public.teacher_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, school_name text, region text, status text default 'active', created_at timestamptz not null default now());
    create table public.classes(id uuid primary key default gen_random_uuid(), class_name text, school_name text, grade text, term text, academic_year text, status text default 'active', teacher_user_id uuid, join_code text, created_at timestamptz not null default now());
    create table public.class_memberships(id uuid primary key default gen_random_uuid(), class_id uuid, student_user_id uuid, status text default 'active');
    create table public.assignments(id uuid primary key default gen_random_uuid(), class_id uuid, teacher_user_id uuid, title text, subject_name text, grade text, question_count int, due_at timestamptz, status text default 'draft', created_at timestamptz not null default now(), published_at timestamptz);
    create table public.gradebook(id uuid primary key default gen_random_uuid(), class_id uuid, assignment_id uuid, student_user_id uuid, student_email text, student_name text, score numeric, total_marks numeric, percentage numeric, status text default 'final', graded_at timestamptz not null default now());
    create table public.sponsor_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, sponsor_type text, organization_name text, contact_name text, country text, verification_status text default 'PENDING', status text default 'ACTIVE', created_at timestamptz not null default now());
    create table public.competitions(id uuid primary key default gen_random_uuid(), sponsor_id uuid, competition_type text, title text, subject_code text, grade text, starts_at timestamptz, ends_at timestamptz, entry_fee numeric, currency text, prize_pool numeric, participant_limit int, status text, created_at timestamptz not null default now());
    create table public.competition_teams(id uuid primary key default gen_random_uuid(), competition_id uuid, team_name text);
    create table public.competition_results(id uuid primary key default gen_random_uuid(), competition_id uuid, entity_type text, entity_id uuid, score numeric, percentage numeric, completion_time_ms bigint, rank int, result_status text, calculated_at timestamptz not null default now());
    create table public.policy_documents(id uuid primary key default gen_random_uuid(), slug text, title text);
    create table public.policy_versions(id uuid primary key default gen_random_uuid(), document_id uuid, version_no int);
    create table public.policy_acceptances(id uuid primary key default gen_random_uuid(), user_id uuid, version_id uuid, accepted_at timestamptz not null default now());
    insert into public.profiles(id, role, status, full_name, email) values ('${OWNER}','OWNER','active','Owner','owner@example.com'),('${FINANCE}','ADMIN','active','Finance','finance@example.com'),('${SUPPORT}','ADMIN','active','Support','support@example.com'),
      ('${TEACHER}','TEACHER','active','Ama Teacher','ama@example.com'),('${CHILD}','STUDENT','active','Little Kofi','kofi.child@example.com'),('${STUDENT}','STUDENT','active','Esi Student','esi@example.com'),('${CONTENT}','TEACHER','active','Content','content@example.com');
    insert into public.student_profiles(user_id, is_minor) values ('${CHILD}', true), ('${STUDENT}', false);
    insert into public.user_capabilities values ('${FINANCE}','finance_admin',true),('${SUPPORT}','support_agent',true),('${CONTENT}','content_admin',true);
  `);
  await db.exec(MARKET);
  await db.exec(MIGRATION);
  await db.exec(MORE);
  // One row of everything, created at known times.
  await db.exec(`
    insert into public.payment_intents(reference, payer_user_id, beneficiary_user_id, amount_minor, coins, status, metadata, created_at) values
      ('QB-old', '${STUDENT}', '${STUDENT}', 500, 5, 'successful', '{"purpose":"subscription","plan":"weekly"}', '2026-08-15 10:00:00+00'),
      ('QB-mk', '${STUDENT}', '${STUDENT}', 4000, 40, 'successful', '{"purpose":"marketplace","item_title":"Physics 2nd Term Exams","item_subject":"Physics","item_school":"VPCS"}', '2026-10-23 17:09:48+00'),
      ('QB-open', '${STUDENT}', '${STUDENT}', 1000, 10, 'initiated', '{}', '2026-10-24 09:00:00+00');
    insert into public.learner_subscriptions(user_id, plan, valid_until, source, source_ref, created_at) values ('${STUDENT}', 'weekly', now() + interval '7 days', 'payment', 'QB-old', '2026-08-15 10:01:00+00');
    insert into public.wallets(id, user_id) values ('${id(50)}', '${STUDENT}');
    insert into public.coin_transactions(wallet_id, bucket, kind, amount, balance_after, created_at) values ('${id(50)}', 'purchased', 'purchase_credit', 40, 40, '2026-10-23 17:10:00+00'), ('${id(50)}', 'purchased', 'spend', -40, 0, '2026-10-23 17:10:01+00');
    insert into public.refund_cases(payment_reference, beneficiary_user_id, kind, status) values ('QB-old', '${STUDENT}', 'duplicate', 'open');
    insert into public.price_list(code, name, audience, kind, period, price_minor) values ('weekly', 'Weekly', 'learner', 'plan', 'month', 500);
    insert into public.support_requests(reference, requester_email, category, subject, status, priority, source, created_at, resolved_at) values ('QB-T-1', 'esi@example.com', 'payment', 'Paid but no set', 'resolved', 'high', 'app', '2026-10-23 18:00:00+00', '2026-10-23 21:00:00+00'), ('QB-T-2', 'x@example.com', 'account', 'Cannot log in', 'open', 'normal', 'contact_form', '2026-09-01 08:00:00+00', null);
    insert into public.help_articles(slug, title, category, audiences, state) values ('sell-question-sets', 'Sell', 'payments', array['teacher'], 'draft');
    insert into public.challenge_campaigns(id, owner_id, title, category, status, visibility, question_count) values ('${id(60)}', '${TEACHER}', 'Science Quiz', 'school', 'LIVE', 'PUBLIC', 10);
    insert into public.challenge_participants values ('${id(60)}', '${STUDENT}');
    insert into public.challenge_attempts(campaign_id, user_id, attempt_no, score, max_score, duration_ms, submitted_at) values ('${id(60)}', '${STUDENT}', 1, 7, 10, 90000, now());
    insert into public.questions(subject_name, grade, status, created_at) values ('Physics', 'B9', 'active', '2026-10-01 00:00:00+00'), ('Physics', 'B9', 'active', '2026-10-02 00:00:00+00'), ('English', 'B7', 'archived', '2026-10-02 00:00:00+00');
    insert into public.question_load_batches(file_name, scope, status, rows_total, rows_loaded, rows_rejected, uploaded_by) values ('physics.csv', 'CURRICULUM', 'LOADED', 100, 98, 2, '${CONTENT}');
    insert into public.sme_payout_batches(currency_code, period_start, period_end, status) values ('GHS', '2026-09-01', '2026-09-30', 'draft');
    insert into public.reviewer_earnings(reviewer_id, earning_type, quantity, base_amount, multiplier, bonus_amount, deduction_amount, final_amount, currency_code) values ('${CONTENT}', 'review', 1, 1, 1, 0, 0, 1, 'GHS');
    insert into public.reviewer_earning_states(earning_id, status) select id, 'payable' from public.reviewer_earnings;
    insert into public.sme_review_events(reviewer_id, question_id, decision, review_duration_seconds, revision_count, final_status, qa_reversal, dispute) values ('${CONTENT}', '${id(70)}', 'approve', 45, 0, 'approved', false, false);
    insert into public.policy_documents(id, slug, title) values ('${id(80)}', 'terms', 'Terms of Use'); insert into public.policy_versions(id, document_id, version_no) values ('${id(81)}', '${id(80)}', 1);
    insert into public.policy_acceptances(user_id, version_id) values ('${STUDENT}', '${id(81)}'), ('${CHILD}', '${id(81)}');
    insert into public.audit_logs(actor_user_id, actor_role, action, entity_type, status, details) values ('${OWNER}', 'owner', 'payment.credit', 'payment_intents', 'pass', '{"coins":40}');
    update public.student_profiles set grade = 'B7', school_name = 'VPCS', region = 'Greater Accra';
    insert into public.teacher_profiles(user_id, school_name, region) values ('${TEACHER}', 'VPCS', 'Greater Accra');
    insert into public.classes(id, class_name, school_name, grade, term, teacher_user_id, join_code) values ('${id(100)}', 'JHS 1A', 'VPCS', 'B7', 'Term 1', '${TEACHER}', 'SECRETJOIN');
    insert into public.class_memberships(class_id, student_user_id) values ('${id(100)}', '${STUDENT}');
    insert into public.assignments(id, class_id, teacher_user_id, title, subject_name, grade, question_count, status) values ('${id(101)}', '${id(100)}', '${TEACHER}', 'Fractions quiz', 'Mathematics', 'B7', 10, 'published');
    insert into public.gradebook(class_id, assignment_id, student_user_id, student_email, student_name, score, total_marks, percentage) values ('${id(100)}', '${id(101)}', '${STUDENT}', 'esi@example.com', 'Esi Student', 8, 10, 80);
    insert into public.sponsor_profiles(id, user_id, sponsor_type, organization_name, contact_name, country) values ('${id(102)}', '${OWNER}', 'COMPANY', 'Acme Foods', 'Kwame', 'Ghana');
    insert into public.competitions(id, sponsor_id, competition_type, title, subject_code, grade, entry_fee, currency, prize_pool, status) values ('${id(103)}', '${id(102)}', 'STANDARD', 'Inter-school Quiz', 'MATH', 'B7', 0, 'GHS', 1000, 'DRAFT');
    insert into public.competition_teams(competition_id, team_name) values ('${id(103)}', 'VPCS A');
    insert into public.competition_results(competition_id, entity_type, entity_id, score, percentage, completion_time_ms, rank, result_status) values ('${id(103)}', 'TEAM', '${id(104)}', 90, 90, 120000, 1, 'FINAL');
    insert into public.notifications(recipient_user_id, recipient_role, type, title, message) values ('${STUDENT}', 'STUDENT', 'assignment', 'New assignment', 'Secret message body about Fractions');
  `);
  // A teacher who sells: seller + item + a sale
  await db.exec(`
    insert into public.mk_sellers(id, user_id, display_name, school_name, phone, payout_method, payout_network, payout_account, payout_account_name, status, terms_accepted_at) values ('${id(90)}', '${TEACHER}', 'Ama Mensah', 'VPCS', '0244123456', 'mobile_money', 'MTN', '0244999888', 'Ama Mensah', 'verified', now());
    insert into public.mk_items(id, seller_id, slug, title, subject, grade, term, school_name, price_minor, status, question_count) values ('${id(91)}', '${id(90)}', 'physics-test', 'Physics 2nd Term Exams', 'Physics', 'SHS1', 'Term 2', 'VPCS', 4000, 'approved', 10);
    insert into public.mk_purchases(id, item_id, seller_id, buyer_user_id, payment_reference, item_title, item_subject, item_school, item_grade, price_minor, seller_share_minor, platform_fee_minor, expires_at, purchased_at)
      values ('${id(92)}', '${id(91)}', '${id(90)}', '${STUDENT}', 'QB-mk', 'Physics 2nd Term Exams', 'Physics', 'VPCS', 'SHS1', 4000, 2400, 1600, now() + interval '90 days', '2026-10-23 17:15:00+00');
    insert into public.mk_ledger(seller_id, kind, amount_minor, purchase_id, note) values ('${id(90)}', 'sale', 2400, '${id(92)}', 'Sale');
    insert into public.mk_payouts(seller_id, amount_minor, status, destination, due_at, gross_minor, platform_fee_minor, sales_count) values ('${id(90)}', 2400, 'requested', '{"account":"0244999888"}', now() + interval '1 day', 4000, 1600, 1);
  `);
});
afterAll(async () => { await db.close(); });

describe("admin data exports", () => {
  it("re-applies cleanly and is closed to anonymous callers", async () => {
    await db.exec("reset role"); await db.exec(MIGRATION); await db.exec(MORE);                                         // the second change builds on the first, in that order
    await as(null); await fails("select public.qb_export_catalog()", [], /permission denied/);
    await fails("select public.qb_export_run('payments')", [], /permission denied/);
    await as(STUDENT); await fails("select public.qb_export_build('payments', null, null, null, 10)", [], /permission denied/);   // the builder is internal
  });

  it("offers each person only the datasets their role allows", async () => {
    const keys = async (u: string) => { await as(u); return ((await rpc("select public.qb_export_catalog()")) as { key: string }[]).map((d) => d.key); };
    const owner = await keys(OWNER);
    expect(owner).toHaveLength(31);
    const finance = await keys(FINANCE);
    for (const k of ["payments", "subscriptions", "coin_ledger", "refund_cases", "mk_sales", "mk_payouts", "mk_ledger", "sme_earnings", "sme_payout_batches"]) expect(finance, k).toContain(k);
    for (const k of ["users", "audit_log", "policy_acceptances"]) expect(finance, k).not.toContain(k);                  // people and audit are owner-only
    const support = await keys(SUPPORT);
    expect(support).toContain("support_requests"); expect(support).not.toContain("payments"); expect(support).not.toContain("coin_ledger");
    const content = await keys(CONTENT);
    expect(content).toEqual(expect.arrayContaining(["question_bank", "question_batches", "sme_reviews", "mk_items"])); expect(content).not.toContain("payments");
    expect(await keys(TEACHER)).toEqual([]); expect(await keys(STUDENT)).toEqual([]);
  });

  it("every dataset runs, and every row has exactly one cell per column", async () => {
    await as(OWNER);
    const cat = (await rpc("select public.qb_export_catalog()")) as { key: string }[];
    for (const { key } of cat) {
      const r = await run(key);
      expect(r.columns.length, key).toBeGreaterThan(2);
      expect(r.total, key).toBeGreaterThan(0);
      for (const row of r.rows) expect(row.length, key).toBe(r.columns.length);
      expect(r.truncated, key).toBe(false);
    }
  });

  it("filters by date range and category, and shows the same thing in the total", async () => {
    await as(FINANCE);
    expect((await run("payments")).total).toBe(3);
    const oct = await run("payments", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
    expect(oct.total).toBe(2);
    expect(oct.rows.map((r: any[]) => r[0])).toEqual(["QB-open", "QB-mk"]);                                              // newest first
    const day = await run("payments", "2026-10-23T00:00:00Z", "2026-10-24T00:00:00Z");
    expect(day.rows.map((r: any[]) => r[0])).toEqual(["QB-mk"]);                                                         // "to" is exclusive
    const ok = await run("payments", null, null, "successful");
    expect(ok.total).toBe(2); expect(ok.rows.every((r: any[]) => r[3] === "successful")).toBe(true);
    const row = day.rows[0]; const col = (n: string) => row[day.columns.indexOf(n)];
    expect(col("Amount")).toBe(40); expect(col("Coins")).toBe(40); expect(col("Purpose")).toBe("marketplace"); expect(col("Plan or item")).toBe("Physics 2nd Term Exams"); expect(col("Source")).toBe("Physics · VPCS");
    expect(col("Created (UTC)")).toBe("2026-10-23 17:09:48"); expect(col("Buyer email")).toBe("esi@example.com");
  });

  it("refuses what a person may not export, a bad category, and a backwards date range", async () => {
    await as(SUPPORT); await fails("select public.qb_export_run('payments')", [], /QB_FORBIDDEN/);
    await as(FINANCE); await fails("select public.qb_export_run('users')", [], /QB_FORBIDDEN/); await fails("select public.qb_export_run('audit_log')", [], /QB_FORBIDDEN/);
    await as(TEACHER); await fails("select public.qb_export_run('support_requests')", [], /QB_FORBIDDEN/);
    await as(OWNER);
    await fails("select public.qb_export_run('nothing_like_this')", [], /QB_FORBIDDEN/);
    await fails("select public.qb_export_run('payments', null, null, $1)", ["'; drop table x; --"], /QB_INVALID_CATEGORY/);
    await fails("select public.qb_export_run('payments', '2026-10-02T00:00:00Z'::timestamptz, '2026-10-01T00:00:00Z'::timestamptz)", [], /QB_INVALID_RANGE/);
  });

  it("keeps private things out: children, payout account numbers, phone numbers, learner names", async () => {
    await as(OWNER);
    const users = await run("users");
    expect(JSON.stringify(users)).not.toContain("kofi.child@example.com");                                               // a teacher-managed child is left out
    expect(users.total).toBe(6);
    const acc = await run("policy_acceptances"); expect(acc.total).toBe(1); expect(JSON.stringify(acc)).not.toContain("kofi.child");
    for (const k of ["mk_sellers", "mk_payouts", "mk_ledger", "mk_sales", "mk_items"]) { const t = JSON.stringify(await run(k)); expect(t, k).not.toContain("0244999888"); expect(t, k).not.toContain("0244123456"); }
    const attempts = await run("challenge_attempts"); const j = JSON.stringify(attempts);
    expect(j).not.toContain("esi@example.com"); expect(j).not.toContain("Esi");
    expect(attempts.rows[0][attempts.columns.indexOf("Learner code")]).toMatch(/^[0-9a-f]{10}$/);
    expect(attempts.rows[0][attempts.columns.indexOf("Percent")]).toBe(70);
  });

  it("the Marketplace sale shows the source and the exact 60/40 split", async () => {
    await as(FINANCE);
    const s = await run("mk_sales"); const row = s.rows[0]; const col = (n: string) => row[s.columns.indexOf(n)];
    expect(col("Question set")).toBe("Physics 2nd Term Exams"); expect(col("Subject")).toBe("Physics"); expect(col("School")).toBe("VPCS");
    expect(col("Price")).toBe(40); expect(col("Teacher share")).toBe(24); expect(col("QuizBox share")).toBe(16); expect(col("Teacher")).toBe("Ama Mensah");
    const p = await run("mk_payouts"); expect(p.rows[0][p.columns.indexOf("Overdue")]).toBe(false);
  });

  it("counts questions by subject, grade and status within a date range", async () => {
    await as(CONTENT);
    const all = await run("question_bank"); expect(all.total).toBe(2);                                                                  // two groups: Physics B9 active, English B7 archived
    const physics = await run("question_bank", null, null, "Physics"); expect(physics.rows).toEqual([["Physics", "B9", "active", 2]]);
    const day = await run("question_bank", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z"); expect(day.rows).toEqual([["Physics", "B9", "active", 1]]);
  });

  it("logs real exports in the audit log, not previews, and flags a result cut short by the row limit", async () => {
    await db.exec("reset role"); await db.exec("delete from public.audit_logs where action = 'export.run'");
    await as(OWNER); await run("payments", null, null, null, 10);
    await db.exec("reset role"); expect(await rpc("select count(*)::int from public.audit_logs where action = 'export.run'")).toBe(0);
    await as(OWNER); await run("payments", "2026-10-01T00:00:00Z", null, "successful", 5000);
    await db.exec("reset role");
    const log = await rpc("select details from public.audit_logs where action = 'export.run'");
    expect(log).toMatchObject({ dataset: "payments", category: "successful", rows: 1, total: 1 });
    await as(OWNER); const cut = await run("payments", null, null, null, 2);
    expect(cut.rows).toHaveLength(2); expect(cut.total).toBe(3); expect(cut.truncated).toBe(true);
    const none = await run("payments", null, null, null, 0); expect(none.rows).toEqual([]); expect(none.total).toBe(3);
  });

  it("does not offer a dataset whose table does not exist in this database yet", async () => {
    await db.exec("reset role"); await db.exec("drop table public.question_load_batches");
    await as(OWNER); const keys = ((await rpc("select public.qb_export_catalog()")) as { key: string }[]).map((d) => d.key);
    expect(keys).not.toContain("question_batches"); expect(keys).toContain("payments");
    await fails("select public.qb_export_run('question_batches')", [], /QB_FORBIDDEN/);
  });

  it("rolls back the functions and applies again", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await rpc("select count(*)::int from pg_proc where proname like 'qb\\_export\\_%'")).toBe(0);
    await db.exec(MIGRATION);
    expect(await rpc("select count(*)::int from pg_proc where proname like 'qb\\_export\\_%'")).toBe(12);
    await db.exec(MORE);
    expect(await rpc("select count(*)::int from pg_proc where proname like 'qb\\_export\\_%'")).toBe(17);
  });

  it("the second change rolls back to the first (22 datasets) and applies again", async () => {
    await db.exec("reset role"); await db.exec(MORE_ROLLBACK);
    await as(OWNER); const keys = ((await rpc("select public.qb_export_catalog()")) as { key: string }[]).map((d) => d.key);
    expect(keys).toContain("payments"); expect(keys).not.toContain("classes"); expect(keys).not.toContain("learners");
    expect(await rpc("select count(*)::int from pg_proc where proname like 'qb\\_export\\_%'")).toBe(12);
    await db.exec("reset role"); await db.exec(MORE);
    await as(OWNER); expect(((await rpc("select public.qb_export_catalog()")) as unknown[]).length).toBe(30);   // 31, less the loading-batches dataset whose table an earlier test dropped
  });
});
