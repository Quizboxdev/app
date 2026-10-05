import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Provenance: quizbox.ransford.eddy.mensah. Isolated in-memory PostgreSQL; no hosted calls.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ADMIN, FIN, GUARDIAN, WARD, SPONSOR, STRANGER, TEACHER] = [1, 2, 3, 4, 5, 6, 7].map(id);
let db: PGlite;
let counter = 0;
const as = (user: string) => db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
const q = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await q(sql, params)) ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], code: string) => {
  await db.exec("savepoint s");
  try { await db.query(sql, params); } catch (e) { await db.exec("rollback to savepoint s"); expect(String((e as Error).message)).toContain(code); return; }
  await db.exec("release savepoint s"); throw new Error(`expected ${code}`);
};
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
  await db.exec(readFileSync(new URL("../../supabase/migrations/20261007100000_core_platform_foundation.sql", import.meta.url), "utf8"));
  await db.exec(`insert into public.user_capabilities values('${FIN}','finance_admin')`);
  await as(ADMIN);
  await setting("flags.buy_coins_enabled", true);
  await setting("payments.providers", ["testpay"]);
  await setting("coins.unit_price_minor", { GHS: 100 });
  await db.exec("begin"); // one transaction so expected failures can roll back to a savepoint
});
afterAll(async () => { await db.close(); });

describe("roles and workspace switching", () => {
  it("derives multiple roles from one identity and refuses roles not held", async () => {
    await as(FIN);
    expect((await rpc("select public.qb_my_roles()")).roles).toEqual(expect.arrayContaining(["student", "finance_admin", "content_manager"]));
    await rpc("select public.qb_switch_workspace('finance_admin',null,'admin')");
    expect(await q("select active_role,last_app from public.user_workspace_context where user_id=$1", [FIN])).toEqual({ active_role: "finance_admin", last_app: "admin" });
    await fails("select public.qb_switch_workspace('super_admin')", [], "QB_ROLE_NOT_HELD");
    await fails("select public.qb_switch_workspace('student',$1)", [id(99)], "QB_NOT_A_MEMBER");
  });
  it("capability list accepts new roles but rejects unknown ones", async () => {
    await fails("insert into public.user_capabilities values($1,'wizard')", [WARD], "user_capabilities_capability_check");
  });
});

describe("relationships: consent, verification and permission boundaries", () => {
  it("a request grants nothing until staff verify and consent exists; funding is separate from progress visibility", async () => {
    await as(SPONSOR);
    const rel = await rpc("select public.qb_relationship_request($1,'sponsor',true,false)", [WARD]);
    expect(rel.status).toBe("pending_verification");
    expect(await rpc("select public.qb_relationship_allows($1,'can_fund')", [WARD])).toBe(false);
    await fails("select public.qb_relationship_decide($1,'verify')", [rel.id], "QB_FORBIDDEN");
    await as(ADMIN);
    await fails("select public.qb_relationship_decide($1,'verify')", [rel.id], "QB_CONSENT_REQUIRED");
    await as(WARD);
    await rpc("select public.qb_relationship_decide($1,'consent')", [rel.id]);
    await as(ADMIN);
    await rpc("select public.qb_relationship_decide($1,'verify')", [rel.id]);
    await as(SPONSOR);
    expect(await rpc("select public.qb_relationship_allows($1,'can_fund')", [WARD])).toBe(true);
    expect(await rpc("select public.qb_relationship_allows($1,'can_view_progress')", [WARD])).toBe(false);
    expect(await rpc("select public.qb_relationship_allows($1,'can_manage_account')", [WARD])).toBe(false);
    expect(await rpc("select public.qb_relationship_allows($1,'can_fund')", [STRANGER])).toBe(false);
  });
  it("withdrawn consent suspends the link; revoke is terminal and audited", async () => {
    await as(WARD);
    const rel = await q("select id from public.account_relationships where source_user_id=$1", [SPONSOR]);
    await rpc("select public.qb_relationship_decide($1,'withdraw')", [rel.id]);
    await as(SPONSOR);
    expect(await rpc("select public.qb_relationship_allows($1,'can_fund')", [WARD])).toBe(false);
    await as(WARD);
    await rpc("select public.qb_relationship_decide($1,'revoke')", [rel.id]);
    await fails("select public.qb_relationship_decide($1,'revoke')", [rel.id], "QB_INVALID_TRANSITION");
    expect((await q("select count(*)::int n from public.audit_logs where action like 'relationship.%'")).n).toBeGreaterThanOrEqual(4);
  });
  it("a guardian link activates under staff verification and cannot manage the account by default", async () => {
    await as(GUARDIAN);
    const rel = await rpc("select public.qb_relationship_request($1,'guardian',true,true)", [WARD]);
    await as(STRANGER);
    await fails("select public.qb_relationship_decide($1,'verify')", [rel.id], "QB_FORBIDDEN");
    await as(ADMIN);
    await rpc("select public.qb_relationship_decide($1,'verify')", [rel.id]);
    await as(GUARDIAN);
    expect(await rpc("select public.qb_relationship_allows($1,'can_fund')", [WARD])).toBe(true);
    expect(await rpc("select public.qb_relationship_allows($1,'can_view_progress')", [WARD])).toBe(true);
    expect(await rpc("select public.qb_relationship_allows($1,'can_manage_account')", [WARD])).toBe(false);
    expect((await rpc("select public.qb_my_roles()")).roles).toContain("parent_guardian");
  });
});

describe("payments: payer vs beneficiary, idempotency, wallet credit", () => {
  it("refuses unlinked payers, self-pay while disabled and unlisted providers", async () => {
    await as(STRANGER);
    await fails("select public.qb_payment_intent_create($1,10,'GHS','testpay','card','idem-stranger')", [WARD], "QB_FUNDING_NOT_PERMITTED");
    await as(WARD);
    await fails("select public.qb_payment_intent_create($1,10,'GHS','testpay','card','idem-self-pay')", [WARD], "QB_SELF_PAY_DISABLED");
    await as(GUARDIAN);
    await fails("select public.qb_payment_intent_create($1,10,'GHS','unlisted','card','idem-prov-1')", [WARD], "QB_PROVIDER_NOT_ENABLED");
  });
  it("credits the beneficiary (not the payer) exactly once across duplicate events and replayed settlement", async () => {
    const i = await intent(GUARDIAN, WARD, 10, "idem-fund-001");
    expect(Number(i.amount_minor)).toBe(1000);
    expect((await intent(GUARDIAN, WARD, 10, "idem-fund-001")).id).toBe(i.id);
    await fails("select public.qb_payment_intent_create($1,11,'GHS','testpay','card','idem-fund-001')", [WARD], "QB_IDEMPOTENCY_CONFLICT");

    expect((await event(i.reference, "successful", { event: "evt-a", verified: false })).outcome).toBe("rejected_unverified");
    expect((await q("select count(*)::int n from public.wallets")).n).toBe(0);
    expect((await event(i.reference, "successful", { event: "evt-b", amount: 999 })).outcome).toBe("amount_mismatch");
    expect((await q("select reconciliation_status from public.payment_intents where id=$1", [i.id])).reconciliation_status).toBe("mismatch");
    expect((await event(i.reference, "successful", { event: "evt-c" })).outcome).toBe("credited");
    expect((await event(i.reference, "successful", { event: "evt-c" })).outcome).toBe("duplicate_event");
    expect((await event(i.reference, "successful", { event: "evt-d" })).outcome).toBe("already_settled");
    expect((await event(i.reference, "failed", { event: "evt-e" })).outcome).toBe("ignored_after_settlement");

    expect((await q("select purchased_balance::int b from public.wallets where user_id=$1", [WARD])).b).toBe(10);
    expect((await q("select count(*)::int n from public.wallets where user_id=$1", [GUARDIAN])).n).toBe(0);
    expect((await q("select count(*)::int n from public.coin_transactions")).n).toBe(1);
  });
  it("lets one provider reference belong to only one intent", async () => {
    const a = await intent(GUARDIAN, WARD, 5, "idem-fund-002");
    await event(a.reference, "pending", { providerRef: "shared-ref" });
    const b = await intent(GUARDIAN, WARD, 5, "idem-fund-003");
    await fails("select public.qb_payment_apply_event('testpay','evt-shared',$1,'pending','shared-ref',500,'GHS',true)", [b.reference], "payment_intents_provider_ref");
  });
  it("reverses a credit, and sends an unaffordable reversal to manual review instead of going negative", async () => {
    const i = await q("select * from public.payment_intents where idempotency_key='idem-fund-001'");
    expect((await event(i.reference, "refunded")).outcome).toBe("refunded");
    expect((await q("select purchased_balance::int b from public.wallets where user_id=$1", [WARD])).b).toBe(0);
    const j = await intent(GUARDIAN, WARD, 4, "idem-fund-004");
    await event(j.reference, "successful", { amount: 400 });
    await as(ADMIN);
    await rpc("select public.qb_wallet_adjust($1,'purchased',-3,'Test spend simulation','adj-0000001')", [WARD]);
    expect((await event(j.reference, "reversed")).outcome).toBe("insufficient_balance_manual_review");
    expect(await q("select status,reconciliation_status from public.payment_intents where id=$1", [j.id])).toEqual({ status: "successful", reconciliation_status: "manual_review" });
  });
  it("keeps the ledger immutable and balances non-negative", async () => {
    await fails("update public.coin_transactions set amount=1", [], "QB_IMMUTABLE_HISTORY");
    await fails("delete from public.coin_transactions", [], "QB_IMMUTABLE_HISTORY");
    await as(ADMIN);
    await fails("select public.qb_wallet_adjust($1,'promotional',-1,'Overdraw attempt','adj-0000002')", [WARD], "QB_INSUFFICIENT_BALANCE");
    await fails("select public.qb_wallet_adjust($1,'promotional',5,'x','adj-0000003')", [WARD], "QB_REASON_REQUIRED");
  });
  it("restricts manual adjustment to finance/super admin", async () => {
    await as(TEACHER);
    await fails("select public.qb_wallet_adjust($1,'promotional',5,'Not allowed here','adj-0000004')", [WARD], "QB_FORBIDDEN");
    await as(FIN);
    expect((await rpc("select public.qb_wallet_adjust($1,'promotional',5,'Goodwill credit','adj-0000005')", [WARD])).bucket).toBe("promotional");
  });
});

describe("learner progress authorization (existing progress RPCs, one shared predicate)", () => {
  const insights = (viewer: string, learner: string) => as(viewer).then(() => rpc("select public.qb_student_insights($1)", [learner]));
  const denied = (viewer: string, learner: string, sql = "select public.qb_student_insights($1)") => as(viewer).then(() => fails(sql, [learner], "NOT_AUTHORIZED"));
  const guardianRel = () => q("select id from public.account_relationships where source_user_id=$1 and target_user_id=$2 and relationship_type='guardian'", [GUARDIAN, WARD]);

  it("lets a learner see themselves (zero-argument call unchanged) and a verified guardian with can_view_progress see the ward", async () => {
    await as(WARD);
    expect((await rpc("select public.qb_student_insights()")).learner).toBe(WARD);
    expect((await insights(GUARDIAN, WARD)).learner).toBe(WARD);
    expect((await rpc("select public.qb_student_achievements($1)", [WARD])).learner).toBe(WARD);
  });
  it("denies unrelated users and teachers without a relationship", async () => {
    await denied(STRANGER, WARD);
    await denied(TEACHER, WARD);
    await denied(STRANGER, WARD, "select public.qb_student_achievements($1)");
  });
  it("denies a sponsor whose link carries funding only", async () => {
    await as(SPONSOR);
    const rel = await rpc("select public.qb_relationship_request($1,'sponsor',true,false)", [WARD]);
    await as(WARD); await rpc("select public.qb_relationship_decide($1,'consent')", [rel.id]);
    await as(ADMIN); await rpc("select public.qb_relationship_decide($1,'verify')", [rel.id]);
    await as(SPONSOR);
    expect(await rpc("select public.qb_relationship_allows($1,'can_fund')", [WARD])).toBe(true);
    await denied(SPONSOR, WARD);
    await denied(SPONSOR, WARD, "select public.qb_student_achievements($1)");
  });
  it("denies a guardian whose relationship is suspended, withdrawn or has lost can_view_progress, and restores on reinstatement", async () => {
    const rel = await guardianRel();
    await as(ADMIN); await rpc("select public.qb_relationship_decide($1,'suspend')", [rel.id]);
    await denied(GUARDIAN, WARD);
    await as(ADMIN); await rpc("select public.qb_relationship_decide($1,'reinstate')", [rel.id]);
    expect((await insights(GUARDIAN, WARD)).learner).toBe(WARD);
    await as(ADMIN); await rpc("select public.qb_consent_set($1,'withdrawn')", [WARD]);
    await denied(GUARDIAN, WARD);
    await as(ADMIN); await rpc("select public.qb_consent_set($1,'not_required')", [WARD]);
    await db.query("update public.account_relationships set can_view_progress=false where id=$1", [rel.id]);
    await denied(GUARDIAN, WARD);
    await db.query("update public.account_relationships set can_view_progress=true where id=$1", [rel.id]);
    expect((await insights(GUARDIAN, WARD)).learner).toBe(WARD);
  });
  it("keeps Super Admin access and requires authentication", async () => {
    expect((await insights(ADMIN, WARD)).learner).toBe(WARD);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await fails("select public.qb_student_insights($1)", [WARD], "NOT_AUTHORIZED");
  });
});

describe("Coin spend primitive", () => {
  const spend = (amount: number, idem: string, ref = "order-x", ent: unknown = null, user = STRANGER) =>
    rpc("select public.qb_coin_spend($1,$2,'marketplace purchase',$3,$4,$5::jsonb)", [user, amount, ref, idem, ent ? JSON.stringify(ent) : null]);
  const balances = () => q("select purchased_balance::int p, promotional_balance::int r from public.wallets where user_id=$1", [STRANGER]);

  it("is unavailable to client roles", async () => {
    await db.exec("set role authenticated");
    await as(STRANGER);
    await fails("select public.qb_coin_spend($1,1,'marketplace purchase','o','spend-denied-1')", [STRANGER], "permission denied");
    await db.exec("reset role");
  });
  it("spends promotional Coins first, then purchased, atomically", async () => {
    await as(FIN);
    await rpc("select public.qb_wallet_adjust($1,'promotional',5,'Seed promo','seed-promo-01')", [STRANGER]);
    await rpc("select public.qb_wallet_adjust($1,'purchased',10,'Seed purchase','seed-purch-01')", [STRANGER]);
    await db.exec("set role service_role");
    const r = await spend(7, "spend-0000001", "order-1", { kind: "challenge_entry" });
    await db.exec("reset role");
    expect(r).toMatchObject({ spent: 7, duplicate: false, split: { promotional: 5, purchased: 2 } });
    expect(r.entitlement_id).toBeTruthy();
    expect(await balances()).toEqual({ p: 8, r: 0 });
    const rows = (await db.query<Record<string, any>>("select bucket,amount::int a,metadata from public.coin_transactions where kind='spend' order by bucket")).rows;
    expect(rows.map((x) => [x.bucket, x.a])).toEqual([["promotional", -5], ["purchased", -2]]);
    expect(rows[0].metadata.ref).toBe("order-1");
    expect((await q("select count(*)::int n from public.audit_logs where action='coins.spend'")).n).toBe(1);
  });
  it("is idempotent, rejects a changed amount under the same key, and fulfils an order reference once", async () => {
    await db.exec("set role service_role");
    expect((await spend(7, "spend-0000001", "order-1", { kind: "challenge_entry" })).duplicate).toBe(true);
    await fails("select public.qb_coin_spend($1,3,'marketplace purchase','order-1','spend-0000001')", [STRANGER], "QB_IDEMPOTENCY_CONFLICT");
    await fails("select public.qb_coin_spend($1,1,'marketplace purchase','order-1','spend-0000002','{\"kind\":\"challenge_entry\"}')", [STRANGER], "QB_ORDER_ALREADY_FULFILLED");
    await db.exec("reset role");
    expect(await balances()).toEqual({ p: 8, r: 0 });
  });
  it("never overdraws and leaves balances and ledger untouched on failure", async () => {
    const before = (await q("select count(*)::int n from public.coin_transactions")).n;
    await db.exec("set role service_role");
    await fails("select public.qb_coin_spend($1,9,'marketplace purchase','order-2','spend-0000003')", [STRANGER], "QB_INSUFFICIENT_BALANCE");
    await fails("select public.qb_coin_spend($1,0,'marketplace purchase','order-2','spend-0000004')", [STRANGER], "QB_INVALID_AMOUNT");
    await fails("select public.qb_coin_spend($1,1,'marketplace purchase','order-2','spend-0000005')", [FIN], "QB_INSUFFICIENT_BALANCE"); // no wallet
    await db.exec("reset role");
    expect(await balances()).toEqual({ p: 8, r: 0 });
    expect((await q("select count(*)::int n from public.coin_transactions")).n).toBe(before);
    await fails("update public.coin_transactions set amount=-1 where kind='spend'", [], "QB_IMMUTABLE_HISTORY");
  });
});

describe("catalogue security checks (mirrors what release:verify-security must see on a real branch)", () => {
  const NEW_TABLES = ["platform_settings", "account_relationships", "user_workspace_context", "wallets", "coin_transactions", "access_entitlements", "payment_intents", "payment_events",
    "qpoint_transactions", "badge_definitions", "user_badges", "user_streaks", "learner_consent"];
  const SERVER_ONLY = ["qb_payment_apply_event", "qb_qpoints_award", "qb_coin_spend"];
  it("enables RLS on every new table and grants clients select only", async () => {
    const rows = (await db.query<Record<string, any>>("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname = any($1)", [NEW_TABLES])).rows;
    expect(rows).toHaveLength(NEW_TABLES.length);
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
    const writes = (await db.query<Record<string, any>>("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','PUBLIC') and table_name = any($1) and privilege_type<>'SELECT'", [NEW_TABLES])).rows;
    expect(writes).toEqual([]);
    expect((await db.query<Record<string, any>>("select table_name from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name = any($1)", [NEW_TABLES])).rows).toEqual([]);
  });
  it("pins search_path on every function the migration created and keeps anon out", async () => {
    const fns = (await db.query<Record<string, any>>(`select p.oid::regprocedure::text sig,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon,
        has_function_privilege('authenticated',p.oid,'execute') auth_exec,has_function_privilege('service_role',p.oid,'execute') svc
      from pg_proc p where p.pronamespace in ('quizbox_core'::regnamespace) or p.proname in ('qb_setting_set','qb_relationship_allows','qb_relationship_request','qb_relationship_decide','qb_my_roles','qb_switch_workspace',
       'qb_wallet_adjust','qb_coin_spend','qb_payment_intent_create','qb_payment_apply_event','qb_payment_reconcile','qb_qpoints_award','qb_consent_set','qb_feature_allowed')`)).rows;
    expect(fns.length).toBeGreaterThan(20);
    for (const f of fns) {
      if (f.prosecdef) expect((f.proconfig ?? []).some((c: string) => c.startsWith("search_path=")), f.sig).toBe(true);
      expect(f.anon, `${f.sig} anon`).toBe(false);
    }
    for (const f of fns.filter((x) => SERVER_ONLY.includes(x.proname))) { expect(f.auth_exec, f.sig).toBe(false); expect(f.svc, f.sig).toBe(true); }
    const internal = fns.filter((x) => x.sig.startsWith("quizbox_core.") && !["quizbox_core.is_staff(text[])", "quizbox_core.can_view_progress(uuid,uuid)"].includes(x.sig));
    expect(internal.filter((x) => x.auth_exec).map((x) => x.sig)).toEqual([]);
  });
  it("ships safe payment defaults: buying and self-pay off, no providers, no pricing", async () => {
    const get = async (k: string) => (await q("select value from public.platform_settings where key=$1 and scope_type='global'", [k])).value;
    // The test file enabled buying for its own scenarios; assert the migration seed itself via audit of the SQL text.
    const sql = readFileSync(new URL("../../supabase/migrations/20261007100000_core_platform_foundation.sql", import.meta.url), "utf8");
    expect(sql).toContain("('flags.buy_coins_enabled','false'");
    expect(sql).toContain("('flags.student_self_pay','false'");
    expect(sql).toContain("('payments.providers','[]'");
    expect(sql).toContain("('coins.unit_price_minor','{}'");
    expect(await get("flags.student_self_pay")).toBe(false);
  });
});

describe("grants, QPoints and consent", () => {
  it("blocks clients from settlement/awards and wallet writes; keeps Coins and QPoints apart", async () => {
    await db.exec("set role authenticated");
    await as(GUARDIAN);
    await fails("select public.qb_payment_apply_event('testpay','evt-x','QB-x','successful','p',1,'GHS',true)", [], "permission denied");
    await fails("select public.qb_qpoints_award($1,'daily','qp-0000001')", [WARD], "permission denied");
    await fails("insert into public.wallets(user_id,purchased_balance) values($1,999)", [GUARDIAN], "permission denied");
    expect((await db.query("select * from public.wallets")).rows).toHaveLength(0);
    await db.exec("reset role");
    await db.exec("set role service_role");
    expect((await rpc("select public.qb_qpoints_award($1,'daily','qp-0000001')", [WARD])).awarded).toBe(0);
    await db.exec("reset role");
    await as(ADMIN);
    await setting("reward_rules", { daily: { qpoints: 3, enabled: true } });
    await db.exec("set role service_role");
    expect((await rpc("select public.qb_qpoints_award($1,'daily','qp-0000002')", [WARD])).awarded).toBe(3);
    expect((await rpc("select public.qb_qpoints_award($1,'daily','qp-0000002')", [WARD])).duplicate).toBe(true);
    await db.exec("reset role");
    expect((await q("select balance::int b from public.qpoint_balances where user_id=$1", [WARD])).b).toBe(3);
    expect((await q("select (purchased_balance+promotional_balance)::int b from public.wallets where user_id=$1", [WARD])).b).toBe(6);
  });
  it("blocks social/public features while consent is pending, via configuration", async () => {
    await as(GUARDIAN);
    await rpc("select public.qb_consent_set($1,'pending','policy-x')", [WARD]);
    await as(WARD);
    expect(await rpc("select public.qb_feature_allowed('public_leaderboards')")).toBe(false);
    expect(await rpc("select public.qb_feature_allowed('practice')")).toBe(true);
    await as(STRANGER);
    await fails("select public.qb_consent_set($1,'granted')", [WARD], "QB_FORBIDDEN");
    await as(GUARDIAN);
    await rpc("select public.qb_consent_set($1,'granted')", [WARD]);
    await as(WARD);
    expect(await rpc("select public.qb_feature_allowed('public_leaderboards')")).toBe(true);
  });
});
