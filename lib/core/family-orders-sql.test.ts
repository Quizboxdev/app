import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Family workspace phases 6 and 7 (migration 20261082100000): one checkout for several children, settled all-or-nothing and exactly once. Runs the real migration SQL; the payment functions it
// builds on (intent create, apply event, subscription fulfilment) are replaced by small stand-ins that keep their rules (relationship check, amount check, duplicate events, credit once).
const MIGS = ["supabase/migrations/20261079100000_family_workspace.sql", "supabase/migrations/20261080100000_family_children.sql", "supabase/migrations/20261082100000_family_orders.sql"];
const A = "00000000-0000-0000-0000-0000000000a1", B = "00000000-0000-0000-0000-0000000000a2";
const AMA = "00000000-0000-0000-0000-0000000000c1", KOJO = "00000000-0000-0000-0000-0000000000c2", SENA = "00000000-0000-0000-0000-0000000000c3", OTHER = "00000000-0000-0000-0000-0000000000c4";
const MKT = "00000000-0000-0000-0000-0000000000d1";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, email text);
    create table public.platform_settings (key text, value jsonb, description text, scope_type text not null default 'global');
    create schema quizbox_core;
    create function quizbox_core.flag(p_key text, p_scope_type text default 'global', p_scope uuid default null) returns boolean language sql as $$ select coalesce((select value = 'true'::jsonb from public.platform_settings where key = p_key limit 1), false) $$;
    create table public.audit_logs (id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb, created_at timestamptz default now());
    create function quizbox_core.audit(p_action text, p_entity_type text, p_entity uuid, p_details jsonb default '{}') returns void language sql as $$ insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, p_entity_type, p_entity, 'pass', p_details) $$;
    create table public.markets (id uuid primary key, configuration jsonb);
    create table public.profiles (id uuid primary key, full_name text, email text, role text, status text default 'active', country text, school_name text, default_market_id uuid, primary_market_id uuid, onboarding_completed_at timestamptz);
    create table public.student_profiles (id uuid primary key default gen_random_uuid(), user_id uuid unique, grade text, grade_code text, education_level text, school_name text, country text, status text, managed_by uuid, is_minor boolean default false, archived_at timestamptz, subjects text[]);
    create table public.account_relationships (
      id uuid primary key default gen_random_uuid(),
      source_user_id uuid not null references public.profiles(id), target_user_id uuid not null references public.profiles(id),
      relationship_type text not null check (relationship_type in ('guardian','sponsor','institutional')),
      status text not null default 'requested' check (status in ('requested','pending_verification','active','suspended','revoked')),
      can_fund boolean not null default false, can_view_progress boolean not null default false, can_manage_account boolean not null default false,
      consent_status text not null default 'pending' check (consent_status in ('not_required','pending','granted','withdrawn')),
      verified_by uuid, verified_at timestamptz, valid_from timestamptz not null default now(), valid_until timestamptz,
      created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      check (source_user_id <> target_user_id), check (valid_until is null or valid_until > valid_from), check (status <> 'active' or verified_by is not null)
    );
    create table public.wallets (user_id uuid primary key, purchased_balance bigint not null default 0, promotional_balance bigint not null default 0);
    create table public.learner_subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid, plan text, status text default 'active', valid_until timestamptz, source_ref text unique);
    create table public.payment_intents (id uuid primary key default gen_random_uuid(), reference text unique not null default ('QB-' || replace(gen_random_uuid()::text, '-', '')), payer_user_id uuid, beneficiary_user_id uuid, provider text, currency_code text, amount_minor bigint, coins bigint, status text default 'initiated', provider_reference text, credited boolean default false, metadata jsonb default '{}', unique (payer_user_id, reference));
    create table public.payment_events (id uuid primary key default gen_random_uuid(), provider text, provider_event_id text, reference text, reported_status text, signature_verified boolean, payload jsonb, outcome text, unique (provider, provider_event_id));
    -- stand-ins for the existing payment functions (same rules, simplified)
    create function public.qb_payment_intent_create(p_beneficiary uuid, p_coins bigint, p_currency text, p_provider text, p_method text, p_idem text) returns jsonb language plpgsql as $$
    declare i public.payment_intents;
    begin
      if p_coins * 100 < 500 then raise exception 'QB_BELOW_MINIMUM_CHARGE'; end if;
      if not quizbox_core.relationship_allows(auth.uid(), p_beneficiary, 'can_fund') then raise exception 'QB_FUNDING_NOT_PERMITTED'; end if;
      insert into public.payment_intents(payer_user_id, beneficiary_user_id, provider, currency_code, amount_minor, coins) values (auth.uid(), p_beneficiary, p_provider, p_currency, p_coins * 100, p_coins) returning * into i;
      return jsonb_build_object('reference', i.reference, 'amount_minor', i.amount_minor);
    end $$;
    create function quizbox_core.relationship_allows(p_source uuid, p_target uuid, p_perm text) returns boolean language sql as $$ select exists (select 1 from public.account_relationships r where r.source_user_id = p_source and r.target_user_id = p_target and r.status = 'active' and r.can_fund) $$;
    create function public.qb_payment_apply_event(p_provider text, p_event_id text, p_reference text, p_status text, p_provider_reference text, p_amount_minor bigint, p_currency text, p_verified boolean, p_payload jsonb default '{}') returns jsonb language plpgsql as $$
    declare i public.payment_intents; ev uuid;
    begin
      insert into public.payment_events(provider, provider_event_id, reference, reported_status, signature_verified, payload) values (p_provider, p_event_id, p_reference, p_status, p_verified, p_payload) on conflict do nothing returning id into ev;
      if ev is null then return jsonb_build_object('outcome', 'duplicate_event'); end if;
      select * into i from public.payment_intents where reference = p_reference for update;
      if i.id is null then return jsonb_build_object('outcome', 'unknown_reference'); end if;
      if p_status = 'successful' then
        if i.credited then return jsonb_build_object('outcome', 'already_settled'); end if;
        if p_amount_minor is distinct from i.amount_minor then return jsonb_build_object('outcome', 'amount_mismatch'); end if;
        insert into public.wallets(user_id, purchased_balance) values (i.beneficiary_user_id, i.coins) on conflict (user_id) do update set purchased_balance = public.wallets.purchased_balance + i.coins;
        update public.payment_intents set status = 'successful', credited = true, provider_reference = p_provider_reference where id = i.id;
        return jsonb_build_object('outcome', 'credited');
      elsif p_status in ('refunded', 'reversed') then
        if i.credited then update public.wallets set purchased_balance = purchased_balance - i.coins where user_id = i.beneficiary_user_id; update public.payment_intents set status = p_status where id = i.id; end if;
        return jsonb_build_object('outcome', p_status);
      end if;
      update public.payment_intents set status = p_status where id = i.id and status = 'initiated';
      return jsonb_build_object('outcome', 'status_updated');
    end $$;
    create function public.qb_set_payment_plan(p_reference text, p_plan text, p_days integer) returns void language sql as $$ update public.payment_intents set metadata = metadata || jsonb_build_object('plan', p_plan, 'days', p_days, 'purpose', 'subscription') where reference = p_reference $$;
    create function public.qb_fulfil_subscription_payment(p_reference text) returns jsonb language plpgsql as $$
    declare i public.payment_intents;
    begin
      select * into i from public.payment_intents where reference = p_reference;
      if i.metadata ->> 'purpose' is distinct from 'subscription' then return jsonb_build_object('outcome', 'not_a_subscription'); end if;
      insert into public.learner_subscriptions(user_id, plan, valid_until, source_ref) values (i.beneficiary_user_id, i.metadata ->> 'plan', now() + make_interval(days => (i.metadata ->> 'days')::int), p_reference) on conflict (source_ref) do nothing;
      return jsonb_build_object('outcome', 'fulfilled');
    end $$;
    create function public.qb_revoke_subscription_payment(p_reference text, p_reason text) returns jsonb language sql as $$ update public.learner_subscriptions set status = 'revoked' where source_ref = p_reference returning jsonb_build_object('outcome', 'revoked') $$;
    insert into public.markets values ('${MKT}', '{}');
    insert into public.profiles(id, full_name, email, role, country, primary_market_id) values
      ('${A}', 'John Mensah', 'john@x.test', 'teacher', 'Ghana', '${MKT}'), ('${B}', 'Efua Boateng', 'efua@x.test', 'sponsor', 'Ghana', '${MKT}'),
      ('${AMA}', 'Ama Mensah', 'ama@x.test', 'student', 'Ghana', '${MKT}'), ('${KOJO}', 'Kojo Mensah', 'kojo@x.test', 'student', 'Ghana', '${MKT}'), ('${SENA}', 'Sena Boateng', 's@x.test', 'student', 'Ghana', '${MKT}'), ('${OTHER}', 'Other', 'o@x.test', 'student', 'Ghana', '${MKT}');
  `);
  for (const m of MIGS) await db.exec(readFileSync(m, "utf8"));
  await db.exec(`update public.platform_settings set value = 'true'::jsonb where key = 'flags.family_workspace'`);
  const attach = (p: string, s: string, t = "parent") => db.exec(`select public.qb_family_attach_child('${p}', '${s}', '${t}')`);
  await attach(A, AMA); await attach(A, KOJO); await attach(B, SENA, "academic_parent"); await attach(B, OTHER, "mentor");
  return db;
}
const as = (db: PGlite, uid: string | null) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false)`);
const one = async (db: PGlite, sql: string) => (await db.query<{ r: any }>(sql)).rows[0].r;
const create = (db: PGlite, kind: string, items: Array<[string, number]>, idem = "idem-12345678") =>
  one(db, `select public.qb_family_order_create('${kind}', '${JSON.stringify(items.map(([s, c]) => ({ student_id: s, coins: c })))}'::jsonb, '${idem}') as r`);
const pay = (db: PGlite, ref: string, amount: number, ev = "charge.success:1", status = "successful") => one(db, `select public.qb_family_order_apply('paystack', '${ev}', '${ref}', '${status}', 'ps-1', ${amount}, 'GHS', '{}'::jsonb) as r`);
const coins = async (db: PGlite, id: string) => Number((await db.query<{ n: string }>(`select coalesce((select purchased_balance from public.wallets where user_id = '${id}'), 0) as n`)).rows[0].n);

describe("buy coins for ticked children in one checkout", () => {
  it("creates one order with one intent per child and the right total", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "coins", [[AMA, 10], [KOJO, 20]]);
    expect(o).toMatchObject({ kind: "coins", status: "initiated", total_minor: 3000 }); expect(o.reference).toMatch(/^QBF-[0-9a-f]{32}$/);
    expect(o.items.map((i: any) => [i.name, i.coins, i.amount_minor])).toEqual([["Ama Mensah", 10, 1000], ["Kojo Mensah", 20, 2000]]);
    expect((await db.query("select 1 from public.payment_intents")).rows).toHaveLength(2);
    expect(await coins(db, AMA)).toBe(0);
  });
  it("credits every ticked child exactly once after one verified payment, and nobody else", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "coins", [[AMA, 10], [KOJO, 20]]);
    expect(await pay(db, o.reference, 3000)).toEqual({ outcome: "credited" });
    expect([await coins(db, AMA), await coins(db, KOJO), await coins(db, SENA)]).toEqual([10, 20, 0]);
    expect((await one(db, `select public.qb_family_order_get('${o.reference}') as r`)).status).toBe("paid");
  });
  it("a replayed webhook does not credit twice (same event, and a new event for the same order)", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "coins", [[AMA, 10], [KOJO, 20]]);
    await pay(db, o.reference, 3000);
    expect(await pay(db, o.reference, 3000)).toEqual({ outcome: "duplicate_event" });
    expect(await pay(db, o.reference, 3000, "charge.success:2")).toEqual({ outcome: "already_settled" });
    expect([await coins(db, AMA), await coins(db, KOJO)]).toEqual([10, 20]);
  });
  it("a payment for the wrong amount credits nobody", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "coins", [[AMA, 10], [KOJO, 20]]);
    expect(await pay(db, o.reference, 1000)).toEqual({ outcome: "amount_mismatch" });
    expect([await coins(db, AMA), await coins(db, KOJO)]).toEqual([0, 0]);
    expect((await one(db, `select public.qb_family_order_get('${o.reference}') as r`)).status).toBe("mismatch");
  });
  it("is all or nothing: if one child cannot be credited, no child is", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "coins", [[AMA, 10], [KOJO, 20]]);
    await db.exec(`update public.payment_intents set amount_minor = 999 where reference = (select intent_reference from public.family_order_items where position = 2)`);
    await expect(pay(db, o.reference, 3000)).rejects.toThrow(/QB_ORDER_ITEM_amount_mismatch/);
    expect([await coins(db, AMA), await coins(db, KOJO)]).toEqual([0, 0]);
    expect((await db.query("select 1 from public.payment_events where reference = '" + o.reference + "'")).rows).toHaveLength(0);
  });
  it("a repeated order with the same key returns the same order, not a second charge", async () => {
    const db = await setup(); await as(db, A);
    const a = await create(db, "coins", [[AMA, 10]]), b = await create(db, "coins", [[AMA, 10]]);
    expect(b.reference).toBe(a.reference);
    expect((await db.query("select 1 from public.payment_intents")).rows).toHaveLength(1);
  });
  it("a failed charge marks the order failed and credits nobody", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "coins", [[AMA, 10]]);
    await pay(db, o.reference, 0, "charge.failed:9", "failed");
    expect((await one(db, `select public.qb_family_order_get('${o.reference}') as r`)).status).toBe("failed"); expect(await coins(db, AMA)).toBe(0);
  });
  it("a refund takes the coins back from every child", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "coins", [[AMA, 10], [KOJO, 20]]); await pay(db, o.reference, 3000);
    expect(await pay(db, o.reference, 3000, "refund.processed:5", "refunded")).toEqual({ outcome: "refunded" });
    expect([await coins(db, AMA), await coins(db, KOJO)]).toEqual([0, 0]);
  });
});

describe("authorisation", () => {
  it("refuses a child who is not yours, one you may not buy for, a duplicate child, bad amounts, and a signed-out caller", async () => {
    const db = await setup(); await as(db, A);
    await expect(create(db, "coins", [[SENA, 10]], "idem-aaaaaaaa")).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await expect(create(db, "coins", [[AMA, 10], [AMA, 5]], "idem-bbbbbbbb")).rejects.toThrow(/QB_FAMILY_INVALID/);
    await expect(create(db, "coins", [[AMA, 0]], "idem-cccccccc")).rejects.toThrow(/QB_FAMILY_INVALID/);
    await expect(create(db, "coins", [[AMA, 1001]], "idem-dddddddd")).rejects.toThrow(/QB_FAMILY_INVALID/);
    await expect(create(db, "coins", [[AMA, 2]], "idem-eeeeeeee")).rejects.toThrow(/QB_BELOW_MINIMUM_CHARGE/);
    await as(db, B); await expect(create(db, "subscription", [[OTHER, 10]], "idem-ffffffff")).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    await as(db, null); await expect(create(db, "coins", [[AMA, 10]], "idem-gggggggg")).rejects.toThrow(/QB_AUTH_REQUIRED/);
    expect((await db.query("select 1 from public.family_orders")).rows).toHaveLength(0);
  });
  it("a parent cannot read another parent's order or wallets", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "coins", [[AMA, 10]]);
    await as(db, B);
    await expect(db.query(`select public.qb_family_order_get('${o.reference}')`)).rejects.toThrow(/QB_FAMILY_FORBIDDEN/);
    expect(await one(db, "select public.qb_family_orders() as r")).toEqual([]);
    expect((await one(db, "select public.qb_family_wallets() as r")).map((w: any) => w.name)).toEqual(["Other", "Sena Boateng"]);
  });
  it("the settlement functions are for the server only", async () => {
    const db = await setup();
    const can = async (fn: string, role = "authenticated") => (await one(db, `select has_function_privilege('${role}', '${fn}', 'execute') as r`)) as boolean;
    for (const f of ["qb_family_order_apply(text, text, text, text, text, bigint, text, jsonb)", "qb_family_order_fulfil(text)", "qb_family_order_revoke(text, text)"]) expect(await can(`public.${f}`)).toBe(false);
    for (const f of ["qb_family_order_create(text, jsonb, text)", "qb_family_order_get(text)", "qb_family_orders()", "qb_family_wallets()"]) { expect(await can(`public.${f}`)).toBe(true); expect(await can(`public.${f}`, "anon")).toBe(false); }
  });
});

describe("subscriptions for ticked children", () => {
  it("each child gets their own subscription from one payment, with their own plan and days", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "subscription", [[AMA, 10], [KOJO, 25]]);
    await db.exec(`select public.qb_set_payment_plan('${o.items[0].reference}', 'plan_monthly', 30), public.qb_set_payment_plan('${o.items[1].reference}', 'plan_term', 90)`);
    await pay(db, o.reference, 3500);
    expect(await one(db, `select public.qb_family_order_fulfil('${o.reference}') as r`)).toEqual({ outcome: "fulfilled" });
    const subs = (await db.query<any>("select user_id, plan from public.learner_subscriptions order by plan")).rows;
    expect(subs).toEqual([{ user_id: AMA, plan: "plan_monthly" }, { user_id: KOJO, plan: "plan_term" }]);
    expect(await one(db, `select public.qb_family_order_fulfil('${o.reference}') as r`)).toEqual({ outcome: "fulfilled" });
    expect((await db.query("select 1 from public.learner_subscriptions")).rows).toHaveLength(2);
  });
  it("nothing is granted before the payment is verified, and revoking takes every child's subscription back", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "subscription", [[AMA, 10], [KOJO, 10]]);
    await db.exec(`select public.qb_set_payment_plan('${o.items[0].reference}', 'plan_monthly', 30), public.qb_set_payment_plan('${o.items[1].reference}', 'plan_monthly', 30)`);
    expect(await one(db, `select public.qb_family_order_fulfil('${o.reference}') as r`)).toEqual({ outcome: "not_settled" });
    await pay(db, o.reference, 2000); await db.exec(`select public.qb_family_order_fulfil('${o.reference}')`);
    await db.exec(`select public.qb_family_order_revoke('${o.reference}', 'refunded')`);
    expect((await db.query("select 1 from public.learner_subscriptions where status = 'active'")).rows).toHaveLength(0);
  });
  it("the wallets view shows each child's coins and plan to a parent who may follow them", async () => {
    const db = await setup(); await as(db, A);
    const o = await create(db, "subscription", [[AMA, 10]]);
    await db.exec(`select public.qb_set_payment_plan('${o.items[0].reference}', 'plan_monthly', 30)`); await pay(db, o.reference, 1000); await db.exec(`select public.qb_family_order_fulfil('${o.reference}')`);
    const w = await one(db, "select public.qb_family_wallets() as r");
    expect(w.map((x: any) => [x.name, Number(x.coins), x.plan])).toEqual([["Ama Mensah", 10, "plan_monthly"], ["Kojo Mensah", 0, null]]);
    await db.exec(`select public.qb_family_revoke('${KOJO}')`);
    expect((await one(db, "select public.qb_family_wallets() as r")).map((x: any) => x.name)).toEqual(["Ama Mensah"]);
  });
});
