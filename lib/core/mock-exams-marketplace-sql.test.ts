import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIG, TOPIC, U, makeCtx, read, type Ctx } from "./mock-exams-fixture";

// Mock exams on the Marketplace (migration 20261122120000). The REAL marketplace migration is loaded; payments and the coin ledger are stubbed (they have their own tests), and no real payment is made.
// The attempt engine is a stand-in: attempts are inserted directly, which is exactly the point where the guard trigger acts.
const ROLLBACK = read("supabase/rollback/mock_exams_marketplace.sql");
const { TEACHER, TEACHER2, STUDENT, SPONSOR_OK, OWNER, BUYER, BUYER2, MINOR, TEACHER_BUYER } = U;
let c: Ctx;
beforeAll(async () => { c = await makeCtx("marketplace"); await c.verifySeller(TEACHER); });
afterAll(async () => { await c.close(); });

// A published 12-question exam (the Marketplace needs at least 10): Fractions 4 (B7), Algebra 5 and Cells 3 (B8).
async function bigExam(user = TEACHER, over: Record<string, unknown> = {}) {
  const e = await c.exam(user, { desired_total: 12, title: "JHS 2 cumulative mock one", ...over });
  const r1 = (await c.round(e.id, "B7", "MATH", TOPIC.FRAC, 4)).rounds[0], r2 = (await c.round(e.id, "B8", "MATH", TOPIC.ALG, 5)).rounds[1], r3 = (await c.round(e.id, "B8", "SCI", TOPIC.CELLS, 3)).rounds[2];
  for (const r of [r1, r2, r3]) await c.rpc("select public.qb_mock_round_pick($1,$2)", [e.id, r.id]);
  const p = await c.publish(e.id);
  return { id: e.id as string, versionId: p.version_id as string, versionNo: p.version_no as number };
}
// Lists the exam, sends it for review and has staff approve it.
async function onSale(x: { id: string }, price = 2000) {
  await c.as(TEACHER);
  const prepared = await c.rpc("select public.qb_mock_listing_prepare($1,$2,'Cumulative mock for JHS 2','Term 3')", [x.id, price]);
  await c.rpc("select public.qb_mock_listing_submit($1)", [x.id]);
  await c.as(OWNER); await c.rpc("select public.qb_mk_admin_review($1,'approve','')", [prepared.item_id]);
  return { itemId: prepared.item_id as string, slug: prepared.slug as string, price };
}
const purchaseOf = async (ref: string) => (await c.q<{ id: string; mock_version_id: string; status: string; expires_at: string }>("select id, mock_version_id, status, expires_at from public.mk_purchases where payment_reference = $1", [ref]))[0];
const insertAttempt = async (assessment: string, user: string) => { await c.reset(); await c.db.query("insert into public.attempts(assessment_id, student_user_id) values ($1,$2)", [assessment, user]); };

describe("selling an exam: the listing", () => {
  it("is prepared as a draft with the price and terms visible, and nothing is on sale until staff approve it", async () => {
    const x = await bigExam();
    await c.as(TEACHER);
    const l = await c.rpc("select public.qb_mock_listing_prepare($1,2000,'Cumulative mock for JHS 2','Term 3')", [x.id]);
    expect(l).toMatchObject({ status: "draft", price_minor: 2000, seller_share_minor: 1200, platform_fee_minor: 800, seller_share_percent: 60, access_days: 90, question_count: 12, version_no: 1, behind_current: false, grade: "B8", subject: "Multiple subjects" });
    expect(await c.rpc("select public.qb_mk_catalog()")).toEqual([]);
    expect(await c.rpc("select public.qb_mock_listing_info($1)", [l.slug])).toBeNull();
    // Re-preparing changes the same listing, it does not create a second one.
    const again = await c.rpc("select public.qb_mock_listing_prepare($1,2500,'A new description',null)", [x.id]);
    expect(again.item_id).toBe(l.item_id); expect(again.price_minor).toBe(2500);
    expect((await c.rpc("select public.qb_mock_listing_get($1)", [x.id]))).toMatchObject({ item_id: l.item_id, sales: 0 });
    await c.rpc("select public.qb_mock_listing_submit($1)", [x.id]);
    expect(await c.rpc("select public.qb_mk_catalog()")).toEqual([]);                    // waiting for review is still not on sale
    await c.as(OWNER); await c.rpc("select public.qb_mk_admin_review($1,'approve','')", [l.item_id]);
    await c.as(null); const cat = await c.rpc("select public.qb_mk_catalog()");
    expect(cat.map((i: any) => i.slug)).toContain(l.slug);
    expect(await c.rpc("select public.qb_mock_listing_kinds($1::text[])", [[l.slug, "not-a-mock-set"]])).toEqual([l.slug]);
  });

  it("shows a buyer the shape of the exam and never a question or an answer", async () => {
    const x = await bigExam(); const item = await onSale(x);
    await c.as(null);
    const info = await c.rpc("select public.qb_mock_listing_info($1)", [item.slug]);
    expect(info).toMatchObject({ mock_exam: true, version_no: 1, question_count: 12, target_grade: "B8", time_limit_minutes: 60, attempts_allowed: 1, access_days: 90 });
    expect(info.rounds.map((r: any) => [r.grade_code, r.subject_label, r.questions])).toEqual([["B7", "Mathematics", 4], ["B8", "Mathematics", 5], ["B8", "Integrated Science", 3]]);
    expect(JSON.stringify(info)).not.toMatch(/question [0-9]+ about|correct_answer|option_/);
    const pub = await c.rpc("select public.qb_mk_item_public($1)", [item.slug]);
    expect(pub.samples).toEqual([]);                                                      // the generic listing has no question stems to show
    await c.as(BUYER); await c.fails("select public.qb_mk_open($1)", [item.itemId], /QB_NOT_PURCHASED/);
  });

  it("is for teachers and verified organisation sponsors who are sellers: staff, other roles, unregistered sellers and unpublished exams are refused", async () => {
    const x = await bigExam();
    await c.as(TEACHER);
    await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [(await c.readyExam(TEACHER))], /QB_MOCK_NOT_PUBLISHED/);
    await c.fails("select public.qb_mock_listing_prepare($1,50,null,null)", [x.id], /QB_PRICE_INVALID/);
    await c.fails("select public.qb_mock_listing_prepare($1,2050,null,null)", [x.id], /QB_PRICE_INVALID/);
    await c.as(TEACHER2);
    const theirs = await c.publishedExam(TEACHER2);
    await c.as(TEACHER2); await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [theirs.id], /QB_NOT_A_SELLER/);
    await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id], /QB_NOT_FOUND/);
    await c.as(SPONSOR_OK);
    const sp = await c.publishedExam(SPONSOR_OK); await c.as(SPONSOR_OK);
    await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [sp.id], /QB_NOT_A_SELLER/);       // a sponsor must register as a seller first, like a teacher
    await c.as(OWNER);
    const st = await c.rpc("select public.qb_mock_exam_create($1::jsonb)", [JSON.stringify({ title: "Staff mock for sale", curriculum_id: (await c.q<{ id: string }>("select id from public.curricula limit 1"))[0].id, target_grade: "B8", desired_total: 5 })]);
    await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [st.id], /QB_MOCK_SELL_NOT_ALLOWED/);
    await c.as(STUDENT); await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id], /QB_MOCK_AUTHOR_FORBIDDEN/);
    await c.setFlag("flags.marketplace", false); await c.as(TEACHER);
    await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id], /QB_FEATURE_DISABLED/);
    await c.setFlag("flags.marketplace", true);
  });

  it("lets a verified organisation sponsor register as a seller and sell an exam under the same Marketplace rules; unverified and individual sponsors cannot", async () => {
    const reg = "select public.qb_mk_seller_save('Org Sponsor','Opoku Org','0244000000','mobile_money','MTN','0244000000','Org Sponsor',true)";
    await c.as(U.SPONSOR_NEW); await c.fails(reg, [], /QB_TEACHERS_ONLY/);                  // verification still pending
    await c.as(U.SPONSOR_IND); await c.fails(reg, [], /QB_TEACHERS_ONLY/);                  // an individual, not an organisation
    await c.as(STUDENT); await c.fails(reg, [], /QB_TEACHERS_ONLY/);
    await c.setFlag("flags.mock_exams", false); await c.as(SPONSOR_OK); await c.fails(reg, [], /QB_TEACHERS_ONLY|QB_FEATURE_DISABLED/);   // closed with the feature, as before
    await c.setFlag("flags.mock_exams", true);
    await c.verifySeller(SPONSOR_OK);
    const e = await c.exam(SPONSOR_OK, { desired_total: 12, title: "Sponsor cumulative mock for sale" });
    const r1 = (await c.round(e.id, "B7", "MATH", TOPIC.FRAC, 4)).rounds[0], r2 = (await c.round(e.id, "B8", "MATH", TOPIC.ALG, 5)).rounds[1], r3 = (await c.round(e.id, "B8", "SCI", TOPIC.CELLS, 3)).rounds[2];
    for (const r of [r1, r2, r3]) await c.rpc("select public.qb_mock_round_pick($1,$2)", [e.id, r.id]);
    await c.publish(e.id); await c.as(SPONSOR_OK);
    const l = await c.rpc("select public.qb_mock_listing_prepare($1,2000,'Sponsor mock','Term 3')", [e.id]);
    expect(l).toMatchObject({ status: "draft", price_minor: 2000, seller_share_minor: 1200, platform_fee_minor: 800 });   // the same 60/40 split
    await c.fails("select public.qb_mock_listing_prepare($1,50,null,null)", [e.id], /QB_PRICE_INVALID/);                 // the same price limits
    await c.rpc("select public.qb_mock_listing_submit($1)", [e.id]);
    expect(await c.rpc("select public.qb_mk_catalog()")).not.toContainEqual(expect.objectContaining({ slug: l.slug }));  // still needs staff review
    await c.as(OWNER); await c.rpc("select public.qb_mk_admin_review($1,'approve','')", [l.item_id]);
    await c.as(null); expect((await c.rpc("select public.qb_mk_catalog()")).map((i: any) => i.slug)).toContain(l.slug);
  });

  it("needs a verified seller and at least the Marketplace's minimum number of questions to go for review", async () => {
    const small = await c.publishedExam(TEACHER);                                          // 6 questions
    await c.as(TEACHER);
    await c.rpc("select public.qb_mock_listing_prepare($1,2000,null,null)", [small.id]);
    await c.fails("select public.qb_mock_listing_submit($1)", [small.id], /QB_TOO_FEW_QUESTIONS/);
    await c.fails("select public.qb_mock_listing_submit($1)", [(await c.publishedExam(TEACHER)).id], /QB_MOCK_NOT_LISTED/);
    await c.seller(TEACHER2, "Kojo Boateng", "Achimota School");                          // registered but not verified
    const x = await bigExam(TEACHER2); await c.as(TEACHER2);
    await c.rpc("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id]);
    await c.fails("select public.qb_mock_listing_submit($1)", [x.id], /QB_SELLER_NOT_VERIFIED/);
  });

  it("gives staff the real content to review, and the generic review stays empty", async () => {
    const x = await bigExam(); await c.as(TEACHER);
    const l = await c.rpc("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id]);
    await c.as(OWNER);
    const a = await c.rpc("select public.qb_mock_admin_listing($1)", [l.item_id]);
    expect(a).toMatchObject({ version_no: 1, question_count: 12, stale_questions: 0 }); expect(a.questions).toHaveLength(12);
    expect(a.questions[0]).toMatchObject({ position: 1, answer_type: "SINGLE_CHOICE", correct_answer: "A: one" });
    expect((await c.rpc("select public.qb_mk_admin_item($1)", [l.item_id])).questions).toEqual([]);
    await c.as(TEACHER); await c.fails("select public.qb_mock_admin_listing($1)", [l.item_id], /QB_FORBIDDEN/);
    await c.as(OWNER); expect(await c.rpc("select public.qb_mock_admin_listing($1)", [(await c.q<{ id: string }>("select id from public.mk_items where mock_exam_id is null limit 1"))[0]?.id ?? "00000000-0000-4000-8000-000000000999"])).toBeNull();
  });

  it("never lets a question copy be attached to a mock listing", async () => {
    const x = await bigExam(); await c.as(TEACHER);
    const l = await c.rpc("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id]);
    const qs = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ question_text: `Smuggled question number ${i + 1}?`, options: ["one", "two", "three", "four"], correct_index: 0 })));
    await c.fails("select public.qb_mk_item_questions_set($1,$2::jsonb)", [l.item_id, qs], /QB_MOCK_ITEM_HAS_NO_QUESTION_COPY/);
    expect(await c.q("select count(*)::int as n from public.mk_questions where item_id = $1", [l.item_id])).toEqual([{ n: 0 }]);
  });
});

describe("buying an exam: entitlement and delivery", () => {
  it("opens the buyer's own copy of the PURCHASED version when the payment settles, once, however often the payment is retried", async () => {
    const x = await bigExam(); const item = await onSale(x);
    const { ref, out } = await c.pay(BUYER, { id: item.itemId }, item.price);
    expect(out).toMatchObject({ outcome: "fulfilled", seller_share_minor: 1200, platform_fee_minor: 800 });
    const pur = await purchaseOf(ref);
    expect(pur.mock_version_id).toBe(x.versionId);
    const en = await c.q<{ assessment_id: string; version_id: string; student_user_id: string; exam_id: string }>("select * from public.mock_exam_enrolments where purchase_id = $1", [pur.id]);
    expect(en).toHaveLength(1); expect(en[0]).toMatchObject({ version_id: x.versionId, student_user_id: BUYER, exam_id: x.id });
    const a = (await c.q("select assessment_type, reference_type, owner_user_id, question_count, max_attempts, time_limit_minutes, expires_at, grade_code from public.assessments where id = $1", [en[0].assessment_id]))[0];
    expect(a).toMatchObject({ assessment_type: "ASSESSMENT", reference_type: "MOCK_EXAM", owner_user_id: BUYER, question_count: 12, max_attempts: 1, time_limit_minutes: 60, grade_code: "B8" });
    expect(new Date(a.expires_at).getTime()).toBe(new Date(pur.expires_at).getTime());                 // the exam window is the 90 days that were paid for
    expect((await c.q("select count(*)::int as n from public.assessment_questions where assessment_id = $1", [en[0].assessment_id]))[0].n).toBe(12);
    // A retried webhook or a second call changes nothing.
    await c.reset(); expect((await c.rpc("select public.qb_mk_fulfil_purchase($1)", [ref])).outcome).toBe("already_fulfilled");
    expect((await c.q("select count(*)::int as n from public.mock_exam_enrolments where exam_id = $1", [x.id]))[0].n).toBe(1);
    expect((await c.q("select count(*)::int as n from public.mk_purchases where payment_reference = $1", [ref]))[0].n).toBe(1);
    await c.as(BUYER);
    const s1 = await c.rpc("select public.qb_mock_start_purchased($1)", [pur.id]), s2 = await c.rpc("select public.qb_mock_start_purchased($1)", [pur.id]);
    expect(s1.assessment_id).toBe(en[0].assessment_id); expect(s2.assessment_id).toBe(s1.assessment_id);
    const mine = await c.rpc("select public.qb_mock_my_purchases()");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ purchase_id: pur.id, active: true, version_no: 1, question_count: 12, attempts_allowed: 1, attempts_used: 0, in_progress_attempt: null, last_attempt: null });
  });

  it("starts only for the buyer, only while the purchase is active, and only for a learner", async () => {
    const x = await bigExam(); const item = await onSale(x);
    const { ref } = await c.pay(BUYER, { id: item.itemId }, item.price); const pur = await purchaseOf(ref);
    await c.as(BUYER2); await c.fails("select public.qb_mock_start_purchased($1)", [pur.id], /QB_NOT_FOUND/);
    await c.as(null); await c.fails("select public.qb_mock_start_purchased($1)", [pur.id], /permission denied/);
    await c.as(MINOR); await c.fails("select public.qb_mk_prepare_purchase($1)", [item.itemId], /QB_MINOR_CANNOT_PAY/);                      // the existing rule: a child cannot pay
    await c.as(TEACHER); await c.fails("select public.qb_mk_prepare_purchase($1)", [item.itemId], /QB_OWN_ITEM/);
    const t = await c.pay(TEACHER_BUYER, { id: item.itemId }, item.price); const tp = await purchaseOf(t.ref);
    await c.as(TEACHER_BUYER); await c.fails("select public.qb_mock_start_purchased($1)", [tp.id], /QB_STUDENT_REQUIRED/);
    await c.as(BUYER); await c.fails("select public.qb_mk_prepare_purchase($1)", [item.itemId], /QB_ALREADY_OWNED/);
    await c.q("update public.mk_purchases set expires_at = now() - interval '1 minute' where id = $1", [pur.id]);
    await c.as(BUYER); await c.fails("select public.qb_mock_start_purchased($1)", [pur.id], /QB_MOCK_ENTITLEMENT_REQUIRED/);
    expect((await c.rpc("select public.qb_mock_my_purchases()"))[0]).toMatchObject({ active: false, days_left: 0 });
  });

  it("refuses an attempt without a live purchase: another user, a refunded buyer, an expired purchase; and leaves every other assessment alone", async () => {
    const x = await bigExam(); const item = await onSale(x);
    const { ref } = await c.pay(BUYER, { id: item.itemId }, item.price); const pur = await purchaseOf(ref);
    const asmt = (await c.q<{ assessment_id: string }>("select assessment_id from public.mock_exam_enrolments where purchase_id = $1", [pur.id]))[0].assessment_id;
    await expect(insertAttempt(asmt, BUYER2)).rejects.toThrow(/QB_MOCK_ENTITLEMENT_REQUIRED/);                 // knowing the assessment id is not enough
    await expect(insertAttempt(asmt, STUDENT)).rejects.toThrow(/QB_MOCK_ENTITLEMENT_REQUIRED/);
    await insertAttempt(asmt, BUYER);                                                                          // the buyer may
    await c.reset(); await c.rpc("select public.qb_mk_reverse_purchase($1,'refunded')", [ref]);
    await expect(insertAttempt(asmt, BUYER)).rejects.toThrow(/QB_MOCK_ENTITLEMENT_REQUIRED/);                  // a refund ends new attempts
    await c.as(BUYER); await c.fails("select public.qb_mock_start_purchased($1)", [pur.id], /QB_MOCK_ENTITLEMENT_REQUIRED/);
    expect((await c.rpc("select public.qb_mock_my_purchases()"))[0]).toMatchObject({ active: false, status: "reversed", attempts_used: 1 });
    // Existing behaviour is unchanged: an attempt on an ordinary assessment is not touched by the guard.
    await c.reset();
    const plain = (await c.db.query<{ id: string }>("insert into public.assessments(assessment_type, reference_type, question_count) values ('PRACTICE','SELF_PRACTICE',3) returning id")).rows[0].id;
    await insertAttempt(plain, BUYER2);
  });

  it("keeps the version that was bought when the author publishes a newer one, and sells the newer one only after the listing is renewed", async () => {
    const x = await bigExam(); const item = await onSale(x);
    const first = await c.pay(BUYER, { id: item.itemId }, item.price); const p1 = await purchaseOf(first.ref);
    await c.as(TEACHER);
    await c.rpc("select public.qb_mock_exam_update($1,$2::jsonb)", [x.id, JSON.stringify({ time_limit_minutes: 90 })]);
    const v2 = await c.rpc("select public.qb_mock_exam_publish($1)", [x.id]);
    expect(v2.version_no).toBe(2);
    expect(await c.rpc("select public.qb_mock_listing_get($1)", [x.id])).toMatchObject({ version_no: 1, behind_current: true, sales: 1 });
    const second = await c.pay(BUYER2, { id: item.itemId }, item.price); const p2 = await purchaseOf(second.ref);
    expect(p2.mock_version_id).toBe(x.versionId);                                                              // the listing still sells version 1
    await c.as(TEACHER); await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id], /QB_ITEM_LOCKED/);       // on sale: take it off sale first
    await c.rpc("select public.qb_mock_listing_unlist($1)", [x.id]);
    const renewed = await c.rpc("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id]);
    expect(renewed).toMatchObject({ version_no: 2, behind_current: false, status: "draft" });
    await c.rpc("select public.qb_mock_listing_submit($1)", [x.id]);
    await c.as(OWNER); await c.rpc("select public.qb_mk_admin_review($1,'approve','')", [item.itemId]);
    await c.reset(); await c.q("update public.mk_purchases set status = 'reversed' where id = $1", [p2.id]);                   // allow BUYER2 to buy again in this test
    const third = await c.pay(BUYER2, { id: item.itemId }, item.price); const p3 = await purchaseOf(third.ref);
    expect(p3.mock_version_id).toBe(v2.version_id);
    expect((await purchaseOf(first.ref)).mock_version_id).toBe(x.versionId);                                   // the first buyer still holds version 1
    expect((await c.q<{ time_limit_minutes: number }>("select a.time_limit_minutes from public.mock_exam_enrolments e join public.assessments a on a.id = e.assessment_id where e.purchase_id = $1", [p1.id]))[0].time_limit_minutes).toBe(60);
    expect((await c.q<{ time_limit_minutes: number }>("select a.time_limit_minutes from public.mock_exam_enrolments e join public.assessments a on a.id = e.assessment_id where e.purchase_id = $1", [p3.id]))[0].time_limit_minutes).toBe(90);
  });

  it("leaves an ordinary question set exactly as it was: same sale, no version, no enrolment, answers still opened for its buyer", async () => {
    await c.as(TEACHER);
    const it = await c.rpc("select public.qb_mk_item_save(null,'Ordinary end of term set','Plain set','Chemistry','SHS1','Term 2','Opoku Ware School',2000)");
    const qs = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ question_text: `Ordinary question number ${i + 1} about acids?`, options: ["one", "two", "three", "four"], correct_index: i % 4, explanation: "because" })));
    await c.rpc("select public.qb_mk_item_questions_set($1,$2::jsonb)", [it.id, qs]); await c.rpc("select public.qb_mk_item_submit($1)", [it.id]);
    await c.as(OWNER); await c.rpc("select public.qb_mk_admin_review($1,'approve','')", [it.id]);
    const { ref, out } = await c.pay(BUYER2, { id: it.id }, 2000);
    expect(out).toMatchObject({ outcome: "fulfilled", seller_share_minor: 1200 });
    const pur = await purchaseOf(ref);
    expect(pur.mock_version_id).toBeNull();
    expect(await c.q("select 1 from public.mock_exam_enrolments where purchase_id = $1", [pur.id])).toEqual([]);
    await c.as(BUYER2); expect((await c.rpc("select public.qb_mk_open($1)", [it.id])).questions).toHaveLength(12);
    expect((await c.rpc("select public.qb_mock_my_purchases()")).map((x: any) => x.item_id)).not.toContain(it.id);      // the exam list shows exams only
    await c.as(null); expect(await c.rpc("select public.qb_mock_listing_info($1)", [it.slug])).toBeNull();
  });

  it("does not block a sale when a question changed after publishing: the buyer gets a clear message and the sale stands", async () => {
    const x = await bigExam(); const item = await onSale(x);
    const q = (await c.q<{ question_id: string }>("select question_id from public.mock_exam_version_questions where version_id = $1 limit 1", [x.versionId]))[0].question_id;
    await c.q("update public.questions set version = 2, status = 'inactive', validation_status = 'review' where id = $1", [q]);
    const { ref, out } = await c.pay(BUYER, { id: item.itemId }, item.price);
    expect(out.outcome).toBe("fulfilled");
    const pur = await purchaseOf(ref);
    expect(await c.q("select 1 from public.mock_exam_enrolments where purchase_id = $1", [pur.id])).toEqual([]);
    await c.as(BUYER); await c.fails("select public.qb_mock_start_purchased($1)", [pur.id], /QB_MOCK_VERSION_STALE/);
    await c.as(OWNER); expect((await c.rpc("select public.qb_mock_admin_listing($1)", [item.itemId])).stale_questions).toBe(1);        // staff can see it too
  });

  it("takes the listing off sale when the exam is archived, while purchases already made keep working", async () => {
    const x = await bigExam(); const item = await onSale(x);
    const { ref } = await c.pay(BUYER, { id: item.itemId }, item.price); const pur = await purchaseOf(ref);
    await c.as(TEACHER); await c.rpc("select public.qb_mock_exam_archive($1)", [x.id]);
    expect((await c.rpc("select public.qb_mock_listing_get($1)", [x.id])).status).toBe("unlisted");
    await c.as(null); expect((await c.rpc("select public.qb_mk_catalog()")).map((i: any) => i.slug)).not.toContain(item.slug);
    await c.as(BUYER2); await c.fails("select public.qb_mk_prepare_purchase($1)", [item.itemId], /QB_NOT_FOUND/);
    await c.as(BUYER); expect((await c.rpc("select public.qb_mock_start_purchased($1)", [pur.id])).assessment_id).toBeTruthy();
    await c.as(TEACHER); await c.fails("select public.qb_mock_listing_prepare($1,2000,null,null)", [x.id], /QB_MOCK_ARCHIVED/);
  });
});

describe("selling an exam: what the seller can see of buyers", () => {
  it("shows buyers' results without names, emails or schools, and counts them in participation", async () => {
    const x = await bigExam(); const item = await onSale(x);
    const b1 = await c.pay(BUYER, { id: item.itemId }, item.price), b2 = await c.pay(BUYER2, { id: item.itemId }, item.price);
    const asm = async (ref: string) => (await c.q<{ assessment_id: string }>("select e.assessment_id from public.mock_exam_enrolments e join public.mk_purchases p on p.id = e.purchase_id where p.payment_reference = $1", [ref]))[0].assessment_id;
    const [a1, a2] = [await asm(b1.ref), await asm(b2.ref)];
    const qids = (await c.q<{ question_id: string }>("select question_id from public.mock_exam_version_questions where version_id = $1 order by position", [x.versionId])).map((r) => r.question_id);
    const answers = (n: number) => qids.map((q, i) => ({ question_id: q, selected_answer: i < n ? "A" : "C", is_correct: i < n }));
    await c.attempt({ assessmentId: a1, student: BUYER, answers: answers(12) });
    await c.attempt({ assessmentId: a2, student: BUYER2, answers: answers(6) });
    // The assessments' own questions are what the buyer saw; the review reads the version's.
    await c.as(TEACHER);
    const r = await c.rpc("select public.qb_mock_results($1,null)", [x.id]);
    expect(r.summary).toMatchObject({ assigned: 2, started: 2, finished: 2, average_percent: 75, highest_percent: 100, lowest_percent: 50 });
    expect(r.participants.map((p: any) => [p.participant, p.group, p.source]).sort()).toEqual([["Buyer 1", "Marketplace", "market"], ["Buyer 2", "Marketplace", "market"]]);
    const everything = JSON.stringify(r) + JSON.stringify(await c.rpc("select public.qb_mock_result_rows($1)", [x.id])) + JSON.stringify(await c.rpc("select public.qb_mock_export($1)", [x.id]));
    expect(everything).not.toMatch(/Yaw|Akua|Buyer@|@example\.com|b1@|b2@/);
    expect((await c.rpc("select public.qb_mock_result_rows($1)", [x.id])).total).toBe(24);
    const exp = await c.rpc("select public.qb_mock_export($1)", [x.id]);
    expect(exp.rows[0].slice(4, 6)).toEqual(["Marketplace", "Buyer 1"]);
    await c.as(TEACHER2); await c.fails("select public.qb_mock_results($1,null)", [x.id], /QB_NOT_FOUND/);
  });
});

describe("rollback", () => {
  it("can be rolled back and re-applied, keeping the records and the sales", async () => {
    await c.reset();
    await c.db.exec(MIG.marketplaceMock);
    await c.db.exec(ROLLBACK);
    expect((await c.db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname in ('qb_mock_start_purchased','qb_mock_listing_prepare','qb_mock_listing_info')")).rows[0].n).toBe(0);
    expect((await c.db.query<{ n: number }>("select count(*)::int as n from pg_trigger where tgname in ('attempts_mock_entitlement','mk_purchases_mock_enrol')")).rows[0].n).toBe(0);
    expect((await c.db.query<{ d: string }>("select pg_get_functiondef('public.qb_mk_seller_save(text,text,text,text,text,text,text,boolean)'::regprocedure) as d")).rows[0].d).not.toMatch(/SPONSOR|mock_exams/);   // teachers-only sign-up is back
    expect((await c.db.query<{ n: number }>("select count(*)::int as n from public.mk_purchases where mock_version_id is not null")).rows[0].n).toBeGreaterThan(0);
    await c.db.exec(MIG.marketplaceMock);
  });
});
