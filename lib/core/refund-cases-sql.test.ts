import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Refund cases and the Coin-credit tool on the real core ledger (isolated PostgreSQL; the core platform and payment migrations are applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CORE = read("../../supabase/migrations/20261007100000_core_platform_foundation.sql");
const ACCESS = read("../../supabase/migrations/20261018100000_access_gate_standalone.sql");
const PAY = read("../../supabase/migrations/20261019110000_subscription_payments.sql");
const MIGRATION = read("../../supabase/migrations/20261035100000_refund_cases.sql");
const ROLLBACK = read("../../supabase/rollback/refund_cases.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ADMIN, FIN, GUARDIAN, WARD, SPONSOR, STRANGER, TEACHER] = [1, 2, 3, 4, 5, 6, 7].map(id);
let db: PGlite;
let counter = 0;
const as = (user: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params)) ?? {})[0] as any;
const setting = (key: string, value: unknown) => rpc("select public.qb_setting_set($1,$2::jsonb)", [key, JSON.stringify(value)]);
const intent = (payer: string, beneficiary: string, coins = 10, idem = "idem-0000001") =>
  as(payer).then(() => rpc("select public.qb_payment_intent_create($1,$2,'GHS','testpay','mobile_money',$3)", [beneficiary, coins, idem]));
const event = (ref: string, status: string, over: Record<string, unknown> = {}) =>
  rpc("select public.qb_payment_apply_event('testpay',$1,$2,$3,$4,$5,'GHS',$6)", [over.event ?? `evt-${++counter}`, ref, status, over.providerRef ?? `prov-${ref}`, over.amount ?? 1000, over.verified ?? true]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;
    create table public.profiles(id uuid primary key,role text,status text,onboarding_completed_at timestamptz);
    create table public.currencies(code text primary key);
    create table public.institutions(id uuid primary key,name text);
    create table public.institution_memberships(id uuid primary key default gen_random_uuid(),institution_id uuid,user_id uuid,role text,status text);
    create table public.user_capabilities(user_id uuid not null,capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin','content_admin')),active boolean default true,primary key(user_id,capability));
    create table public.audit_logs(id uuid primary key default gen_random_uuid(),actor_user_id uuid,action text,entity_type text,entity_id uuid,status text,details jsonb,created_at timestamptz default now());
    create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid);
    create table public.attempts(id uuid primary key default gen_random_uuid());
    create table public.responses(id uuid primary key default gen_random_uuid());
    -- Hosted-shape stand-ins: both tables already exist in production and the migration must coexist with them.
    create table public.entitlements(id uuid primary key default gen_random_uuid(),user_id uuid,product text,status text);
    create table public.notification_deliveries(id uuid primary key default gen_random_uuid(),notification_id uuid,channel text,status text);
    -- Stand-ins for objects the migration replaces/relies on (production definitions: 20261002200000, 20261004110000, 20261006110000/120000).
    create schema quizbox_sme; create schema quizbox_ops;
    create function quizbox_sme.has_capability(p text) returns boolean language sql stable security definer as $$
      select auth.uid() is not null and (exists(select 1 from public.profiles where id=auth.uid() and lower(role)='owner')
        or exists(select 1 from public.user_capabilities where user_id=auth.uid() and active and capability in ('super_admin',p))) $$;
    create function quizbox_ops.analytics_student(p_student uuid) returns uuid language plpgsql stable security definer as $$
      declare v uuid:=coalesce(p_student,auth.uid()); begin if auth.uid() is null or (v<>auth.uid() and not quizbox_sme.has_capability('super_admin')) then raise exception 'NOT_AUTHORIZED'; end if; return v; end $$;
    create function quizbox_ops.student_insights(p uuid) returns jsonb language sql stable security definer as $$ select jsonb_build_object('learner',p) $$;
    create function public.qb_student_insights() returns jsonb language sql stable security definer as $$ select quizbox_ops.student_insights(auth.uid()) $$;
    create function public.qb_student_achievements(p_student_id uuid default auth.uid()) returns jsonb language plpgsql stable security definer as $$
      declare s uuid:=quizbox_ops.analytics_student(p_student_id); begin return jsonb_build_object('learner',s); end $$;
    grant usage on schema quizbox_sme, quizbox_ops to authenticated;
    grant execute on function quizbox_sme.has_capability(text) to authenticated;
    grant execute on function public.qb_student_achievements(uuid) to authenticated;
    grant select on public.profiles, public.institutions, public.institution_memberships, public.user_capabilities, public.notifications to authenticated;
    insert into public.currencies values('GHS');
    insert into public.profiles values('${ADMIN}','OWNER','active',now()),('${FIN}','STUDENT','active',now()),('${GUARDIAN}','STUDENT','active',now()),
      ('${WARD}','STUDENT','active',now()),('${SPONSOR}','SPONSOR','active',now()),('${STRANGER}','STUDENT','active',now()),('${TEACHER}','TEACHER','active',null);
    insert into public.user_capabilities values('${FIN}','content_admin');
  `);
  await db.exec(CORE);
  await db.exec("alter table public.profiles add column email text; update public.profiles set email = id::text || '@example.com'");
  await db.exec("create table public.assessments(id uuid primary key default gen_random_uuid(), owner_user_id uuid, reference_type text); create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid)");
  await db.exec("create schema quizbox_market; create function quizbox_market.is_super() returns boolean language sql stable as $$ select quizbox_sme.has_capability('super_admin') $$");
  await db.exec(`insert into public.user_capabilities values('${FIN}','finance_admin')`);
  await db.exec(ACCESS.slice(ACCESS.indexOf("create table if not exists public.qb_access_settings"), ACCESS.indexOf("create or replace function public.qb_start_quick_practice")));
  await db.exec(PAY);
  await as(ADMIN);
  await setting("flags.buy_coins_enabled", true);
  await setting("flags.student_self_pay", true);
  await setting("payments.providers", ["testpay"]);
  await setting("coins.unit_price_minor", { GHS: 100 });
});
afterAll(async () => { await db.close(); });

beforeAll(async () => { await db.exec(MIGRATION); });

const settle = async (payer: string, beneficiary: string, coins: number, idem: string, plan: string | null = null, fulfil = false) => {
  const i = await intent(payer, beneficiary, coins, idem);
  if (plan) await db.query("select public.qb_set_payment_plan($1,$2,30)", [i.reference, plan]);
  await event(i.reference, "successful", { amount: coins * 100 });
  if (fulfil) await rpc("select public.qb_fulfil_subscription_payment($1)", [i.reference]);
  return i.reference as string;
};
const balance = async (u: string) => Number((await q("select purchased_balance::int b from public.wallets where user_id=$1", [u]))?.b ?? 0);
const credit = (ref: string, coins: number, reason = "Duplicate charge confirmed from both receipts", c: string | null = null, over = false) =>
  rpc("select public.qb_admin_refund_credit($1,$2,$3,$4,$5)", [ref, coins, reason, c, over]);
const saveCase = (ref: string, kind: string, status: string, note = "Checked the account activity log", c: string | null = null, over = false) =>
  rpc("select public.qb_admin_refund_case_save($1,$2,$3,$4,$5,$6)", [ref, kind, status, note, c, over]);
const rejects = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };

describe("refund tools", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("is for owners and finance admins only, and never for anonymous callers", async () => {
    const ref = await settle(WARD, WARD, 5, "idem-ref-auth1");
    for (const who of [WARD, STRANGER, TEACHER, SPONSOR, GUARDIAN]) {
      await as(who);
      await rejects("select public.qb_admin_payment_facts($1)", [ref], /QB_FORBIDDEN/);
      await rejects("select public.qb_admin_refund_credit($1,1,'Trying without permission')", [ref], /QB_FORBIDDEN/);
      await rejects("select public.qb_admin_refund_case_save($1,'other','open','Trying without permission')", [ref], /QB_FORBIDDEN/);
      await rejects("select public.qb_admin_refund_cases()", [], /QB_FORBIDDEN/);
    }
    await db.exec("reset role"); await db.exec("set role anon");
    await rejects("select public.qb_admin_refund_cases()", [], /permission denied/);
    await db.exec("reset role"); await as(FIN);
    expect((await rpc("select public.qb_admin_payment_facts($1)", [ref]))[0].reference).toBe(ref);
    await as(ADMIN);
    expect(await rpc("select public.qb_admin_refund_cases()")).toEqual([]);
  });

  it("finds a payment by reference or by the buyer's email and shows what the policy needs", async () => {
    const ref = await settle(SPONSOR, SPONSOR, 10, "idem-facts-001", "learner_monthly", true);
    await as(FIN);
    const byRef = (await rpc("select public.qb_admin_payment_facts($1)", [ref]))[0];
    expect(byRef).toMatchObject({ reference: ref, coins: 10, credited: true, subscription_granted: true, coins_spent_after: 10, within_window: true, same_plan_charges_24h: 0 });
    const byMail = await rpc("select public.qb_admin_payment_facts($1)", [`${SPONSOR}@example.com`]);
    expect(byMail.map((r: any) => r.reference)).toContain(ref);
    await rejects("select public.qb_admin_payment_facts('ab')", [], /QB_QUERY_TOO_SHORT/);
    expect(await rpc("select public.qb_admin_payment_facts('no-such-payment')")).toEqual([]);
  });

  it("spots a duplicate: the same buyer, plan and amount paid twice within a day", async () => {
    const a = await settle(TEACHER, TEACHER, 10, "idem-dup-aaaa", "learner_monthly");
    const b = await settle(TEACHER, TEACHER, 10, "idem-dup-bbbb", "learner_monthly");
    await as(FIN);
    const facts = await rpc("select public.qb_admin_payment_facts($1)", [b]);
    expect(facts[0].same_plan_charges_24h).toBe(1);
    expect(a).not.toBe(b);
  });

  it("credits a duplicate charge back as Coins, once, linked to the payment, with an audit entry", async () => {
    const ref = await settle(STRANGER, STRANGER, 10, "idem-credit-01");
    const before = await balance(STRANGER);
    await as(FIN);
    const done = await credit(ref, 10);
    expect(done).toMatchObject({ ok: true, replayed: false, coins: 10 });
    expect(await balance(STRANGER)).toBe(before + 10);
    const tx = await q("select kind, bucket, amount::int a, payment_intent_id is not null linked, actor_id from public.coin_transactions where id=$1", [done.transaction]);
    expect(tx).toMatchObject({ kind: "refund", bucket: "purchased", a: 10, linked: true, actor_id: FIN });
    expect((await q("select status, coins_credited::int c from public.refund_cases where id=$1", [done.case]))).toMatchObject({ status: "credited", c: 10 });
    expect((await q("select count(*)::int n from public.audit_logs where action='refund.credit' and entity_id=$1", [done.case])).n).toBe(1);
    // the same case again (double click, retry) changes nothing
    const again = await credit(ref, 10, "Duplicate charge confirmed from both receipts", done.case);
    expect(again).toMatchObject({ ok: true, replayed: true });
    expect(await balance(STRANGER)).toBe(before + 10);
  });

  it("never returns more than was paid, in total, and needs a real reason", async () => {
    const ref = await settle(TEACHER, TEACHER, 10, "idem-credit-02");
    await as(FIN);
    await rejects("select public.qb_admin_refund_credit($1,11,'Too much for this payment')", [ref], /QB_INVALID_AMOUNT/);
    await rejects("select public.qb_admin_refund_credit($1,0,'Nothing to return here')", [ref], /QB_INVALID_AMOUNT/);
    await rejects("select public.qb_admin_refund_credit($1,5,'short')", [ref], /QB_REASON_REQUIRED/);
    await credit(ref, 6);
    await rejects("select public.qb_admin_refund_credit($1,6,'A second case that would exceed it')", [ref], /QB_EXCEEDS_PAYMENT/);
    await credit(ref, 4, "The remaining four Coins, confirmed");
    expect((await rpc("select public.qb_admin_payment_facts($1)", [ref]))[0].coins_already_returned).toBe(10);
  });

  it("only returns Coins for a settled payment, inside 7 days unless an override is given", async () => {
    await as(ADMIN);
    const open = await intent(WARD, WARD, 5, "idem-unpaid-01");
    await as(FIN);
    await rejects("select public.qb_admin_refund_credit($1,5,'The payment never went through')", [open.reference], /QB_PAYMENT_NOT_SETTLED/);
    const old = await settle(WARD, WARD, 5, "idem-old-pay-01");
    await db.exec("reset role");
    await db.query("update public.payment_intents set created_at = now() - interval '10 days' where reference=$1", [old]);
    await as(FIN);
    await rejects("select public.qb_admin_refund_credit($1,5,'Asked after the seven days')", [old], /QB_OUTSIDE_WINDOW/);
    const late = await credit(old, 5, "Asked after seven days, approved by the owner", null, true);
    expect(late.ok).toBe(true);
    expect((await q("select metadata ->> 'override' o from public.coin_transactions where id=$1", [late.transaction])).o).toBe("true");
  });

  it("allows a cash refund only when no Coins of the purchase were used, inside 7 days", async () => {
    const unused = await settle(GUARDIAN, GUARDIAN, 5, "idem-cash-0001");                              // paid and credited, never applied or spent
    const applied = await settle(SPONSOR, SPONSOR, 5, "idem-cash-0002", "learner_weekly", true);        // plan granted: the Coins were spent
    await as(FIN);
    const ok = await saveCase(unused, "unapplied", "cash_refund_due", "Payment received but not applied; no Coins used (activity log checked)");
    expect(ok).toMatchObject({ status: "cash_refund_due", kind: "unapplied" });
    await rejects("select public.qb_admin_refund_case_save($1,'unapplied','cash_refund_due','Asking for cash after the plan was used')", [applied], /QB_COINS_ALREADY_USED/);
    const done = await saveCase(unused, "unapplied", "cash_refunded", "Refunded from the Paystack dashboard", ok.id);
    expect(done).toMatchObject({ status: "cash_refunded", id: ok.id });
    const declined = await saveCase(applied, "other", "declined", "Coins already used for the plan, so not refundable under the policy");
    expect(declined.status).toBe("declined");
    const listed = await rpc("select public.qb_admin_refund_cases()");
    expect(listed.map((c: any) => c.status).sort()).toEqual(expect.arrayContaining(["cash_refunded", "declined"]));
  });

  it("refuses a cash refund outside the window, and lets a credited case stay closed", async () => {
    const ref = await settle(STRANGER, STRANGER, 5, "idem-late-cash1");
    await db.exec("reset role");
    await db.query("update public.payment_intents set created_at = now() - interval '9 days' where reference=$1", [ref]);
    await as(FIN);
    await rejects("select public.qb_admin_refund_case_save($1,'unapplied','cash_refund_due','Too late for the policy window')", [ref], /QB_OUTSIDE_WINDOW/);
    const dupRef = await settle(WARD, WARD, 5, "idem-closed-01");
    await as(FIN);
    const credited = await credit(dupRef, 5);
    await rejects("select public.qb_admin_refund_case_save($1,'duplicate','declined','Trying to reopen a closed case',$2)", [dupRef, credited.case], /QB_CASE_CLOSED/);
    await rejects("select public.qb_admin_refund_case_save($1,'nonsense','open','A kind that does not exist')", [dupRef], /QB_INVALID_CASE/);
  });

  it("a browser can never read or write a case directly", async () => {
    await as(FIN);
    await db.exec("set role authenticated");
    await rejects("select * from public.refund_cases", [], /permission denied/);
    await rejects("update public.refund_cases set coins_credited = 999", [], /permission denied/);
    await db.exec("reset role");
  });

  it("rolls back cleanly and leaves the Coins already credited", async () => {
    await db.exec("reset role");
    const before = (await q("select count(*)::int n from public.coin_transactions where kind='refund'")).n;
    await db.exec(ROLLBACK);
    expect((await q("select to_regclass('public.refund_cases')::text t")).t).toBeNull();
    expect((await q("select count(*)::int n from pg_proc where proname like 'qb_admin_refund%' or proname='qb_admin_payment_facts'")).n).toBe(0);
    expect((await q("select count(*)::int n from public.coin_transactions where kind='refund'")).n).toBe(before);
    await db.exec(MIGRATION);
  });
});
