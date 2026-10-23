import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The Marketplace (isolated PostgreSQL; payments and the Coin ledger are stubbed because they have their own tests).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const MIGRATION = read("../../supabase/migrations/20261043100000_marketplace.sql");
const ROLLBACK = read("../../supabase/rollback/marketplace.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, TEACHER2, BUYER, BUYER2, FINANCE, CHILD, STUDENT] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
let db: PGlite;
const as = async (user: string | null) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const owner = async (sql: string, params: unknown[] = []) => { await db.exec("reset role"); return rpc(sql, params); };
const setting = async (key: string, value: unknown) => { await db.exec("reset role"); await db.query("insert into public.platform_settings(key, value) values ($1, $2::jsonb) on conflict (key, scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set value = excluded.value", [key, JSON.stringify(value)]); };
const qs = (n: number, tag = "A") => JSON.stringify(Array.from({ length: n }, (_, i) => ({ question_text: `${tag} question number ${i + 1} about acids?`, options: ["one", "two", "three", "four"], correct_index: i % 4, explanation: "because" })));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, is_minor boolean not null default false);
    create table public.user_capabilities(user_id uuid not null, capability text not null, active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_user_id uuid, recipient_profile_id uuid, recipient_email text, recipient_role text not null, type text not null, title text not null, message text not null,
      created_at timestamptz not null default now(), read_at timestamptz, link text, category text not null default 'system');
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
    create table public.payment_intents(id uuid primary key default gen_random_uuid(), reference text not null unique, beneficiary_user_id uuid not null, amount_minor bigint not null, coins bigint not null,
      status text not null default 'initiated', credited_tx_id uuid, metadata jsonb not null default '{}');
    create table public.stub_wallet(user_id uuid primary key, balance bigint not null default 0); create table public.stub_spend(idem text primary key, user_id uuid, amount bigint);
    create function public.qb_coin_spend(p_user uuid, p_amount bigint, p_purpose text, p_ref text, p_idem text, p_entitlement jsonb default null) returns jsonb language plpgsql security definer as $$
      begin
        if exists (select 1 from public.stub_spend where idem = p_idem) then return jsonb_build_object('spent', p_amount, 'duplicate', true); end if;
        update public.stub_wallet set balance = balance - p_amount where user_id = p_user and balance >= p_amount;
        if not found then raise exception 'QB_INSUFFICIENT_BALANCE'; end if;
        insert into public.stub_spend values (p_idem, p_user, p_amount); return jsonb_build_object('spent', p_amount);
      end $$;
    insert into public.profiles values ('${OWNER}','OWNER','active','Owner','o@example.com'),('${TEACHER}','TEACHER','active','Ama Teacher','t@example.com'),('${TEACHER2}','TEACHER','active','Kojo Teacher','t2@example.com'),
      ('${BUYER}','TEACHER','active','Buyer One','b1@example.com'),('${BUYER2}','STUDENT','active','Buyer Two','b2@example.com'),('${FINANCE}','ADMIN','active','Finance','f@example.com'),
      ('${CHILD}','STUDENT','active','Child','c@example.com'),('${STUDENT}','STUDENT','active','Student','s@example.com');
    insert into public.student_profiles(user_id, is_minor) values ('${CHILD}', true),('${STUDENT}', false),('${BUYER2}', false);
    insert into public.user_capabilities values ('${FINANCE}', 'finance_admin', true);
  `);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

const seller = async (u: string, name = "Ama Mensah", school = "Opoku Ware School") => { await as(u); return rpc("select public.qb_mk_seller_save($1,$2,'0244000000','mobile_money','MTN','0244000000',$3,true)", [name, school, name]); };
// A verified seller with an approved set at the given price (in pesewas), 12 questions.
const approvedSet = async (u: string, title: string, price = 2000, school = "Opoku Ware School", subject = "Chemistry") => {
  await as(u);
  const it = await rpc("select public.qb_mk_item_save(null,$1,'End of term test',$2,'SHS1','Term 2',$3,$4)", [title, subject, school, price]);
  await rpc("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, qs(12, title)]);
  await rpc("select public.qb_mk_item_submit($1)", [it.id]);
  await as(OWNER); await rpc("select public.qb_mk_admin_review($1,'approve','')", [it.id]);
  return it as { id: string; slug: string };
};
// A Paystack payment for one set: the checkout stores the cart on the intent, the webhook settles it, then the sale is recorded.
let n = 0;
const pay = async (buyer: string, item: { id: string }, price: number) => {
  const ref = `QB-test${++n}`;
  await db.exec("reset role");
  await db.query("insert into public.payment_intents(reference, beneficiary_user_id, amount_minor, coins) values ($1,$2,$3,$4)", [ref, buyer, price, price / 100]);
  await db.query("insert into public.stub_wallet values ($1,$2) on conflict (user_id) do update set balance = public.stub_wallet.balance + excluded.balance", [buyer, price / 100]);
  await db.query("select public.qb_mk_set_payment_item($1,$2,$3)", [ref, item.id, price]);
  await db.query("update public.payment_intents set status='successful', credited_tx_id=gen_random_uuid() where reference=$1", [ref]);
  return { ref, out: await rpc("select public.qb_mk_fulfil_purchase($1)", [ref]) };
};

describe("marketplace", () => {
  it("re-applies cleanly and is closed to every browser role", async () => {
    await db.exec("reset role"); await db.exec(MIGRATION);
    await as(TEACHER);
    for (const t of ["mk_sellers", "mk_items", "mk_questions", "mk_purchases", "mk_ledger", "mk_payouts", "mk_attempts"]) await fails(`select * from public.${t}`, [], /permission denied/);
    await as(null); await fails("select public.qb_mk_my_items()", [], /permission denied/);
    await as(TEACHER); await fails("select public.qb_mk_fulfil_purchase('x')", [], /permission denied/);
  });

  it("only teachers can become sellers; they must accept the terms; payout details are checked; and changing them sends a verified seller back to review", async () => {
    await as(STUDENT); await fails("select public.qb_mk_seller_save('Kofi A','School','0244000000','mobile_money','MTN','0244000000','Kofi',true)", [], /QB_TEACHERS_ONLY/);
    await as(TEACHER); await fails("select public.qb_mk_seller_save('Ama Mensah','Opoku Ware','0244000000','mobile_money','MTN','0244000000','Ama',false)", [], /QB_TERMS_REQUIRED/);
    await fails("select public.qb_mk_seller_save('Ama Mensah','Opoku Ware','0244000000','mobile_money','MTN','abc','Ama',true)", [], /QB_SELLER_INVALID/);
    const s = await seller(TEACHER);
    expect(s).toMatchObject({ status: "pending", payout_account_masked: "******0000", enabled: false });
    expect(JSON.stringify(s)).not.toContain('"payout_account"');
    await as(TEACHER2); await seller(TEACHER2, "Kojo Boateng", "Achimota School");
    await as(OWNER); const list = await rpc("select public.qb_mk_admin_sellers('pending')");
    expect(list).toHaveLength(2);
    await fails("select public.qb_mk_admin_seller_set($1,'suspended','')", [list[0].id], /QB_REASON_REQUIRED/);
    for (const x of list) await rpc("select public.qb_mk_admin_seller_set($1,'verified','')", [x.id]);
    await as(TEACHER); await rpc("select public.qb_mk_seller_save('Ama Mensah','Opoku Ware School','0244000000','mobile_money','MTN','0244000000','Ama Mensah',false)");
    expect((await rpc("select public.qb_mk_seller_get()")).status).toBe("verified");           // unchanged payout details keep the status
    expect((await rpc("select public.qb_mk_seller_save('Ama Mensah','Opoku Ware School','0200000000','mobile_money','Vodafone','0200000000','Ama Mensah',false)")).status).toBe("pending");
    await as(OWNER); await rpc("select public.qb_mk_admin_seller_set($1,'verified','')", [(await rpc("select public.qb_mk_admin_sellers('pending')"))[0].id]);
  });

  it("prices are whole cedis from GHS 5 to GHS 200; sets need enough distinct questions; answers stay hidden until bought", async () => {
    await as(TEACHER);
    for (const p of [400, 550, 20100, 0]) await fails("select public.qb_mk_item_save(null,'Chem Test 1','x','Chemistry','SHS1','Term 1','Opoku Ware School',$1)", [p], /QB_PRICE_INVALID/);
    const it = await rpc("select public.qb_mk_item_save(null,'Chem End Of Term','Ten plus questions','Chemistry','SHS1','Term 1','Opoku Ware School',1500)");
    await rpc("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, qs(5)]);
    await fails("select public.qb_mk_item_submit($1)", [it.id], /QB_TOO_FEW_QUESTIONS/);
    await fails("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, JSON.stringify([{ question_text: "Same question here?", options: ["a", "b"], correct_index: 0 }, { question_text: "Same  question here?", options: ["a", "b"], correct_index: 1 }])], /QB_QUESTIONS_DUPLICATE/);
    await fails("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, JSON.stringify([{ question_text: "Pick the right one?", options: ["a", "a"], correct_index: 0 }])], /QB_QUESTIONS_INVALID/);
    await fails("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, JSON.stringify([{ question_text: "Pick the right one?", options: ["a", "b"], correct_index: 3 }])], /QB_QUESTIONS_INVALID/);
    await rpc("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, qs(10, "Chem")]);
    expect(await rpc("select public.qb_mk_item_submit($1)", [it.id])).toMatchObject({ status: "submitted" });
    await fails("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, qs(10)], /QB_ITEM_LOCKED/);   // locked while under review
    await as(BUYER); await fails("select public.qb_mk_open($1)", [it.id], /QB_NOT_PURCHASED/);
    await as(TEACHER2); await fails("select public.qb_mk_my_item($1)", [it.id], /QB_NOT_FOUND/);
  });

  it("an unverified seller cannot submit; the admin must approve; rejecting needs a reason and the seller can fix and resubmit", async () => {
    await as(STUDENT); // not a seller at all
    await fails("select public.qb_mk_my_items()", [], /QB_NOT_A_SELLER/);
    await as(TEACHER);
    const list = (await rpc("select public.qb_mk_my_items()")) as any[];
    const it = list.find((x) => x.title === "Chem End Of Term");
    expect(it.status).toBe("submitted");
    await as(TEACHER2); await fails("select public.qb_mk_admin_review($1,'approve','')", [it.id], /QB_FORBIDDEN/);
    await as(OWNER);
    await fails("select public.qb_mk_admin_review($1,'reject','')", [it.id], /QB_REASON_REQUIRED/);
    const detail = await rpc("select public.qb_mk_admin_item($1)", [it.id]);
    expect(detail.questions).toHaveLength(10); expect(detail.seller).toMatchObject({ school: "Opoku Ware School" });
    await rpc("select public.qb_mk_admin_review($1,'reject','Question 3 has two correct answers.')", [it.id]);
    await as(TEACHER); expect(((await rpc("select public.qb_mk_my_items()")) as any[]).find((x) => x.id === it.id)).toMatchObject({ status: "rejected", review_note: "Question 3 has two correct answers." });
    await rpc("select public.qb_mk_item_save($1,'Chem End Of Term','Fixed','Chemistry','SHS1','Term 1','Opoku Ware School',1500)", [it.id]);
    await rpc("select public.qb_mk_item_submit($1)", [it.id]);
    await as(OWNER); await rpc("select public.qb_mk_admin_review($1,'approve','')", [it.id]);
    await fails("select public.qb_mk_admin_review($1,'approve','')", [it.id], /QB_NOT_SUBMITTED/);
  });

  it("the catalogue is closed until the Marketplace is switched on, then shows the source (subject, school) with no answers", async () => {
    await as(null); expect(await rpc("select public.qb_mk_catalog()")).toEqual([]); expect(await rpc("select public.qb_mk_enabled()")).toBe(false);
    await setting("flags.marketplace", true);
    await as(null); expect(await rpc("select public.qb_mk_enabled()")).toBe(true);
    const cat = (await rpc("select public.qb_mk_catalog()")) as any[];
    expect(cat).toHaveLength(1);
    expect(cat[0]).toMatchObject({ title: "Chem End Of Term", subject: "Chemistry", school: "Opoku Ware School", price_minor: 1500, questions: 10, seller: "Ama Mensah" });
    expect(JSON.stringify(cat)).not.toContain("correct");
    const one = await rpc("select public.qb_mk_item_public($1)", [cat[0].slug]);
    expect(one.samples).toHaveLength(3); expect(JSON.stringify(one)).not.toContain("correct_index"); expect(one.access_days).toBe(90);
    expect(await rpc("select public.qb_mk_catalog(null, 'Chemistry', null, 'Achimota School')")).toEqual([]);
    expect(await rpc("select public.qb_mk_catalog('opoku')")).toHaveLength(1);
    expect(await rpc("select public.qb_mk_catalog('100%')")).toEqual([]);
  });

  it("checks the buyer before the checkout: not your own set, not a child, not twice, not when closed", async () => {
    const item = ((await owner("select public.qb_mk_catalog()")) as any[])[0];
    const id0 = (await owner("select id from public.mk_items where slug=$1", [item.slug])) as string;
    await as(TEACHER); await fails("select public.qb_mk_prepare_purchase($1)", [id0], /QB_OWN_ITEM/);
    await as(CHILD); await fails("select public.qb_mk_prepare_purchase($1)", [id0], /QB_MINOR_CANNOT_PAY/);
    await as(null); await fails("select public.qb_mk_prepare_purchase($1)", [id0], /permission denied/);
    await as(BUYER); expect(await rpc("select public.qb_mk_prepare_purchase($1)", [id0])).toMatchObject({ price_minor: 1500, school: "Opoku Ware School", subject: "Chemistry" });
    await setting("flags.marketplace", false); await as(BUYER); await fails("select public.qb_mk_prepare_purchase($1)", [id0], /QB_FEATURE_DISABLED/); await setting("flags.marketplace", true);
  });

  it("a paid cart records the sale once: 60% to the teacher, 40% to QuizBox, 90 days of access, held for 7 days", async () => {
    const set = await approvedSet(TEACHER, "Chem Mock Exam", 2000);
    const { ref, out } = await pay(BUYER, set, 2000);
    expect(out).toMatchObject({ outcome: "fulfilled", seller_share_minor: 1200, platform_fee_minor: 800 });
    expect((await owner("select public.qb_mk_fulfil_purchase($1)", [ref]))).toMatchObject({ outcome: "already_fulfilled" });   // a repeated webhook sells nothing twice
    expect(await owner("select count(*)::int from public.mk_purchases where payment_reference=$1", [ref])).toBe(1);
    const row = await owner("select jsonb_build_object('days', round(extract(epoch from (expires_at - purchased_at)) / 86400), 'school', item_school, 'subject', item_subject, 'sum', seller_share_minor + platform_fee_minor, 'price', price_minor) from public.mk_purchases where payment_reference=$1", [ref]);
    expect(row).toEqual({ days: 90, school: "Opoku Ware School", subject: "Chemistry", sum: 2000, price: 2000 });
    const led = await owner("select jsonb_build_object('amount', amount_minor, 'held_days', round(extract(epoch from (available_at - now())) / 86400)) from public.mk_ledger where kind='sale' and purchase_id=(select id from public.mk_purchases where payment_reference=$1)", [ref]);
    expect(led).toEqual({ amount: 1200, held_days: 7 });
    await as(BUYER);
    const mine = (await rpc("select public.qb_mk_my_purchases()")) as any[];
    expect(mine[0]).toMatchObject({ title: "Chem Mock Exam", school: "Opoku Ware School", active: true, days_left: 90 });
    const opened = await rpc("select public.qb_mk_open($1)", [set.id]);
    expect(opened.questions).toHaveLength(12); expect(opened.questions[0]).toHaveProperty("correct_index");
    await rpc("select public.qb_mk_record_attempt($1, 9, 12)", [set.id]);
    await fails("select public.qb_mk_record_attempt($1, 13, 12)", [set.id], /QB_INVALID_ATTEMPT/);
    await as(BUYER); await fails("select public.qb_mk_prepare_purchase($1)", [set.id], /QB_ALREADY_OWNED/);
    await as(BUYER2); await fails("select public.qb_mk_open($1)", [set.id], /QB_NOT_PURCHASED/);
    await as(BUYER2); await fails("select public.qb_mk_record_attempt($1, 1, 2)", [set.id], /QB_NOT_PURCHASED/);
  });

  it("splits odd prices without losing a pesewa, and refuses a cart whose amount differs from the price", async () => {
    expect(await owner("select public.qb_mk_split(1500)")).toEqual([900, 600]);
    expect(await owner("select public.qb_mk_split(1501)")).toEqual([900, 601]);
    expect(await owner("select public.qb_mk_split(999)")).toEqual([599, 400]);
    const set = await approvedSet(TEACHER2, "Maths Term 2", 500, "Achimota School", "Mathematics");
    await db.exec("reset role");
    await db.query("insert into public.payment_intents(reference, beneficiary_user_id, amount_minor, coins) values ('QB-bad',$1,500,5)", [BUYER]);
    await expect(db.query("select public.qb_mk_set_payment_item('QB-bad',$1,400)", [set.id])).rejects.toThrow(/QB_PRICE_CHANGED/);   // the price sent to the gateway must be the item's price
    await db.query("select public.qb_mk_set_payment_item('QB-bad',$1,500)", [set.id]);
    await db.query("update public.payment_intents set status='successful', credited_tx_id=gen_random_uuid(), amount_minor=400 where reference='QB-bad'");   // the gateway reports a different amount
    expect(await rpc("select public.qb_mk_fulfil_purchase('QB-bad')")).toMatchObject({ outcome: "amount_mismatch" });
    await db.query("insert into public.payment_intents(reference, beneficiary_user_id, amount_minor, coins, status) values ('QB-open',$1,500,5,'initiated')", [BUYER]);
    await db.query("select public.qb_mk_set_payment_item('QB-open',$1,500)", [set.id]);
    expect(await rpc("select public.qb_mk_fulfil_purchase('QB-open')")).toMatchObject({ outcome: "not_settled" });
  });

  it("shows the seller each item with its sales count, gross, and 60% share, plus the balances", async () => {
    await as(BUYER2); const set = ((await owner("select jsonb_agg(id) from public.mk_items where title='Chem Mock Exam'")) as string[])[0];
    await pay(BUYER2, { id: set }, 2000); await pay(STUDENT, { id: set }, 2000);
    await as(TEACHER);
    const items = (await rpc("select public.qb_mk_my_items()")) as any[];
    const it = items.find((x) => x.title === "Chem Mock Exam");
    expect(it).toMatchObject({ sales: 3, gross_minor: 6000, share_minor: 3600, school_name: "Opoku Ware School", subject: "Chemistry" });
    const sum = await rpc("select public.qb_mk_seller_summary()");
    expect(sum).toMatchObject({ sales: 3, gross_minor: 6000, share_minor: 3600, fee_minor: 2400, available_minor: 0, in_hold_minor: 3600, share_percent: 60, hold_days: 7 });
    expect((await rpc("select public.qb_mk_my_sales(10)"))[0]).toMatchObject({ item: "Chem Mock Exam", school: "Opoku Ware School", price_minor: 2000, share_minor: 1200, fee_minor: 800 });
    await as(TEACHER2); expect((await rpc("select public.qb_mk_seller_summary()")).sales).toBe(0);
  });

  it("cannot request a payout while the money is held; after 7 days the teacher sees sales less QuizBox's 40%, approves it, and cannot request twice", async () => {
    await as(TEACHER);
    expect(await rpc("select public.qb_mk_payout_quote()")).toMatchObject({ amount_minor: 0, can_request: false });
    await fails("select public.qb_mk_payout_request(0)", [], /QB_PAYOUT_BELOW_MINIMUM/);
    await db.exec("reset role"); await db.exec("update public.mk_ledger set available_at = now() - interval '1 minute' where kind='sale'");
    await as(TEACHER);
    const quote = await rpc("select public.qb_mk_payout_quote()");
    expect(quote).toMatchObject({ amount_minor: 3600, gross_minor: 6000, platform_fee_minor: 2400, refunds_minor: 0, sales_count: 3, can_request: true, share_percent: 60 });
    expect(quote.destination).toMatchObject({ method: "mobile_money", account_masked: "******0000" });
    await fails("select public.qb_mk_payout_request(9999)", [], /QB_QUOTE_CHANGED/);       // approving a stale quote is refused
    const req = await rpc("select public.qb_mk_payout_request($1)", [3600]);
    expect(req).toMatchObject({ ok: true, amount_minor: 3600 });
    await fails("select public.qb_mk_payout_request($1)", [0], /QB_PAYOUT_ALREADY_REQUESTED/);
    expect(await rpc("select public.qb_mk_seller_summary()")).toMatchObject({ available_minor: 0, requested_minor: 3600, paid_minor: 0 });
    expect(await rpc("select public.qb_mk_payout_quote()")).toMatchObject({ amount_minor: 0 });
  });

  it("settles within 24 hours on working days: a weekday request is due the next day, a Friday request lands on Monday, a weekend request counts from Monday", async () => {
    const due = (iso: string) => owner("select to_char(public.qb_mk_due_at($1::timestamptz), 'YYYY-MM-DD HH24:MI')", [iso]);
    expect(await due("2026-10-21T10:00:00Z")).toBe("2026-10-22 10:00");   // Wednesday -> Thursday
    expect(await due("2026-10-23T10:00:00Z")).toBe("2026-10-26 17:00");   // Friday -> Monday 17:00
    expect(await due("2026-10-24T10:00:00Z")).toBe("2026-10-27 00:00");   // Saturday counts from Monday 00:00
    expect(await due("2026-10-25T09:00:00Z")).toBe("2026-10-27 00:00");   // Sunday counts from Monday 00:00
  });

  it("finance sees the destination in full and only finance can act; rejecting returns the money; the seller can cancel; paying needs a transfer reference and cannot be undone", async () => {
    await as(TEACHER); await fails("select public.qb_mk_admin_payouts()", [], /QB_FORBIDDEN/);
    await as(BUYER); await fails("select public.qb_mk_admin_payout_set($1,'paid','REF123','')", [id(999)], /QB_FORBIDDEN/);
    await as(FINANCE);
    const queue = (await rpc("select public.qb_mk_admin_payouts()")) as any[];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ seller: "Ama Mensah", school: "Opoku Ware School", amount_minor: 3600, sales_count: 3, overdue: false });
    expect(queue[0].destination).toMatchObject({ account: "0200000000", network: "Vodafone", name: "Ama Mensah" });
    await fails("select public.qb_mk_admin_payout_set($1,'reject',null,'')", [queue[0].id], /QB_REASON_REQUIRED/);
    await fails("select public.qb_mk_admin_payout_set($1,'paid','1','')", [queue[0].id], /QB_REFERENCE_REQUIRED/);
    await rpc("select public.qb_mk_admin_payout_set($1,'reject',null,'Account name does not match.')", [queue[0].id]);
    await fails("select public.qb_mk_admin_payout_set($1,'reject',null,'Again please')", [queue[0].id], /QB_PAYOUT_NOT_OPEN/);
    await as(TEACHER);
    expect(await rpc("select public.qb_mk_payout_quote()")).toMatchObject({ amount_minor: 3600, can_request: true });              // the money is back
    expect(await rpc("select public.qb_mk_seller_summary()")).toMatchObject({ available_minor: 3600, requested_minor: 0 });
    expect(((await rpc("select public.qb_mk_my_payouts()")) as any[])[0]).toMatchObject({ status: "rejected", note: "Account name does not match." });
    const again = await rpc("select public.qb_mk_payout_request(3600)");
    await rpc("select public.qb_mk_payout_cancel($1)", [again.payout]);
    expect(await rpc("select public.qb_mk_seller_summary()")).toMatchObject({ available_minor: 3600 });
    const last = await rpc("select public.qb_mk_payout_request(3600)");
    await as(FINANCE);
    expect(await rpc("select public.qb_mk_admin_payout_set($1,'paid','MTN-TRX-889','Sent by mobile money')", [last.payout])).toMatchObject({ ok: true });
    await as(TEACHER);
    expect(await rpc("select public.qb_mk_seller_summary()")).toMatchObject({ available_minor: 0, requested_minor: 0, paid_minor: 3600 });
    expect(((await rpc("select public.qb_mk_my_payouts()")) as any[])[0]).toMatchObject({ status: "paid", transfer_ref: "MTN-TRX-889" });
    await fails("select public.qb_mk_payout_cancel($1)", [last.payout], /QB_PAYOUT_NOT_OPEN/);
    expect(await owner("select count(*)::int from public.notifications where recipient_user_id=$1 and title='Your payout was sent'", [TEACHER])).toBe(1);
    expect(await owner("select count(*)::int from public.audit_logs where action like 'marketplace.%'")).toBeGreaterThan(3);
  });

  it("a refund ends the buyer's access and takes the teacher's share back; one made after payout leaves a debit that the next sales settle", async () => {
    const ref = (await owner("select payment_reference from public.mk_purchases where buyer_user_id=$1", [BUYER2])) as string;
    await as(TEACHER); await fails("select public.qb_mk_admin_reverse($1,'refund by mistake')", [ref], /QB_FORBIDDEN/);
    await as(FINANCE);
    await fails("select public.qb_mk_admin_reverse($1,'no')", [ref], /QB_REASON_REQUIRED/);
    await fails("select public.qb_mk_admin_reverse('QB-unknown','a good reason')", [], /QB_NOT_FOUND/);
    expect(await rpc("select public.qb_mk_admin_reverse($1,'Duplicate payment')", [ref])).toMatchObject({ outcome: "reversed" });
    expect(await rpc("select public.qb_mk_admin_reverse($1,'Duplicate payment')", [ref])).toMatchObject({ outcome: "already_reversed" });
    await as(BUYER2);
    expect(((await rpc("select public.qb_mk_my_purchases()")) as any[])[0]).toMatchObject({ active: false, status: "reversed" });
    const itemId = (await owner("select item_id from public.mk_purchases where payment_reference=$1", [ref])) as string;
    await as(BUYER2); await fails("select public.qb_mk_open($1)", [itemId], /QB_NOT_PURCHASED/);
    await as(TEACHER);
    expect(await rpc("select public.qb_mk_seller_summary()")).toMatchObject({ sales: 2, available_minor: -1200 });
    const quote = await rpc("select public.qb_mk_payout_quote()");
    expect(quote).toMatchObject({ amount_minor: -1200, refunds_minor: 1200, can_request: false });
    await fails("select public.qb_mk_payout_request(-1200)", [], /QB_PAYOUT_BELOW_MINIMUM/);
    expect(await owner("select purchases_count from public.mk_items where title='Chem Mock Exam'")).toBe(2);
  });

  it("a refund inside the 7-day hold nets out before it can be paid, and a gateway refund can reverse a sale by reference", async () => {
    const maths = (await owner("select id from public.mk_items where title='Maths Term 2'")) as string;
    const { ref } = await pay(BUYER, { id: maths }, 500);
    await as(TEACHER2); expect(await rpc("select public.qb_mk_seller_summary()")).toMatchObject({ sales: 1, in_hold_minor: 300 });
    expect(await owner("select public.qb_mk_reverse_purchase($1,'Gateway refund')", [ref])).toMatchObject({ outcome: "reversed" });
    expect(await owner("select public.qb_mk_reverse_purchase('QB-not-ours')")).toMatchObject({ outcome: "not_marketplace" });
    await as(TEACHER2); expect(await rpc("select public.qb_mk_seller_summary()")).toMatchObject({ sales: 0, in_hold_minor: 0, available_minor: 0 });
  });

  it("the merchant account adds up: paid in, QuizBox's 40%, owed to teachers, refunded and paid out", async () => {
    await as(TEACHER); await fails("select public.qb_mk_admin_summary()", [], /QB_FORBIDDEN/);
    await as(FINANCE);
    const s = await rpc("select public.qb_mk_admin_summary()");
    expect(s).toMatchObject({ gross_minor: 4000, platform_fee_minor: 1600, seller_share_minor: 2400, sales_count: 2, refunded_minor: 2500, refunded_count: 2, paid_out_minor: 3600, payouts_requested_count: 0 });
    expect(s.gross_minor).toBe(s.platform_fee_minor + s.seller_share_minor);
    expect(s.items).toMatchObject({ approved: 3 });
  });

  it("a seller can take a set off sale; a suspended seller's sets vanish and cannot be edited; an unverified seller cannot submit", async () => {
    const mine = ((await owner("select jsonb_agg(id) from public.mk_items where title='Chem End Of Term'")) as string[])[0];
    await as(TEACHER); await rpc("select public.qb_mk_item_unlist($1)", [mine]);
    await as(null); expect(await rpc("select public.qb_mk_catalog('Chem End Of Term')")).toEqual([]);
    await seller(BUYER, "Yaw Buyer", "Wesley Girls");                                                             // a new teacher: pending
    const it = await rpc("select public.qb_mk_item_save(null,'Biology Term 1','x','Biology','SHS2','Term 1','Wesley Girls',1000)");
    await rpc("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, qs(10, "Bio")]);
    await fails("select public.qb_mk_item_submit($1)", [it.id], /QB_SELLER_NOT_VERIFIED/);
    const t2 = (await owner("select id from public.mk_sellers where user_id=$1", [TEACHER2])) as string;
    await as(OWNER); await fails("select public.qb_mk_admin_seller_set($1,'suspended','')", [t2], /QB_REASON_REQUIRED/);
    await rpc("select public.qb_mk_admin_seller_set($1,'suspended','Reported for copied questions')", [t2]);
    await as(TEACHER2); await fails("select public.qb_mk_item_save(null,'Another Set','x','Maths','SHS1','Term 1','Achimota School',1000)", [], /QB_SELLER_SUSPENDED/);
    await as(null); expect(await rpc("select public.qb_mk_catalog('Maths')")).toEqual([]);
  });

  it("rolls back the functions, keeps every sale and the money ledger, and applies again", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK);
    expect(await owner("select count(*)::int from pg_proc where proname like 'qb\\_mk\\_%'")).toBe(0);
    expect(await owner("select count(*)::int from public.mk_purchases")).toBeGreaterThan(3);
    expect(await owner("select count(*)::int from public.mk_ledger")).toBeGreaterThan(5);
    await db.exec(MIGRATION);
    expect(await owner("select count(*)::int from pg_proc where proname like 'qb\\_mk\\_%'")).toBeGreaterThan(30);
  });
});
