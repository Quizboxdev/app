import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Affiliates, referral attribution and the commission ledger (isolated PostgreSQL; payments and subscriptions are stubbed because they have their own tests).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261048100000_affiliate_commission_foundation.sql");
const ROLLBACK = read("../../supabase/rollback/affiliate_commission_foundation.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, FIN, AFF, AFF2, PLAIN, CHILD, MANAGED] = [1, 2, 3, 4, 5, 6, 7].map(id);
const BUYERS = Array.from({ length: 14 }, (_, i) => id(100 + i));
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
// The service role (what the payment settlement code uses) and the table owner.
const service = async (sql: string, params: unknown[] = []) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); return rpc(sql, params); };
const sql = async (q: string, params: unknown[] = []) => { await db.exec("reset role"); return (await db.query<Record<string, any>>(q, params)).rows; };
const flag = async (on: boolean) => { await db.exec("reset role"); await db.query("update public.platform_settings set value = $1::jsonb where key = 'flags.affiliates'", [JSON.stringify(on)]); };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, is_minor boolean not null default false, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text not null, type text not null, title text not null, message text,
      link text, category text not null default 'system');
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
    create schema quizbox_private; create table quizbox_private.stub_budget(op text, uid uuid, n integer not null default 0, primary key (op, uid));
    create function quizbox_private.enforce_budget(p_operation text, p_limit integer, p_seconds integer) returns void language plpgsql security definer as $$
      declare c integer; begin
        insert into quizbox_private.stub_budget as b(op, uid, n) values (p_operation, auth.uid(), 1) on conflict (op, uid) do update set n = b.n + 1 returning n into c;
        if c > p_limit then raise exception 'QB_RATE_LIMITED'; end if; end $$;
    grant usage on schema quizbox_private to anon, authenticated, service_role; grant execute on all functions in schema quizbox_private to anon, authenticated, service_role;
    create table public.payment_intents(id uuid primary key default gen_random_uuid(), reference text not null unique, payer_user_id uuid not null, beneficiary_user_id uuid not null, currency_code text not null default 'GHS',
      amount_minor bigint not null, coins bigint not null, status text not null default 'initiated', credited_tx_id uuid, settled_at timestamptz, metadata jsonb not null default '{}');
    create table public.learner_subscriptions(id uuid primary key default gen_random_uuid(), user_id uuid, status text not null default 'active', source text not null default 'payment', source_ref text);
    insert into public.profiles values ('${OWNER}','OWNER','active','Owner','o@example.com'),('${FIN}','ADMIN','active','Finance One','fin@example.com'),('${AFF}','TEACHER','active','Ama Affiliate','aff@example.com'),
      ('${AFF2}','TEACHER','active','Kojo Affiliate','aff2@example.com'),('${PLAIN}','TEACHER','active','Plain Teacher','plain@example.com'),('${CHILD}','STUDENT','active','Child','child@example.com'),('${MANAGED}','STUDENT','active','Managed','managed@example.com');
    insert into public.student_profiles(user_id, is_minor, managed_by) values ('${CHILD}', true, null), ('${MANAGED}', true, '${PLAIN}');
    insert into public.user_capabilities values ('${FIN}', 'finance_admin', true);
  `);
  for (const [i, b] of BUYERS.entries()) await db.query("insert into public.profiles values ($1,'STUDENT','active',$2,$3)", [b, `Buyer ${i}`, `buyer${i}@example.com`]);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

let n = 0;
// A settled Paystack payment: by default a subscription that was granted. Options let a test leave it unsettled, unfulfilled, a Coins purchase, or paid for someone else.
const pay = async (buyer: string, amount = 2500, o: { for?: string; coins?: boolean; unsettled?: boolean; unfulfilled?: boolean; settled?: string } = {}) => {
  const ref = `QB-test${++n}`;
  await db.exec("reset role");
  await db.query("insert into public.payment_intents(reference, payer_user_id, beneficiary_user_id, amount_minor, coins, status, credited_tx_id, settled_at, metadata) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::jsonb)",
    [ref, buyer, o.for ?? buyer, amount, amount / 100, o.unsettled ? "pending" : "successful", o.unsettled ? null : id(900 + n), o.settled ?? new Date().toISOString(), JSON.stringify(o.coins ? {} : { purpose: "subscription", plan: "monthly", days: 30 })]);
  if (!o.coins && !o.unsettled && !o.unfulfilled) await db.query("insert into public.learner_subscriptions(user_id, source, source_ref) values ($1,'payment',$2)", [o.for ?? buyer, ref]);
  return ref;
};
const accrue = (ref: string) => service("select public.qb_commission_accrue($1)", [ref]);
const reverse = (ref: string, why = "refunded") => service("select public.qb_commission_reverse($1,$2)", [ref, why]);
const bal = async (aff: string) => { await as(aff); return (await rpc("select public.qb_affiliate_summary()")).balances as { pending: number; available: number; reserved: number; paid: number }; };
// A policy made and approved by the owner. Anything not given keeps the pilot values from the commercial plan.
const policy = async (o: Partial<{ rates: Record<string, number>; growth: number; amb: number; cap: number; hold: number; window: number; tax: number; purposes: string[] }> = {}) => {
  await as(OWNER);
  const p = await rpc("select public.qb_commission_policy_save($1,$2::jsonb,$3,$4,90,$5,$6,$7,5000,$8,$9::text[],true,'test')",
    ["Test policy", JSON.stringify(o.rates ?? { registered: 10, growth: 12.5, ambassador: 15 }), o.growth ?? 10, o.amb ?? 30, o.cap ?? 15, o.hold ?? 30, o.window ?? 30, o.tax ?? 0, `{${(o.purposes ?? ["subscription"]).join(",")}}`]);
  await rpc("select public.qb_commission_policy_approve($1)", [p.id]);
  return p as { id: string; version: number };
};
const approvedAffiliate = async (user: string, name: string) => {
  await as(user);
  await rpc("select public.qb_affiliate_apply($1,'0244000000',true,true)", [name]);
  await rpc("select public.qb_affiliate_payout_save('mobile_money','MTN','0244000000',$1)", [name]);
  const list = await (async () => { await as(OWNER); return rpc("select public.qb_affiliate_admin_list('applied')"); })();
  const row = list.find((a: any) => a.name === name);
  await rpc("select public.qb_affiliate_decide($1,'approve','',true)", [row.id]);
  await as(user);
  return (await rpc("select public.qb_affiliate_me()")).referral_code as string;
};
const capture = async (buyer: string, code: string) => { await as(buyer); return (await rpc("select public.qb_referral_capture($1,'link','test')", [code])).outcome as string; };

describe("affiliates and the commission ledger", () => {
  it("re-applies cleanly and is closed to every browser role", async () => {
    await db.exec("reset role"); await db.exec(MIGRATION);
    await as(PLAIN);
    for (const t of ["commission_policies", "affiliates", "affiliate_payout_details", "referral_attributions", "commission_accruals", "commission_ledger"]) await fails(`select * from public.${t}`, [], /permission denied/);
    await fails("insert into public.commission_ledger(affiliate_id, kind, bucket, amount_minor) values (gen_random_uuid(),'accrual','available',100000)", [], /permission denied/);   // no one edits a balance by hand
    await fails("select public.qb_commission_accrue('QB-x')", [], /permission denied/);                                                    // only the payment code (service role) can accrue
    await fails("select public.qb_commission_reverse('QB-x','why')", [], /permission denied/);
    await as(null); await fails("select public.qb_affiliate_me()", [], /permission denied/);
  });

  it("is off until the flag is on, and the pilot policy is only a draft, so nothing can accrue on a guess", async () => {
    await as(AFF); await fails("select public.qb_affiliate_apply('Ama Affiliate','0244000000',true,true)", [], /QB_FEATURE_DISABLED/);
    const rows = await sql("select version, status, is_pilot from public.commission_policies");
    expect(rows).toEqual([{ version: 1, status: "draft", is_pilot: true }]);
    await flag(true);
    const ref = await pay(BUYERS[0]);
    expect((await accrue(ref)).outcome).toBe("no_approved_policy");
    await flag(false); expect((await accrue(ref)).outcome).toBe("programme_off"); await flag(true);
  });

  it("only adults with an ordinary account can apply, and they must attest their age and accept the terms", async () => {
    await as(CHILD); await fails("select public.qb_affiliate_apply('Child Name','0244000000',true,true)", [], /QB_ADULTS_ONLY/);
    await as(MANAGED); await fails("select public.qb_affiliate_apply('Managed Name','0244000000',true,true)", [], /QB_ADULTS_ONLY/);
    await as(AFF);
    await fails("select public.qb_affiliate_apply('Ama Affiliate','0244000000',false,true)", [], /QB_ADULT_ATTESTATION_REQUIRED/);
    await fails("select public.qb_affiliate_apply('Ama Affiliate','0244000000',true,false)", [], /QB_TERMS_REQUIRED/);
    await fails("select public.qb_affiliate_apply('A','abc',true,true)", [], /QB_AFFILIATE_INVALID/);
    const first = await rpc("select public.qb_affiliate_apply('Ama Affiliate','0244000000',true,true)");
    expect(first.status).toBe("applied");
    expect((await rpc("select public.qb_affiliate_apply('Ama Affiliate','0244000000',true,true)")).id).toBe(first.id);                    // applying twice is the same application
    const me = await rpc("select public.qb_affiliate_me()");
    expect(me.referral_code).toBeNull();                                                                                                      // no code is shown until staff approve
  });

  it("staff approve only after an identity check and with payout details on file; the payout account is never returned in full", async () => {
    await as(PLAIN); await fails("select public.qb_affiliate_admin_list('applied')", [], /QB_FORBIDDEN/);
    await as(OWNER); const [a] = await rpc("select public.qb_affiliate_admin_list('applied')");
    await fails("select public.qb_affiliate_decide($1,'approve','',false)", [a.id], /QB_IDENTITY_CHECK_REQUIRED/);
    await fails("select public.qb_affiliate_decide($1,'approve','',true)", [a.id], /QB_PAYOUT_DETAILS_REQUIRED/);
    await as(AFF); await fails("select public.qb_affiliate_payout_save('cash','MTN','0244000000','Ama')", [], /QB_PAYOUT_INVALID/);
    await fails("select public.qb_affiliate_payout_save('mobile_money','MTN','abc','Ama')", [], /QB_PAYOUT_INVALID/);
    const saved = await rpc("select public.qb_affiliate_payout_save('mobile_money','MTN','0244123456','Ama Affiliate')");
    expect(saved.payout).toMatchObject({ account_masked: "******3456", verified: false });
    expect(JSON.stringify(saved)).not.toContain("0244123456");
    await as(FIN); await rpc("select public.qb_affiliate_decide($1,'approve','',true)", [a.id]);                                              // a finance admin may approve
    await as(AFF); const me = await rpc("select public.qb_affiliate_me()");
    expect(me.status).toBe("approved"); expect(me.referral_code).toMatch(/^[A-Z0-9]{8}$/); expect(me.payout.verified).toBe(true);
    const changed = await rpc("select public.qb_affiliate_payout_save('mobile_money','Vodafone','0200111222','Ama Affiliate')");
    expect(changed.payout.verified).toBe(false);                                                                                              // new details need a new look
    await as(OWNER); await fails("select public.qb_affiliate_decide($1,'suspend','x',false)", [a.id], /QB_REASON_REQUIRED/);
    await fails("select public.qb_affiliate_decide($1,'approve','',true)", [a.id], /QB_INVALID_TRANSITION/);
  });

  it("policy versions: validated, second approver required, the owner's own approval is audited, approved versions never change, renewals cannot be switched on", async () => {
    await as(FIN);
    const draft = await rpc("select public.qb_commission_policy_save('Finance draft','{\"registered\":10,\"growth\":12.5,\"ambassador\":15}'::jsonb,10,30,90,15,30,30,5000,0,'{subscription}',true,'')");
    expect(draft.status).toBe("draft");
    await fails("select public.qb_commission_policy_approve($1)", [draft.id], /QB_SECOND_APPROVER_REQUIRED/);                              // a finance admin cannot approve their own draft
    await fails("select public.qb_commission_policy_save('Bad','{\"registered\":10}'::jsonb,10,30,90,15,30,30,5000,0,'{subscription}',true,'')", [], /QB_POLICY_INVALID/);
    await fails("select public.qb_commission_policy_save('Bad','{\"registered\":10,\"growth\":150,\"ambassador\":15}'::jsonb,10,30,90,15,30,30,5000,0,'{subscription}',true,'')", [], /QB_POLICY_INVALID/);
    await fails("select public.qb_commission_policy_save('Bad','{\"registered\":10,\"growth\":12,\"ambassador\":15}'::jsonb,10,30,90,101,30,30,5000,0,'{subscription}',true,'')", [], /QB_POLICY_INVALID/);
    await fails("select public.qb_commission_policy_save('Bad','{\"registered\":10,\"growth\":12,\"ambassador\":15}'::jsonb,30,10,90,15,30,30,5000,0,'{subscription}',true,'')", [], /QB_POLICY_INVALID/);
    await as(OWNER); const live = await rpc("select public.qb_commission_policy_approve($1)", [draft.id]);                                    // a different person approves it
    expect(live).toMatchObject({ status: "approved", version: 2 });
    const mine = await policy({ hold: 30 });                                                                                                   // the owner approves their own, which retires v2
    const audit = await sql("select details from public.audit_logs where action = 'commission.policy_approve' and (details ->> 'version')::int = $1", [mine.version]);
    expect(audit[0].details).toMatchObject({ self_approved: true });
    expect((await sql("select status from public.commission_policies where version = 2"))[0].status).toBe("retired");
    await fails("update public.commission_policies set acquisition_cap_percent = 90 where status = 'approved'", [], /QB_POLICY_IMMUTABLE/);
    await fails("update public.commission_policies set status = 'approved' where status = 'retired'", [], /QB_POLICY_IMMUTABLE/);
    await fails("delete from public.commission_policies where status = 'approved'", [], /QB_RECORD_IMMUTABLE/);
    await fails("insert into public.commission_policies(version, name, tier_rates, recurring_enabled) values (99,'Renewals on','{\"registered\":10,\"growth\":12,\"ambassador\":15}'::jsonb, true)", [], /check/i);
    await as(PLAIN); await fails("select public.qb_commission_policies_list()", [], /QB_FORBIDDEN/);
  });

  it("attributes a customer once, first touch wins, never to themselves, and never an existing customer", async () => {
    const code = (await sql("select referral_code from public.affiliates where user_id = $1", [AFF]))[0].referral_code as string;
    const code2 = await approvedAffiliate(AFF2, "Kojo Affiliate");
    expect(await capture(BUYERS[1], "nonsense")).toBe("invalid_code");
    expect(await capture(BUYERS[1], "ZZZZZZZZ")).toBe("invalid_code");
    expect(await capture(AFF, code)).toBe("self_referral");
    expect((await sql("select count(*)::int c from public.referral_attributions where referred_user_id = $1", [AFF]))[0].c).toBe(0);
    expect(await capture(BUYERS[1], `  ${code.toLowerCase()} `)).toBe("attributed");                                                          // case and spaces do not matter
    expect(await capture(BUYERS[1], code2)).toBe("already_attributed");                                                                       // the second code does not take over
    expect((await sql("select a.display_name from public.referral_attributions r join public.affiliates a on a.id = r.affiliate_id where r.referred_user_id = $1", [BUYERS[1]]))[0].display_name).toBe("Ama Affiliate");
    await pay(BUYERS[2]);                                                                                                                      // BUYERS[2] already bought before using a link
    expect(await capture(BUYERS[2], code)).toBe("existing_customer");
    await as(AFF2); await rpc("select public.qb_affiliate_summary()");
    await as(OWNER); await rpc("select public.qb_affiliate_decide($1,'suspend','fraud check',false)", [(await sql("select id from public.affiliates where user_id = $1", [AFF2]))[0].id]);
    expect(await capture(BUYERS[3], code2)).toBe("invalid_code");                                                                            // a suspended affiliate cannot gain customers
    await as(OWNER); await rpc("select public.qb_affiliate_decide($1,'reinstate','cleared',false)", [(await sql("select id from public.affiliates where user_id = $1", [AFF2]))[0].id]);
  });

  it("accrues once per paid subscription of a referred customer, on the first purchase only, and only for settled, granted subscriptions", async () => {
    await policy({ hold: 30 });
    const ok = await pay(BUYERS[1], 2500);
    const first = await accrue(ok);
    expect(first).toMatchObject({ outcome: "accrued", amount_minor: 250, tier: "registered", rate_percent: 10, cap_clipped_minor: 0 });          // 10 percent of GHS 25
    expect(await accrue(ok)).toMatchObject({ outcome: "already_accrued" });                                                                    // a duplicate webhook delivery adds nothing
    expect((await sql("select count(*)::int c from public.commission_accruals where payment_reference = $1", [ok]))[0].c).toBe(1);
    expect((await sql("select status from public.referral_attributions where referred_user_id = $1", [BUYERS[1]]))[0].status).toBe("qualified");
    expect(await bal(AFF)).toMatchObject({ pending: 250, available: 0 });                                                                     // held for the validation period
    expect((await accrue(await pay(BUYERS[1], 2500))).outcome).toBe("not_first_purchase");                                                    // renewals earn nothing
    expect((await accrue(await pay(BUYERS[0], 2500))).outcome).toBe("no_attribution");
    const code = (await sql("select referral_code from public.affiliates where user_id = $1", [AFF]))[0].referral_code as string;
    expect(await capture(BUYERS[4], code)).toBe("attributed");
    expect((await accrue(await pay(BUYERS[4], 2500, { unsettled: true }))).outcome).toBe("not_settled");
    expect((await accrue(await pay(BUYERS[4], 2500, { coins: true }))).outcome).toBe("not_eligible");                                         // buying Coins is not a subscription
    expect((await accrue(await pay(BUYERS[4], 2500, { unfulfilled: true }))).outcome).toBe("not_fulfilled");                                  // paid but the subscription was never granted: no commission
    expect((await sql("select status from public.referral_attributions where referred_user_id = $1", [BUYERS[4]]))[0].status).toBe("pending");  // still waiting for a real first purchase
    expect((await accrue(await pay(BUYERS[4], 4000))).outcome).toBe("accrued");
    await expect(service("select public.qb_commission_accrue('QB-missing')")).rejects.toThrow(/QB_NOT_FOUND/);
  });

  it("a referred customer who pays for the affiliate, or an affiliate who pays through their own code, earns nothing", async () => {
    const code = (await sql("select referral_code from public.affiliates where user_id = $1", [AFF]))[0].referral_code as string;
    expect(await capture(BUYERS[5], code)).toBe("attributed");
    const ref = await pay(BUYERS[5], 2500, { for: AFF });
    expect((await accrue(ref)).outcome).toBe("self_referral");
    expect((await sql("select status, reject_reason from public.referral_attributions where referred_user_id = $1", [BUYERS[5]]))[0]).toMatchObject({ status: "rejected", reject_reason: "self referral" });
    expect((await accrue(await pay(BUYERS[5], 2500))).outcome).toBe("attribution_rejected");
    expect((await sql("select count(*)::int c from public.commission_accruals a join public.payment_intents i on i.reference = a.payment_reference where i.payer_user_id = $1", [BUYERS[5]]))[0].c).toBe(0);
  });

  it("limits how fast one person can try codes, so codes cannot be guessed", async () => {
    await as(BUYERS[13]);
    let refused = 0;
    for (let i = 0; i < 25; i++) { try { await rpc("select public.qb_referral_capture($1,'link','')", [`GUESS${String(i).padStart(3, "0")}`]); } catch (e: any) { if (/QB_RATE_LIMITED/.test(String(e.message))) refused++; } }
    expect(refused).toBe(5);                                                                                                                   // 20 tries an hour, the rest are turned away
  });

  it("a payment settled after the attribution window earns nothing", async () => {
    const code = (await sql("select referral_code from public.affiliates where user_id = $1", [AFF]))[0].referral_code as string;
    expect(await capture(BUYERS[6], code)).toBe("attributed");
    const late = await pay(BUYERS[6], 2500, { settled: new Date(Date.now() + 40 * 86400_000).toISOString() });                                // 40 days later, window is 30
    expect((await accrue(late)).outcome).toBe("attribution_expired");
    expect((await sql("select status, reject_reason from public.referral_attributions where referred_user_id = $1", [BUYERS[6]]))[0]).toMatchObject({ status: "rejected" });
  });

  it("tiers rise with verified paid referrals in the window, and the combined cap clips any rate above it", async () => {
    await policy({ rates: { registered: 10, growth: 12.5, ambassador: 20 }, growth: 2, amb: 3, cap: 15, hold: 30 });                        // ambassador rate 20 is above the 15 cap
    const code = (await sql("select referral_code from public.affiliates where user_id = $1", [AFF]))[0].referral_code as string;
    // AFF already has two qualified referrals (BUYERS[1], BUYERS[4]), so the next sale earns the Growth rate.
    expect(await capture(BUYERS[7], code)).toBe("attributed");
    expect(await accrue(await pay(BUYERS[7], 4000))).toMatchObject({ outcome: "accrued", tier: "growth", rate_percent: 12.5, amount_minor: 500, cap_clipped_minor: 0 });
    expect(await capture(BUYERS[8], code)).toBe("attributed");
    expect(await accrue(await pay(BUYERS[8], 4000))).toMatchObject({ outcome: "accrued", tier: "ambassador", rate_percent: 20, amount_minor: 600, cap_clipped_minor: 200 });   // 20% would be 800; the cap allows 600
    expect((await sql("select tier from public.affiliates where user_id = $1", [AFF]))[0].tier).toBe("ambassador");
    const row = (await sql("select a.amount_minor, a.cap_clipped_minor, a.net_minor from public.commission_accruals a join public.payment_intents i on i.reference = a.payment_reference where i.payer_user_id = $1", [BUYERS[8]]))[0];
    expect(Number(row.amount_minor) + Number(row.cap_clipped_minor)).toBe(800);
    expect(Number(row.amount_minor)).toBeLessThanOrEqual(Math.floor(Number(row.net_minor) * 0.15));                                           // never above the cap
  });

  it("commission is worked out on revenue net of tax, and the policy version used is kept on the accrual", async () => {
    const p = await policy({ tax: 15, hold: 30 });
    const code2 = (await sql("select referral_code from public.affiliates where user_id = $1", [AFF2]))[0].referral_code as string;
    expect(await capture(BUYERS[9], code2)).toBe("attributed");
    const out = await accrue(await pay(BUYERS[9], 2300));
    expect(out).toMatchObject({ outcome: "accrued", amount_minor: 200 });                                                                       // 2300 less 300 tax = 2000; 10% = 200
    const a = (await sql("select a.gross_minor, a.tax_minor, a.net_minor, a.policy_id from public.commission_accruals a join public.payment_intents i on i.reference = a.payment_reference where i.payer_user_id = $1", [BUYERS[9]]))[0];
    expect([Number(a.gross_minor), Number(a.tax_minor), Number(a.net_minor)]).toEqual([2300, 300, 2000]);
    expect(a.policy_id).toBe(p.id);
  });

  it("held commission becomes available after the validation period, once, and the affiliate sees counts and amounts, never who the customers are", async () => {
    await policy({ hold: 0 });                                                                                                                 // no hold, so it can be released at once
    const code2 = (await sql("select referral_code from public.affiliates where user_id = $1", [AFF2]))[0].referral_code as string;
    expect(await capture(BUYERS[10], code2)).toBe("attributed");
    await accrue(await pay(BUYERS[10], 5000));                                                                                                 // 10% of 5000 = 500
    const before = await bal(AFF2);
    expect(before.available).toBeGreaterThanOrEqual(500);
    const again = await bal(AFF2);
    expect(again).toEqual(before);                                                                                                             // releasing twice moves nothing twice
    const summary = JSON.stringify(await rpc("select public.qb_affiliate_summary()"));
    for (const b of BUYERS) expect(summary).not.toContain(b);
    expect(summary).not.toContain("buyer10@example.com");
    expect(JSON.parse(summary).referrals.paid).toBeGreaterThanOrEqual(2);
    await as(AFF); const mine = await rpc("select public.qb_affiliate_summary()");                                                              // each affiliate sees only their own numbers
    expect(mine.balances.available).not.toBe(before.available);
  });

  it("a refund reverses the commission with an explicit row: a held one disappears, an approved one is taken back, a paid one leaves a negative balance", async () => {
    const code = (await sql("select referral_code from public.affiliates where user_id = $1", [AFF]))[0].referral_code as string;
    // held (pending): BUYERS[1]'s first payment, from the earlier test
    const heldRef = (await sql("select payment_reference from public.commission_accruals a join public.payment_intents i on i.reference = a.payment_reference where i.payer_user_id = $1 order by a.created_at limit 1", [BUYERS[1]]))[0].payment_reference as string;
    const pendingBefore = (await bal(AFF)).pending;
    expect(await reverse(heldRef)).toMatchObject({ outcome: "reversed", reversed: 1 });
    expect((await bal(AFF)).pending).toBe(pendingBefore - 250);
    expect(await reverse(heldRef)).toMatchObject({ outcome: "none" });                                                                          // a repeated refund event reverses nothing twice
    expect((await sql("select status from public.commission_accruals where payment_reference = $1", [heldRef]))[0].status).toBe("reversed");
    // approved: AFF2's released commission
    const approvedRef = (await sql("select payment_reference from public.commission_accruals a join public.payment_intents i on i.reference = a.payment_reference where i.payer_user_id = $1", [BUYERS[10]]))[0].payment_reference as string;
    const availBefore = (await bal(AFF2)).available;
    await reverse(approvedRef);
    expect((await bal(AFF2)).available).toBe(availBefore - 500);
    // paid out (simulated with the ledger rows the payout release will write), then refunded: the balance goes negative so later earnings offset it
    await policy({ hold: 0 });
    expect(await capture(BUYERS[11], code)).toBe("attributed");
    const paidRef = await pay(BUYERS[11], 2500); const out = await accrue(paidRef);
    await bal(AFF);
    const aff = (await sql("select id from public.affiliates where user_id = $1", [AFF]))[0].id as string;
    const accrual = (await sql("select id from public.commission_accruals where payment_reference = $1", [paidRef]))[0].id as string;
    const before = (await bal(AFF)).available;
    await sql("insert into public.commission_ledger(affiliate_id, accrual_id, kind, bucket, amount_minor) values ($1,$2,'payout_reserved','available',$3),($1,$2,'payout_reserved','reserved',$4),($1,$2,'payout_paid','reserved',$3),($1,$2,'payout_paid','paid',$4)",
      [aff, accrual, -out.amount_minor, out.amount_minor]);
    await sql("update public.commission_accruals set status = 'paid' where id = $1", [accrual]);
    await reverse(paidRef, "chargeback");
    expect((await bal(AFF)).available).toBe(before - 2 * out.amount_minor);                                                                    // the paid amount is owed back: negative until offset
    await as(OWNER); await fails("select public.qb_commission_admin_reverse('QB-none-here','a good reason')", [], /QB_NOT_FOUND/);
    await fails("select public.qb_commission_admin_reverse($1,'x')", [paidRef], /QB_REASON_REQUIRED/);
    await as(PLAIN); await fails("select public.qb_commission_admin_reverse($1,'a good reason')", [paidRef], /QB_FORBIDDEN/);
  });

  it("the ledger and the records cannot be edited: balances move only by new rows", async () => {
    await db.exec("reset role");                                                                                                                 // the table owner: even they cannot rewrite money records
    await fails("update public.commission_ledger set amount_minor = amount_minor + 1", [], /QB_LEDGER_IMMUTABLE/);
    await fails("delete from public.commission_ledger", [], /QB_LEDGER_IMMUTABLE/);
    await fails("update public.commission_accruals set amount_minor = amount_minor * 2", [], /QB_ACCRUAL_IMMUTABLE/);
    await fails("update public.commission_accruals set status = 'pending' where status = 'reversed'", [], /QB_ACCRUAL_IMMUTABLE/);
    await fails("update public.referral_attributions set affiliate_id = (select id from public.affiliates where user_id = '" + AFF2 + "')", [], /QB_ATTRIBUTION_IMMUTABLE/);
    await fails("update public.referral_attributions set status = 'pending' where status = 'qualified'", [], /QB_ATTRIBUTION_IMMUTABLE/);
    await as(AFF); await fails("update public.commission_ledger set amount_minor = 1", [], /permission denied/);
  });

  it("the finance view ties out: every accrual's ledger rows add up to its amount (or to zero once reversed), and the totals match", async () => {
    const off = await sql(`select count(*)::int c from public.commission_accruals a where coalesce((select sum(l.amount_minor) from public.commission_ledger l where l.accrual_id = a.id), 0) <> case when a.status = 'reversed' then 0 else a.amount_minor end`);
    expect(off[0].c).toBe(0);
    await as(FIN); const s = await rpc("select public.qb_commission_admin_summary()");
    const buckets = Object.values(s.balances as Record<string, number>).reduce((x, y) => x + Number(y), 0);
    expect(buckets).toBe(Number(s.ledger_total_minor));
    expect(s.policy).toMatchObject({ cap_percent: 15 });
    expect(s.cap_clipped_minor).toBeGreaterThanOrEqual(200);
    const list = await rpc("select public.qb_commission_admin_accruals(null, 50)");
    expect(list.length).toBeGreaterThan(5);
    expect(JSON.stringify(list)).not.toMatch(/@example\.com/);                                                                                   // the finance list names affiliates, not customers
    await as(AFF); await fails("select public.qb_commission_admin_summary()", [], /QB_FORBIDDEN/);                                              // an affiliate cannot see anyone else's numbers
  });

  it("rolling back removes the functions but keeps every record, and customers' payments are not affected", async () => {
    const before = (await sql("select (select count(*) from public.commission_ledger)::int l, (select count(*) from public.commission_accruals)::int a"))[0];
    await db.exec("reset role"); await db.exec(ROLLBACK);
    const left = await sql("select count(*)::int c from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'qb\\_affiliate\\_%' or proname like 'qb\\_commission\\_%' or proname like 'qb\\_referral\\_%')");
    expect(left[0].c).toBe(0);
    expect((await sql("select (select count(*) from public.commission_ledger)::int l, (select count(*) from public.commission_accruals)::int a"))[0]).toEqual(before);
    await fails("update public.commission_ledger set amount_minor = 1", [], /QB_LEDGER_IMMUTABLE/);                                              // the records stay protected
    expect((await sql("select value from public.platform_settings where key = 'flags.affiliates'"))[0].value).toBe(false);
    await db.exec(MIGRATION);                                                                                                                    // and it can be put back
  });
});
