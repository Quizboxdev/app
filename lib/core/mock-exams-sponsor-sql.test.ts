import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIG, U, makeCtx, read, type Ctx } from "./mock-exams-fixture";

// Mock exams, sponsor delivery (migration 20261124110000): a gift to the family, and a shared link with paid places. The REAL marketplace and mock-exam migrations are loaded; the wallet, the family permission
// check and the attempt engine are stand-ins (they have their own tests), and no real payment is made.
const ROLLBACK = read("supabase/rollback/mock_exams_sponsor_delivery.sql");
const { TEACHER, STUDENT, SPONSOR_OK, SPONSOR_NEW, SPONSOR_IND, SPONSOR_ALUMNI, SPONSOR_PARENT, KID, KID2, KID_NO_ASSIGN, JOINER1, JOINER2, JOINER3, MANAGED } = U;
let c: Ctx;
beforeAll(async () => { c = await makeCtx("sponsor"); });
afterAll(async () => { await c.close(); });

const balance = async (u: string) => Number((await c.q<{ balance: string }>("select balance from public.stub_wallet where user_id = $1", [u]))[0].balance);
const setBalance = async (u: string, n: number) => { await c.q("insert into public.stub_wallet values ($1,$2) on conflict (user_id) do update set balance = excluded.balance", [u, n]); };
const copyOf = async (grantId: string) => (await c.q<{ assessment_id: string }>("select assessment_id from public.mock_exam_enrolments where grant_id = $1", [grantId]))[0]?.assessment_id;
const answerSheet = async (assessmentId: string, right: number) => (await c.q<{ question_id: string }>("select question_id from public.assessment_questions where assessment_id = $1 order by question_order", [assessmentId]))
  .map((r, i) => ({ question_id: r.question_id, selected_answer: i < right ? "A" : "C", is_correct: i < right }));
const startAs = async (u: string, grantId: string) => { await c.as(u); return (await c.rpc("select public.qb_mock_start_granted($1)", [grantId])).assessment_id as string; };
const grantsOf = async (u: string) => { await c.as(u); return (await c.rpc("select public.qb_mock_my_grants()")) as any[]; };

describe("who may build an exam to give away", () => {
  it("lets a parent or alumni family with a workspace, and a verified alumni or organisation sponsor, build; not an unverified or individual sponsor with no family", async () => {
    for (const u of [SPONSOR_PARENT, SPONSOR_ALUMNI, SPONSOR_OK]) { await c.as(u); expect(await c.rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: true, kind: "sponsor" }); }
    for (const u of [SPONSOR_NEW, SPONSOR_IND]) { await c.as(u); expect(await c.rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: false, reason: "QB_MOCK_SPONSOR_NOT_VERIFIED" }); }
    await c.setFlag("flags.family_workspace", false); await c.as(SPONSOR_PARENT);
    expect(await c.rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: false, reason: "QB_MOCK_SPONSOR_NOT_VERIFIED" });   // the family route closes with the workspace
    await c.setFlag("flags.family_workspace", true);
  });
});

describe("giving an exam to the family", () => {
  it("gives the exam to the children the sponsor may assign work to, free, as each child's own private copy", async () => {
    const x = await c.publishedExam(SPONSOR_PARENT); await c.as(SPONSOR_PARENT);
    const given = await c.rpc("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID, KID2]]);
    expect(given).toMatchObject({ given: 2, already: 0, version_no: 1, days: 90 });
    const mine = await grantsOf(KID);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ source: "family", from: "Mrs Parent", active: true, version_no: 1, question_count: 6, attempts_used: 0 });
    expect(mine[0].days_left).toBeGreaterThanOrEqual(89);
    const a = await startAs(KID, mine[0].grant_id);
    expect((await c.q("select 1 from public.assessments where id = $1 and owner_user_id = $2 and reference_type = 'MOCK_EXAM'", [a, KID])).length).toBe(1);
    expect((await c.q("select 1 from public.assessment_questions where assessment_id = $1", [a])).length).toBe(6);
    // The second child has her own, different copy.
    const b = await startAs(KID2, (await grantsOf(KID2))[0].grant_id);
    expect(b).not.toBe(a);
    // Giving it again changes nothing.
    await c.as(SPONSOR_PARENT);
    expect(await c.rpc("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID, KID2]])).toMatchObject({ given: 0, already: 2 });
    expect((await c.rpc("select public.qb_mock_family_given($1)", [x.id])).map((g: any) => g.name).sort()).toEqual(["Ama Child", "Kofi Child"]);
  });

  it("is all or nothing: a child the sponsor may not assign work to, or a stranger, stops the whole gift", async () => {
    const x = await c.publishedExam(SPONSOR_PARENT); await c.as(SPONSOR_PARENT);
    await c.fails("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID, KID_NO_ASSIGN]], /QB_FAMILY_FORBIDDEN/);      // a sponsor link carries no assign permission
    await c.fails("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID, STUDENT]], /QB_FAMILY_FORBIDDEN/);
    await c.fails("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, []], /QB_FAMILY_FORBIDDEN/);
    expect(await c.q("select 1 from public.mock_exam_grants where exam_id = $1", [x.id])).toEqual([]);
  });

  it("needs a published exam, an open Family workspace and the exam's own sponsor", async () => {
    const draft = await c.readyExam(SPONSOR_PARENT); await c.as(SPONSOR_PARENT);
    await c.fails("select public.qb_mock_family_give($1,$2::uuid[])", [draft, [KID]], /QB_MOCK_NOT_PUBLISHED/);
    const x = await c.publishedExam(SPONSOR_PARENT);
    await c.as(SPONSOR_ALUMNI); await c.fails("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID]], /QB_NOT_FOUND/);
    await c.setFlag("flags.family_workspace", false); await c.as(SPONSOR_PARENT);
    await c.fails("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID]], /QB_MOCK_SPONSOR_NOT_VERIFIED|QB_FEATURE_DISABLED/);
    await c.setFlag("flags.family_workspace", true);
  });

  it("refuses an attempt to anyone who was not given it, and to a child after the gift is taken back; answers already given stay", async () => {
    const x = await c.publishedExam(SPONSOR_PARENT); await c.as(SPONSOR_PARENT);
    await c.rpc("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID]]);
    const grant = (await grantsOf(KID))[0], a = await startAs(KID, grant.grant_id);
    await c.reset(); await c.db.query("insert into public.attempts(assessment_id, student_user_id) values ($1,$2)", [a, KID]);                       // the child may start
    await expect(c.db.query("insert into public.attempts(assessment_id, student_user_id) values ($1,$2)", [a, STUDENT])).rejects.toThrow(/QB_MOCK_ENTITLEMENT_REQUIRED/);
    await c.as(KID2); await c.fails("select public.qb_mock_start_granted($1)", [grant.grant_id], /QB_NOT_FOUND/);
    await c.as(SPONSOR_PARENT); expect(await c.rpc("select public.qb_mock_family_revoke($1,$2)", [x.id, KID])).toEqual({ revoked: 1 });
    await c.reset(); await expect(c.db.query("insert into public.attempts(assessment_id, student_user_id) values ($1,$2)", [a, KID])).rejects.toThrow(/QB_MOCK_ENTITLEMENT_REQUIRED/);
    await c.as(KID); await c.fails("select public.qb_mock_start_granted($1)", [grant.grant_id], /QB_MOCK_ENTITLEMENT_REQUIRED/);
    expect((await c.q("select 1 from public.attempts where assessment_id = $1", [a])).length).toBe(1);
    // A gift that ran out of time is refused too.
    await c.as(SPONSOR_PARENT); await c.rpc("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID]]);                                      // a fresh gift after the old one was taken back
    const again = (await grantsOf(KID)).find((g: any) => g.active)!;
    await c.q("update public.mock_exam_grants set expires_at = now() - interval '1 day' where id = $1", [again.grant_id]);
    await c.as(KID); await c.fails("select public.qb_mock_start_granted($1)", [again.grant_id], /QB_MOCK_ENTITLEMENT_REQUIRED/);
  });

  it("shows the sponsor how each child did, with their names, and nobody else", async () => {
    const x = await c.publishedExam(SPONSOR_PARENT); await c.as(SPONSOR_PARENT);
    await c.rpc("select public.qb_mock_family_give($1,$2::uuid[])", [x.id, [KID, KID2]]);
    const [g1, g2] = [(await grantsOf(KID))[0].grant_id, (await grantsOf(KID2))[0].grant_id];
    const [a1, a2] = [await startAs(KID, g1), await startAs(KID2, g2)];
    await c.attempt({ assessmentId: a1, student: KID, answers: await answerSheet(a1, 6) });
    await c.attempt({ assessmentId: a2, student: KID2, answers: await answerSheet(a2, 3) });
    await c.as(SPONSOR_PARENT);
    const r = await c.rpc("select public.qb_mock_results($1,null)", [x.id]);
    expect(r.summary).toMatchObject({ assigned: 2, finished: 2, average_percent: 75, highest_percent: 100, lowest_percent: 50 });
    expect(r.participants.map((p: any) => [p.participant, p.source, p.group]).sort()).toEqual([["Ama Child", "family", "Family"], ["Kofi Child", "family", "Family"]]);
    await c.as(SPONSOR_ALUMNI); await c.fails("select public.qb_mock_results($1,null)", [x.id], /QB_NOT_FOUND/);
    // A child sees only their own gift.
    const seen = (await grantsOf(KID2)).map((g: any) => g.grant_id);
    expect(seen).toContain(g2); expect(seen).not.toContain(g1);
  });
});

describe("sharing by link with paid places", () => {
  let x: { id: string; versionId: string };
  const make = async (seats = 2, user = SPONSOR_ALUMNI) => { await c.as(user); return c.rpc("select public.qb_mock_link_create($1,$2,null)", [x.id, seats]); };
  beforeAll(async () => { x = await c.publishedExam(SPONSOR_ALUMNI); });

  it("takes the Coins for every place up front, and gives a link that names the exam and the places, but no question", async () => {
    await setBalance(SPONSOR_ALUMNI, 100);
    const l = await make(3);
    expect(l).toMatchObject({ seats_paid: 3, coins_paid: 3, joined: 0, status: "open", version_no: 1, behind_current: false });
    expect(l.code).toMatch(/^[a-z0-9]{10}$/); expect(l.path).toBe(`/mock-exams/join/${l.code}`);
    expect(await balance(SPONSOR_ALUMNI)).toBe(97);
    await c.as(JOINER1);
    const info = await c.rpc("select public.qb_mock_link_info($1)", [l.code]);
    expect(info).toMatchObject({ title: "JHS 2 BECE readiness mock", from: "Old Students Association", question_count: 6, open: true, full: false, joined: false, mine: false, access_days: 90 });
    expect(JSON.stringify(info)).not.toMatch(/question [0-9]+ about|correct_answer|option_/);
    expect(await c.rpc("select public.qb_mock_link_info($1)", ["nosuchcode"])).toBeNull();
    await c.as(null); await c.fails("select public.qb_mock_link_info($1)", [l.code], /permission denied/);
    await c.as(SPONSOR_ALUMNI);
    const list = await c.rpc("select public.qb_mock_links($1)", [x.id]);
    expect(list).toMatchObject({ enabled: true, eligible: true, coins_per_seat: 1, max_seats: 1000 }); expect(list.links.map((k: any) => k.id)).toContain(l.id);
  });

  it("is for verified organisation and alumni sponsors only, with sensible numbers and the wallet able to pay", async () => {
    await setBalance(SPONSOR_ALUMNI, 100);
    await c.as(SPONSOR_PARENT); const px = await c.publishedExam(SPONSOR_PARENT); await c.as(SPONSOR_PARENT);
    await c.fails("select public.qb_mock_link_create($1,5,null)", [px.id], /QB_MOCK_LINK_SPONSORS_ONLY/);                   // a parent gives to the family; selling or sharing wider is for organisations
    await c.as(TEACHER); const tx = await c.publishedExam(TEACHER); await c.as(TEACHER);
    await c.fails("select public.qb_mock_link_create($1,5,null)", [tx.id], /QB_MOCK_LINK_SPONSORS_ONLY/);
    await c.as(SPONSOR_ALUMNI);
    for (const seats of [0, -1, 1001]) await c.fails("select public.qb_mock_link_create($1,$2,null)", [x.id, seats], /QB_MOCK_LINK_INVALID/);
    await c.fails("select public.qb_mock_link_create($1,5,now() - interval '1 hour')", [x.id], /QB_MOCK_LINK_INVALID/);
    await c.fails("select public.qb_mock_link_create($1,5,now() + interval '400 days')", [x.id], /QB_MOCK_LINK_INVALID/);
    const before = (await c.q<{ n: number }>("select count(*)::int as n from public.mock_exam_links"))[0].n;
    await setBalance(SPONSOR_ALUMNI, 2); await c.as(SPONSOR_ALUMNI);
    await c.fails("select public.qb_mock_link_create($1,5,null)", [x.id], /QB_INSUFFICIENT_BALANCE/);                         // nothing is created when the Coins are short
    expect((await c.q<{ n: number }>("select count(*)::int as n from public.mock_exam_links"))[0].n).toBe(before); expect(await balance(SPONSOR_ALUMNI)).toBe(2);
    await setBalance(SPONSOR_ALUMNI, 100); await c.setFlag("flags.mock_exam_links", false); await c.as(SPONSOR_ALUMNI);
    await c.fails("select public.qb_mock_link_create($1,5,null)", [x.id], /QB_FEATURE_DISABLED/);
    await c.setFlag("flags.mock_exam_links", true);
  });

  it("lets people in until the places are used, never twice, and then says it is full", async () => {
    await setBalance(SPONSOR_ALUMNI, 100);
    const l = await make(2);
    await c.as(JOINER1); const j1 = await c.rpc("select public.qb_mock_link_join($1)", [l.code]);
    expect(j1).toMatchObject({ ok: true, already: false });
    expect(await c.rpc("select public.qb_mock_link_join($1)", [l.code])).toMatchObject({ ok: true, already: true, grant_id: j1.grant_id });     // the same person again takes no second place
    await c.as(JOINER2); expect(await c.rpc("select public.qb_mock_link_join($1)", [l.code])).toMatchObject({ already: false });
    await c.as(JOINER3); await c.fails("select public.qb_mock_link_join($1)", [l.code], /QB_MOCK_LINK_FULL/);
    expect(await c.rpc("select public.qb_mock_link_info($1)", [l.code])).toMatchObject({ full: true, joined: false });
    await c.as(JOINER1); expect(await c.rpc("select public.qb_mock_link_info($1)", [l.code])).toMatchObject({ full: true, joined: true });
    expect((await grantsOf(JOINER1))[0]).toMatchObject({ source: "link", from: "Old Students Association", active: true });
    await c.as(SPONSOR_ALUMNI); expect((await c.rpc("select public.qb_mock_links($1)", [x.id])).links.find((k: any) => k.id === l.id)).toMatchObject({ joined: 2, seats_paid: 2 });
  });

  it("adds places for only the difference, and refuses nonsense", async () => {
    await setBalance(SPONSOR_ALUMNI, 100);
    const l = await make(2);
    await c.as(SPONSOR_ALUMNI);
    expect(await c.rpc("select public.qb_mock_link_add_seats($1,5)", [l.id])).toMatchObject({ seats_paid: 5, coins_paid: 5 });
    expect(await balance(SPONSOR_ALUMNI)).toBe(95);                                                                                        // 2 + 3 more, never 2 + 5
    for (const total of [5, 4, 1001]) await c.fails("select public.qb_mock_link_add_seats($1,$2)", [l.id, total], /QB_MOCK_LINK_INVALID/);
    await c.as(SPONSOR_OK); await c.fails("select public.qb_mock_link_add_seats($1,8)", [l.id], /QB_MOCK_LINK_NOT_FOUND/);                  // someone else's link
    await setBalance(SPONSOR_ALUMNI, 1); await c.as(SPONSOR_ALUMNI);
    await c.fails("select public.qb_mock_link_add_seats($1,20)", [l.id], /QB_INSUFFICIENT_BALANCE/);
    expect((await c.q<{ s: number }>("select seats_paid as s from public.mock_exam_links where id = $1", [l.id]))[0].s).toBe(5);
  });

  it("keeps people out who should not join: the owner, a managed child, someone with no learner account, a closed or ended link", async () => {
    await setBalance(SPONSOR_ALUMNI, 100);
    const l = await make(10);
    await c.as(SPONSOR_ALUMNI); await c.fails("select public.qb_mock_link_join($1)", [l.code], /QB_MOCK_OWN_EXAM/);
    await c.as(MANAGED); await c.fails("select public.qb_mock_link_join($1)", [l.code], /QB_MOCK_JOIN_NOT_ALLOWED/);
    await c.as(TEACHER); await c.fails("select public.qb_mock_link_join($1)", [l.code], /QB_STUDENT_REQUIRED/);
    await c.as(null); await c.fails("select public.qb_mock_link_join($1)", [l.code], /permission denied/);
    await c.as(JOINER1); await c.fails("select public.qb_mock_link_join($1)", ["nosuchcode"], /QB_MOCK_LINK_NOT_FOUND/);
    await c.rpc("select public.qb_mock_link_join($1)", [l.code]);
    await c.as(SPONSOR_ALUMNI); expect((await c.rpc("select public.qb_mock_link_close($1)", [l.id])).status).toBe("closed");
    await c.as(JOINER2); await c.fails("select public.qb_mock_link_join($1)", [l.code], /QB_MOCK_LINK_CLOSED/);
    await c.as(SPONSOR_ALUMNI); await c.fails("select public.qb_mock_link_add_seats($1,20)", [l.id], /QB_MOCK_LINK_CLOSED/);
    expect(await balance(SPONSOR_ALUMNI)).toBe(90);                                                                                         // no refund for places not used
    await c.as(JOINER1); expect((await c.rpc("select public.qb_mock_link_join($1)", [l.code])).already).toBe(true);                       // someone already in keeps their place
    const ended = await make(2);
    await c.q("update public.mock_exam_links set closes_at = now() - interval '1 minute' where id = $1", [ended.id]);
    await c.as(JOINER3); await c.fails("select public.qb_mock_link_join($1)", [ended.code], /QB_MOCK_LINK_CLOSED/);
    expect(await c.rpc("select public.qb_mock_link_info($1)", [ended.code])).toMatchObject({ open: false });
    await c.setFlag("flags.mock_exam_links", false); await c.as(JOINER3);
    await c.fails("select public.qb_mock_link_join($1)", [l.code], /QB_FEATURE_DISABLED/);
    await c.setFlag("flags.mock_exam_links", true);
  });

  it("gives each joiner their own copy of the version that was shared, even after a newer version is published; a changed question takes no place", async () => {
    await setBalance(SPONSOR_ALUMNI, 100);
    const y = await c.publishedExam(SPONSOR_ALUMNI); await c.as(SPONSOR_ALUMNI);
    const l = await c.rpc("select public.qb_mock_link_create($1,3,null)", [y.id]);
    await c.as(JOINER1); const j = await c.rpc("select public.qb_mock_link_join($1)", [l.code]);
    const a = await startAs(JOINER1, j.grant_id);
    expect((await c.q("select 1 from public.assessment_questions where assessment_id = $1", [a])).length).toBe(6);
    // The sponsor edits and publishes version 2: the link still serves version 1 and says it is behind.
    await c.as(SPONSOR_ALUMNI); await c.rpc("select public.qb_mock_exam_update($1,$2::jsonb)", [y.id, JSON.stringify({ title: "A fresh title for version two" })]); await c.publish(y.id);
    expect((await c.rpc("select public.qb_mock_links($1)", [y.id])).links[0]).toMatchObject({ version_no: 1, behind_current: true });
    // A question changes after publishing: joining fails clearly and the place is not used.
    const q = (await c.q<{ question_id: string }>("select question_id from public.mock_exam_version_questions where version_id = $1 limit 1", [y.versionId]))[0].question_id;
    await c.q("update public.questions set version = 2, status = 'inactive', validation_status = 'review' where id = $1", [q]);
    await c.as(JOINER2); await c.fails("select public.qb_mock_link_join($1)", [l.code], /QB_MOCK_VERSION_STALE/);
    expect((await c.q<{ n: number }>("select count(*)::int as n from public.mock_exam_grants where link_id = $1", [l.id]))[0].n).toBe(1);
    await c.q("update public.questions set version = 1, status = 'active', validation_status = 'approved' where id = $1", [q]);
  });

  it("shows the sponsor joiners as numbers only, never a name or an email", async () => {
    await setBalance(SPONSOR_ALUMNI, 100);
    const z = await c.publishedExam(SPONSOR_ALUMNI); await c.as(SPONSOR_ALUMNI);
    const l = await c.rpc("select public.qb_mock_link_create($1,3,null)", [z.id]);
    const taken: string[] = [];
    for (const [u, right] of [[JOINER1, 6], [JOINER2, 3]] as const) { await c.as(u); const j = await c.rpc("select public.qb_mock_link_join($1)", [l.code]); const a = await startAs(u, j.grant_id); taken.push(a); await c.attempt({ assessmentId: a, student: u, answers: await answerSheet(a, right) }); }
    await c.as(SPONSOR_ALUMNI);
    const r = await c.rpc("select public.qb_mock_results($1,null)", [z.id]);
    expect(r.summary).toMatchObject({ assigned: 2, finished: 2, average_percent: 75 });
    expect(r.participants.map((p: any) => [p.participant, p.source, p.group]).sort()).toEqual([["Joiner 1", "link", "Shared link"], ["Joiner 2", "link", "Shared link"]]);
    const everything = JSON.stringify(r) + JSON.stringify(await c.rpc("select public.qb_mock_result_rows($1)", [z.id])) + JSON.stringify(await c.rpc("select public.qb_mock_export($1)", [z.id])) + JSON.stringify(await c.rpc("select public.qb_mock_links($1)", [z.id]));
    expect(everything).not.toMatch(/Joiner One|Joiner Two|j1@|j2@|@example\.com/);
    expect((await c.rpc("select public.qb_mock_links($1)", [z.id])).links[0]).toMatchObject({ joined: 2, attempts: 2 });
  });

  it("refuses an attempt to anyone who did not join, and to a joiner after their time is up", async () => {
    await setBalance(SPONSOR_ALUMNI, 100);
    const l = await make(2);
    await c.as(JOINER1); const j = await c.rpc("select public.qb_mock_link_join($1)", [l.code]); const a = await startAs(JOINER1, j.grant_id);
    await c.reset(); await c.db.query("insert into public.attempts(assessment_id, student_user_id) values ($1,$2)", [a, JOINER1]);
    await expect(c.db.query("insert into public.attempts(assessment_id, student_user_id) values ($1,$2)", [a, JOINER2])).rejects.toThrow(/QB_MOCK_ENTITLEMENT_REQUIRED/);
    await c.q("update public.mock_exam_grants set expires_at = now() - interval '1 day' where id = $1", [j.grant_id]);
    await expect(c.db.query("insert into public.attempts(assessment_id, student_user_id) values ($1,$2)", [a, JOINER1])).rejects.toThrow(/QB_MOCK_ENTITLEMENT_REQUIRED/);
  });

  it("leaves a Marketplace sale and its results exactly as before", async () => {
    await c.verifySeller(SPONSOR_OK);
    expect(await c.q("select 1 from public.mock_exam_enrolments where purchase_id is null and grant_id is null")).toEqual([]);
    expect((await c.q<{ n: number }>("select count(*)::int as n from public.mock_exam_enrolments where (purchase_id is null) = (grant_id is null)"))[0].n).toBe(0);   // exactly one source, always
  });
});

describe("rollback", () => {
  it("can be rolled back and re-applied, keeping the gifts and the paid places", async () => {
    await c.reset();
    const grants = (await c.q<{ n: number }>("select count(*)::int as n from public.mock_exam_grants"))[0].n;
    await c.db.exec(ROLLBACK);
    expect((await c.db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname in ('qb_mock_family_give','qb_mock_link_create','qb_mock_link_join','qb_mock_my_grants')")).rows[0].n).toBe(0);
    expect((await c.db.query<{ n: number }>("select count(*)::int as n from public.mock_exam_grants")).rows[0].n).toBe(grants);
    await c.as(SPONSOR_PARENT); expect(await c.rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: false });                 // the earlier author rule is back
    await c.reset(); await c.db.exec(MIG.sponsorMock);
    await c.as(SPONSOR_PARENT); expect(await c.rpc("select public.qb_mock_author_status()")).toMatchObject({ can_author: true });
  });
});
