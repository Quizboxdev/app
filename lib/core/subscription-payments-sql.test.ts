import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Subscription payments on the real core ledger (isolated PostgreSQL; the core platform migration is applied unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const CORE = read("../../supabase/migrations/20261007100000_core_platform_foundation.sql");
const ACCESS = read("../../supabase/migrations/20261018100000_access_gate_standalone.sql");
const PAY = read("../../supabase/migrations/20261019110000_subscription_payments.sql");
const ROLLBACK = read("../../supabase/rollback/subscription_payments.sql");
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
const sub = (u: string) => q("select status, plan, source, source_ref, valid_until from public.learner_subscriptions where user_id=$1 order by created_at desc limit 1", [u]);

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

describe("subscription payments", () => {
  it("shows the Subscribe page whether payments are on and the unit price", async () => {
    await as(WARD);
    expect(await rpc("select public.qb_subscription_catalog()")).toMatchObject({ payments_enabled: true, currency: "GHS", unit_price_minor: 100, providers: ["testpay"] });
    await as(ADMIN); await setting("flags.student_self_pay", false);
    await as(WARD);
    expect((await rpc("select public.qb_subscription_catalog()")).payments_enabled).toBe(false);
    await as(ADMIN); await setting("flags.student_self_pay", true);
  });

  it("settles a paid plan into a subscription: Coins credited, then spent, one subscription, replay is a no-op", async () => {
    const i = await intent(WARD, WARD, 10, "idem-plan-001");
    await db.query("select public.qb_set_payment_plan($1,'learner_monthly',30)", [i.reference]);
    expect(await rpc("select public.qb_fulfil_subscription_payment($1)", [i.reference])).toEqual({ outcome: "not_settled" });     // nothing before payment
    expect((await event(i.reference, "successful", { amount: 1000 })).outcome).toBe("credited");
    const f = await rpc("select public.qb_fulfil_subscription_payment($1)", [i.reference]);
    expect(f.outcome).toBe("fulfilled");
    expect(await sub(WARD)).toMatchObject({ status: "active", plan: "learner_monthly", source: "payment", source_ref: i.reference });
    expect((await q("select purchased_balance::int b from public.wallets where user_id=$1", [WARD])).b).toBe(0);                       // the 10 Coins were spent
    expect((await rpc("select public.qb_fulfil_subscription_payment($1)", [i.reference])).outcome).toBe("already_fulfilled");
    expect((await q("select count(*)::int n from public.learner_subscriptions where user_id=$1", [WARD])).n).toBe(1);
    await as(WARD);
    expect(await rpc("select public.qb_my_access()")).toMatchObject({ subscribed: true });
  });

  it("a second payment extends the first rather than overlapping it", async () => {
    const first = new Date((await sub(WARD)).valid_until).getTime();
    const i = await intent(WARD, WARD, 10, "idem-plan-002");
    await db.query("select public.qb_set_payment_plan($1,'learner_monthly',30)", [i.reference]);
    await event(i.reference, "successful", { amount: 1000 });
    await rpc("select public.qb_fulfil_subscription_payment($1)", [i.reference]);
    const second = new Date((await sub(WARD)).valid_until).getTime();
    expect(Math.round((second - first) / 86_400_000)).toBe(30);
  });

  it("does nothing for a payment that is not a subscription, a wrong amount or an unverified event", async () => {
    const coinsOnly = await intent(GUARDIAN, GUARDIAN, 5, "idem-coins-001");
    await event(coinsOnly.reference, "successful", { amount: 500 });
    expect((await rpc("select public.qb_fulfil_subscription_payment($1)", [coinsOnly.reference])).outcome).toBe("not_a_subscription");
    const wrong = await intent(STRANGER, STRANGER, 10, "idem-wrong-01");
    await db.query("select public.qb_set_payment_plan($1,'learner_monthly',30)", [wrong.reference]);
    expect((await event(wrong.reference, "successful", { amount: 999 })).outcome).toBe("amount_mismatch");
    expect((await rpc("select public.qb_fulfil_subscription_payment($1)", [wrong.reference])).outcome).toBe("not_settled");
    const forged = await intent(TEACHER, TEACHER, 10, "idem-forged-1");
    await db.query("select public.qb_set_payment_plan($1,'learner_monthly',30)", [forged.reference]);
    expect((await event(forged.reference, "successful", { verified: false })).outcome).toBe("rejected_unverified");
    expect((await sub(STRANGER))).toBeUndefined();
    expect((await sub(TEACHER))).toBeUndefined();
  });

  it("a refund ends the subscription", async () => {
    const i = await q("select reference from public.payment_intents where beneficiary_user_id=$1 and idempotency_key='idem-plan-002'", [WARD]);
    expect((await rpc("select public.qb_revoke_subscription_payment($1,'refunded at the parent request')", [i.reference])).revoked).toBe(1);
    expect((await q("select status from public.learner_subscriptions where source_ref=$1", [i.reference])).status).toBe("revoked");
    await as(WARD);
    expect(await rpc("select public.qb_my_access()")).toMatchObject({ subscribed: true });       // the first month is still active
  });

  it("keeps the server functions away from browsers and shows payments to finance staff only", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await expect(db.query("select public.qb_fulfil_subscription_payment('x')")).rejects.toThrow();
      await expect(db.query("select public.qb_set_payment_plan('x','p',30)")).rejects.toThrow();
      await db.exec("reset role");
    }
    await as(WARD);
    await expect(db.query("select public.qb_admin_payments(10)")).rejects.toThrow("QB_FORBIDDEN");
    await as(FIN);
    const list = await rpc("select public.qb_admin_payments(10)");
    expect(list.length).toBeGreaterThan(2);
    expect(list[0]).toMatchObject({ currency: "GHS" });
    expect(list[0].learner).toBeDefined();
  });

  it("rolls back without touching the ledger", async () => {
    await db.exec(ROLLBACK);
    expect((await q("select to_regprocedure('public.qb_fulfil_subscription_payment(text)') f")).f).toBeNull();
    expect((await q("select count(*)::int n from public.payment_intents")).n).toBeGreaterThan(3);
  });
});

// The GHS 5 minimum (migration 20261032100000). Runs after the tests above, on the same database.
describe("minimum online charge", () => {
  it("refuses a charge under GHS 5 and accepts GHS 5 and above", async () => {
    await as(ADMIN); await setting("flags.buy_coins_enabled", true); await setting("flags.student_self_pay", true); await setting("payments.providers", ["testpay"]); await setting("coins.unit_price_minor", { GHS: 100 });
    await db.exec(read("../../supabase/migrations/20261032100000_minimum_charge.sql"));
    await expect(intent(WARD, WARD, 4, "idem-min-0001")).rejects.toThrow(/QB_BELOW_MINIMUM_CHARGE/);
    const five = await intent(WARD, WARD, 5, "idem-min-0002");
    expect(Number(five.amount_minor)).toBe(500);
    const ten = await intent(WARD, WARD, 10, "idem-min-0003");
    expect(Number(ten.amount_minor)).toBe(1000);                                  // still linear: Coins x GHS 1
  });
});
