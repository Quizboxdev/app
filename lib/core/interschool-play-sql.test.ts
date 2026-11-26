import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, MIGRATIONS, SCHOOLS, SPONSOR_OK, SUBJECT, helpers, learner, makeDb, migration, read, staff, type Db } from "./interschool-fixture";

// Inter-school competitions: fixtures, sittings, scoring, progression, billing and awards (isolated PostgreSQL; the migrations are applied unchanged).
let db: Db;
let t: ReturnType<typeof helpers>;
const err = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
beforeAll(async () => { db = await makeDb(); t = helpers(db); await t.on(); await t.setting("flags.interschool_certificates", true); }, 60_000);
afterAll(async () => { await db.close(); });

const finalise = async (roundId: string, who = ADMIN) => { await t.closeRound(roundId); await t.as(who); return t.rpc<any>("select public.interschool_finalise_round($1)", [roundId]); };
const results = async (roundId: string) => { await t.as(ADMIN); return t.rpc<any>("select public.interschool_results($1)", [roundId]); };
const uid = (school: number, n: number, level: 7 | 8 | 9 = 7) => learner(school, level, n);
// A published competition with `schools` schools, `each` learners per school, in Basic 7.
async function field(schools: number, each: number, opts: Parameters<ReturnType<typeof helpers>["competition"]>[1] = {}) {
  const c = await t.competition(ADMIN, { ...opts, invite: SCHOOLS.slice(0, schools) });
  for (let s = 1; s <= schools; s++) await t.nominate(c.id, s, c.divisions[0], Array.from({ length: each }, (_, i) => uid(s, i + 1)));
  return { ...c, rounds: await t.rounds(c.divisions[0]) };
}

describe("taking a round", () => {
  let c: Awaited<ReturnType<typeof field>>;
  beforeAll(async () => { c = await field(2, 3); });
  it("is closed until the round opens, and only for confirmed learners of that level", async () => {
    await t.as(uid(1, 1));
    await err("select public.interschool_start($1)", [c.rounds[0]], /IS_ROUND_NOT_OPEN/);
    await t.openRound(c.rounds[0]);
    await t.as(uid(3, 1));
    await err("select public.interschool_start($1)", [c.rounds[0]], /IS_NOT_REGISTERED/);
  });
  it("gives competing schools the same questions in different orders and never sends the answers", async () => {
    const a = await t.play(uid(1, 1), c.rounds[0], 0, false), b = await t.play(uid(2, 1), c.rounds[0], 0, false);
    expect(a.view.questions.map((q) => q.id).sort()).toEqual(b.view.questions.map((q) => q.id).sort());
    expect(a.view.questions).toHaveLength(5);
    expect(JSON.stringify(a.view)).not.toMatch(/correct|explanation/);
    const orders = new Set<string>();
    for (const q of a.view.questions) orders.add(q.options.map((o) => o.split(" ")[0]).join());
    for (const q of b.view.questions) orders.add(q.options.map((o) => o.split(" ")[0]).join());
    expect(orders.size).toBeGreaterThan(1);
  });
  it("resumes the same sitting with saved answers, accepts one submission and shows no score", async () => {
    const { view, answers } = await t.play(uid(1, 2), c.rounds[0], 5, false);
    await t.rpc("select public.interschool_save($1,$2)", [view.sitting_id, JSON.stringify(answers.slice(0, 3))]);
    const again = await t.rpc<any>("select public.interschool_start($1)", [c.rounds[0]]);
    expect([again.sitting_id, again.resumed]).toEqual([view.sitting_id, true]);
    expect(again.questions.filter((q: any) => q.chosen !== null)).toHaveLength(3);
    for (const q of again.questions.filter((x: any) => x.chosen !== null)) expect(q.options[q.chosen]).toMatch(/^right/);
    const receipt = await t.rpc<any>("select public.interschool_submit($1,$2)", [view.sitting_id, JSON.stringify(answers.slice(3))]);
    expect(receipt).toMatchObject({ ok: true, answered: 5 });
    expect(JSON.stringify(receipt)).not.toMatch(/score/);
    expect((await t.rpc<any>("select public.interschool_submit($1,$2)", [view.sitting_id, "[]"])).already_submitted).toBe(true);
    await err("select public.interschool_start($1)", [c.rounds[0]], /IS_ALREADY_TAKEN/);
    expect((await t.q<any>("select score, max_score from quizbox_interschool.sittings where id=$1", [view.sitting_id]))[0]).toEqual({ score: 5, max_score: 5 });
  });
  it("ignores answers sent after the time is up and keeps the ones saved in time", async () => {
    const { view, answers } = await t.play(uid(1, 3), c.rounds[0], 5, false);
    await t.rpc("select public.interschool_save($1,$2)", [view.sitting_id, JSON.stringify(answers.slice(0, 2))]);
    await t.q("update quizbox_interschool.sittings set started_at=now()-interval '20 minutes', expires_at=now()-interval '5 minutes' where id=$1", [view.sitting_id]);
    await t.as(uid(1, 3));
    expect((await t.rpc<any>("select public.interschool_save($1,$2)", [view.sitting_id, JSON.stringify(answers)])).saved).toBe(false);
    expect((await t.rpc<any>("select public.interschool_submit($1,$2)", [view.sitting_id, JSON.stringify(answers)])).late_answers_ignored).toBe(true);
    expect((await t.q<any>("select score from quizbox_interschool.sittings where id=$1", [view.sitting_id]))[0].score).toBe(2);
  });
  it("stops one learner reading or answering another's sitting, and stops everyone while paused", async () => {
    const mine = (await t.q<any>("select id from quizbox_interschool.sittings where user_id=$1", [uid(2, 1)]))[0].id;
    await t.as(uid(2, 2));
    await err("select public.interschool_save($1,$2)", [mine, "[]"], /IS_NOT_FOUND/);
    await t.as(ADMIN); await t.rpc("select public.interschool_set_status($1,'PAUSED')", [c.id]);
    await t.as(uid(2, 2)); await err("select public.interschool_start($1)", [c.rounds[0]], /IS_ROUND_PAUSED/);
    await t.as(ADMIN); await t.rpc("select public.interschool_set_status($1,'PUBLISHED')", [c.id]);
  });
});

describe("progression and school rankings", () => {
  it("passes learners on by pass mark and rank together, and keeps others out of the next round", async () => {
    const c = await field(2, 3, { settings: { scoring_top_n: 2 }, rounds: (s) => [t.round(1, s, { rule: "PASS_AND_TOP_LEARNERS", pass_percent: 60, top_n: 3 }), t.round(2, s)] });
    await t.openRound(c.rounds[0]);
    const marks: Array<[number, number, number]> = [[1, 1, 5], [1, 2, 4], [1, 3, 2], [2, 1, 3], [2, 2, 1]];   // [school, learner, right of 5]; learner 2/3 is absent
    for (const [s, n, right] of marks) await t.play(uid(s, n), c.rounds[0], right);
    await t.as(ADMIN);
    await err("select public.interschool_finalise_round($1)", [c.rounds[0]], /IS_ROUND_STILL_OPEN/);
    await t.as(uid(1, 1));
    expect((await t.rpc<any>("select public.interschool_mine()"))[0].rounds[0].result).toBeNull();
    const done = await finalise(c.rounds[0]);
    expect(done.qualified).toBe(3);
    const r = await results(c.rounds[0]);
    expect(r.schools.map((x: any) => [x.school, x.rank, x.score, x.present, x.entered])).toEqual([["School 1 Academy", 1, 180, 3, 3], ["School 2 Academy", 2, 80, 2, 3]]);
    expect(r.learners.find((x: any) => x.absent)).toMatchObject({ score: 0, qualified: false, rank: null });
    await t.openRound(c.rounds[1]);
    await t.as(uid(2, 2)); await err("select public.interschool_start($1)", [c.rounds[1]], /IS_ROUND_NOT_THROUGH/);
    await t.as(uid(2, 1)); await t.rpc("select public.interschool_start($1)", [c.rounds[1]]);
  });
  it("does not open the next round until the one before is final", async () => {
    const c = await field(2, 1, { rounds: (s) => [t.round(1, s), t.round(2, s)] });
    await t.openRound(c.rounds[1]);
    await t.as(uid(1, 1)); await err("select public.interschool_start($1)", [c.rounds[1]], /IS_ROUND_WAITING/);
    await t.closeRound(c.rounds[1]); await t.as(ADMIN);
    await err("select public.interschool_finalise_round($1)", [c.rounds[1]], /IS_PREVIOUS_ROUND_NOT_FINALISED/);
  });
  it("takes the top schools, by average or by team total, and can carry scores forward", async () => {
    const c = await field(3, 2, { settings: { school_scoring: "AVERAGE", score_carry: "ACCUMULATE" }, rounds: (s) => [t.round(1, s, { rule: "TOP_SCHOOLS", top_n: 2 }), t.round(2, s)] });
    await t.openRound(c.rounds[0]);
    const marks: Array<[number, number, number]> = [[1, 1, 5], [1, 2, 3], [2, 1, 4], [2, 2, 2], [3, 1, 5]];   // school 3's second learner is absent, counted as zero
    for (const [s, n, right] of marks) await t.play(uid(s, n), c.rounds[0], right);
    await finalise(c.rounds[0]);
    const r = await results(c.rounds[0]);
    expect(r.schools.map((x: any) => [x.school.slice(0, 8), x.score, x.qualified])).toEqual([["School 1", 80, true], ["School 2", 60, true], ["School 3", 50, false]]);
    await t.openRound(c.rounds[1]);
    await t.play(uid(1, 1), c.rounds[1], 0); await t.play(uid(2, 1), c.rounds[1], 5); await t.play(uid(2, 2), c.rounds[1], 5);
    await finalise(c.rounds[1]);
    const final = await results(c.rounds[1]);
    expect(final.schools.map((x: any) => [x.school.slice(0, 8), x.score, x.total_score])).toEqual([["School 2", 100, 160], ["School 1", 0, 80]]);
    expect((await t.q<any>("select status from quizbox_interschool.competitions where id=$1", [c.id]))[0].status).toBe("COMPLETED");
  });
  it("needs a minimum number of learners for a school to be ranked", async () => {
    const c = await field(2, 2, { settings: { min_candidates: 2 } });
    await t.openRound(c.rounds[0]);
    await t.play(uid(1, 1), c.rounds[0], 5); await t.play(uid(2, 1), c.rounds[0], 2); await t.play(uid(2, 2), c.rounds[0], 2);
    await finalise(c.rounds[0]);
    const r = await results(c.rounds[0]);
    expect(r.schools.map((x: any) => [x.school.slice(0, 8), x.eligible, x.rank])).toEqual([["School 2", true, 1], ["School 1", false, null]]);
  });
  it("leaves MANUAL rounds to an authorised choice with a reason", async () => {
    const c = await field(2, 2, { rounds: (s) => [t.round(1, s, { rule: "MANUAL" }), t.round(2, s)] });
    await t.openRound(c.rounds[0]); await t.play(uid(1, 1), c.rounds[0], 1);
    expect((await finalise(c.rounds[0])).needs_manual_qualification).toBe(true);
    const ids = (await t.q<any>("select id from quizbox_interschool.candidates where competition_id=$1 and user_id=$2", [c.id, uid(1, 1)])).map((x) => x.id);
    await t.as(staff(1)); await err("select public.interschool_qualify($1,$2,true,'chosen')", [c.rounds[0], ids], /IS_NOT_AUTHORISED/);
    await t.as(ADMIN); await err("select public.interschool_qualify($1,$2,true,'')", [c.rounds[0], ids], /IS_REASON_REQUIRED/);
    expect((await t.rpc<any>("select public.interschool_qualify($1,$2,true,'Judges chose this learner')", [c.rounds[0], ids])).changed).toBe(1);
    await t.rpc("select public.interschool_announce_round($1)", [c.rounds[0]]);
    await t.openRound(c.rounds[1]); await t.as(uid(1, 1)); await t.rpc("select public.interschool_start($1)", [c.rounds[1]]);
  });
});

describe("fixtures", () => {
  // a school cannot be in two fixtures at once even across competitions, so each case ends by cancelling its own
  afterEach(async () => { await t.q("update quizbox_interschool.competitions set status='CANCELLED' where status<>'CANCELLED'"); });
  it("draws a round robin in which every school meets every other once", async () => {
    const c = await field(4, 1, { settings: { school_scoring: "FIXTURE_POINTS" }, rounds: (s) => [1, 2, 3].map((n) => t.round(n, s, { format: "ROUND_ROBIN" })) });
    await t.as(ADMIN);
    expect((await t.rpc<any>("select public.interschool_generate_fixtures($1,'ROUND_ROBIN')", [c.divisions[0]])).fixtures).toBe(6);
    const pairs = await t.q<any>("select r.round_no, f.home_institution h, f.away_institution a from quizbox_interschool.fixtures f join quizbox_interschool.rounds r on r.id=f.round_id where r.division_id=$1", [c.divisions[0]]);
    expect(new Set(pairs.map((p) => [p.h, p.a].sort().join())).size).toBe(6);
    for (const n of [1, 2, 3]) expect(new Set(pairs.filter((p) => p.round_no === n).flatMap((p) => [p.h, p.a])).size).toBe(4);
    await t.openRound(c.rounds[0]);
    const [first] = await t.q<any>("select home_institution h from quizbox_interschool.fixtures where round_id=$1 order by match_no limit 1", [c.rounds[0]]);
    const winner = SCHOOLS.indexOf(first.h) + 1;
    await t.play(uid(winner, 1), c.rounds[0], 5);
    await finalise(c.rounds[0]);
    const r = await results(c.rounds[0]);
    expect(r.schools.find((x: any) => x.school === `School ${winner} Academy`)).toMatchObject({ total_score: 3, rank: 1 });
  });
  it("gives byes in a knockout, advances winners and draws the next round by itself", async () => {
    const c = await field(5, 1, { rounds: (s) => [t.round(1, s, { format: "KNOCKOUT", stage: "QUARTER_FINAL", rule: "FIXTURE_WINNERS" }), t.round(2, s, { format: "KNOCKOUT", stage: "SEMI_FINAL", rule: "FIXTURE_WINNERS" }), t.round(3, s, { format: "KNOCKOUT", stage: "FINAL", rule: "FIXTURE_WINNERS" })] });
    await t.as(ADMIN);
    expect((await t.rpc<any>("select public.interschool_generate_fixtures($1,'KNOCKOUT')", [c.divisions[0]])).fixtures).toBe(4);
    const draw = (round: string) => t.q<any>("select home_institution h, away_institution a from quizbox_interschool.fixtures where round_id=$1 and status<>'CANCELLED' order by match_no", [round]);
    const first = await draw(c.rounds[0]);
    expect(first.filter((f) => f.a === null)).toHaveLength(3);
    const played = first.find((f) => f.a)!;
    await t.openRound(c.rounds[0]);
    const byeSchool = SCHOOLS.indexOf(first.find((f) => !f.a)!.h) + 1;
    await t.as(uid(byeSchool, 1)); await err("select public.interschool_start($1)", [c.rounds[0]], /IS_ROUND_BYE/);
    const strong = SCHOOLS.indexOf(played.a) + 1, weak = SCHOOLS.indexOf(played.h) + 1;
    await t.play(uid(strong, 1), c.rounds[0], 4); await t.play(uid(weak, 1), c.rounds[0], 1);
    await finalise(c.rounds[0]);
    const second = await draw(c.rounds[1]);
    expect(second).toHaveLength(2);
    expect(second.flatMap((f) => [f.h, f.a]).sort()).toEqual([played.a, ...first.filter((f) => !f.a).map((f) => f.h)].sort());
    await t.openRound(c.rounds[1]); await t.as(uid(weak, 1)); await err("select public.interschool_start($1)", [c.rounds[1]], /IS_ROUND_NOT_THROUGH/);
    // nobody plays: each tie is decided by a recorded draw of lots, and the final is drawn
    await finalise(c.rounds[1]);
    expect(await draw(c.rounds[2])).toHaveLength(1);
    expect((await t.q<any>("select note from quizbox_interschool.fixtures where round_id=$1", [c.rounds[1]])).every((f) => /lot/.test(f.note))).toBe(true);
  });
  it("refuses clashing fixtures, keeps changes to unplayed fixtures and tells both schools", async () => {
    const a = await field(2, 1, { rounds: (s) => [t.round(1, s, { format: "ROUND_ROBIN" })] });
    const b = await field(2, 1, { rounds: (s) => [t.round(1, s, { format: "ROUND_ROBIN" })] });
    await t.as(ADMIN);
    await t.rpc("select public.interschool_generate_fixtures($1,'ROUND_ROBIN')", [a.divisions[0]]);
    await err("select public.interschool_generate_fixtures($1,'ROUND_ROBIN')", [b.divisions[0]], /IS_FIXTURE_CLASH/);
    const f = (await t.q<any>("select id, scheduled_at, closes_at from quizbox_interschool.fixtures where round_id=$1", [a.rounds[0]]))[0];
    await t.as(ADMIN);
    await err("select public.interschool_change_fixture($1,null,null,true,null)", [f.id], /IS_REASON_REQUIRED/);
    await t.rpc("select public.interschool_change_fixture($1,$2,$3)", [f.id, new Date(new Date(f.scheduled_at).getTime() + 3_600_000).toISOString(), f.closes_at]);
    await t.rpc("select public.interschool_change_fixture($1,null,null,true,'Power cut at the host')", [f.id]);
    await t.rpc("select public.interschool_generate_fixtures($1,'ROUND_ROBIN')", [b.divisions[0]]);
    expect((await t.q<any>("select distinct title from public.notifications where title like 'Fixture%' order by 1")).map((x) => x.title)).toEqual(["Fixture cancelled", "Fixture changed", "Fixture scheduled"]);
  });
  it("lets a fixture have its own subjects and length", async () => {
    const c = await field(2, 1, { rounds: (s) => [t.round(1, s, { format: "ROUND_ROBIN" })] });
    const r = (await t.q<any>("select opens_at, closes_at from quizbox_interschool.rounds where id=$1", [c.rounds[0]]))[0];
    await t.as(ADMIN);
    await t.rpc("select public.interschool_add_fixture($1,$2,$3,$4,$5,$6,$7)", [c.rounds[0], SCHOOLS[0], SCHOOLS[1], r.opens_at, r.closes_at, JSON.stringify([{ subject_id: SUBJECT.eng7, count: 3 }]), 120]);
    await t.openRound(c.rounds[0]);
    const { view } = await t.play(uid(1, 1), c.rounds[0], 0, false);
    expect(view.questions).toHaveLength(3);
    expect((view.questions[0] as any).question_text).toMatch(/eng7/);
  });
});

describe("disputes and corrections", () => {
  it("lets a learner dispute, an administrator correct the score, and keeps the history", async () => {
    const c = await field(2, 1, { rounds: (s) => [t.round(1, s)] });
    await t.openRound(c.rounds[0]); await t.play(uid(1, 1), c.rounds[0], 2); await t.play(uid(2, 1), c.rounds[0], 3);
    await t.as(uid(1, 1)); await err("select public.interschool_raise_dispute($1,'The timer stopped on my phone')", [c.rounds[0]], /IS_ROUND_NOT_FINALISED/);
    await finalise(c.rounds[0]);
    await t.as(ADMIN); await err("select public.interschool_issue_certificates($1::uuid) from (select 1) x where false", [c.id], /./).catch(() => undefined);
    await t.as(uid(1, 1));
    const d = await t.rpc<any>("select public.interschool_raise_dispute($1,'Question two had two right answers')", [c.rounds[0]]);
    await t.as(ADMIN); await err("select public.interschool_issue_certificates($1)", [c.id], /IS_DISPUTES_OPEN/);
    const candidate = (await t.q<any>("select id from quizbox_interschool.candidates where competition_id=$1 and user_id=$2", [c.id, uid(1, 1)]))[0].id;
    await t.as(staff(1)); await err("select public.interschool_adjust_score($1,$2,4,'Upheld by the panel')", [c.rounds[0], candidate], /IS_NOT_AUTHORISED/);
    await t.as(ADMIN);
    await err("select public.interschool_adjust_score($1,$2,9,'Upheld by the panel')", [c.rounds[0], candidate], /IS_SCORE_INVALID/);
    await t.rpc("select public.interschool_adjust_score($1,$2,4,'Upheld by the panel',$3)", [c.rounds[0], candidate, d.dispute_id]);
    await t.rpc("select public.interschool_resolve_dispute($1,true,'Score corrected to four')", [d.dispute_id]);
    const r = await results(c.rounds[0]);
    expect(r.schools[0]).toMatchObject({ school: "School 1 Academy", rank: 1 });
    expect((await t.q<any>("select old_score, new_score from quizbox_interschool.adjustments"))[0]).toMatchObject({ old_score: "2", new_score: "4" });
    expect((await t.q<any>("select count(*)::int n from public.audit_logs where action in ('interschool.score_adjusted','interschool.dispute_resolved')"))[0].n).toBe(2);
  });
  it("shows a school only its own learners' names in results", async () => {
    const c = await field(2, 1);
    await t.openRound(c.rounds[0]); await t.play(uid(1, 1), c.rounds[0], 2); await t.play(uid(2, 1), c.rounds[0], 3);
    await finalise(c.rounds[0]);
    await t.as(staff(1));
    const mine = await t.rpc<any>("select public.interschool_results($1)", [c.rounds[0]]);
    expect(mine.learners).toHaveLength(1);
    expect(mine.schools).toHaveLength(2);
    await t.as(staff(3)); await err("select public.interschool_results($1)", [c.rounds[0]], /IS_NOT_AUTHORISED/);
    await t.as("service");
    const pub = JSON.stringify(await t.rpc("select public.interschool_public_results($1)", [c.slug]));
    expect(pub).toContain("Learner271 O.");
    expect(pub).not.toContain("Owusu");
  });
});

describe("sponsorship billing", () => {
  let c: { id: string; slug: string };
  it("quotes expected participants at the administrator's rate and locks it on acceptance", async () => {
    c = await t.competition(SPONSOR_OK, { publish: false, settings: { title: "Gold Bank Cup", participation: "OPEN", expected_participants: 2000, capacity: 2000, funding: "SPONSORED", sponsor_name: "Gold Bank" } });
    await t.as(SPONSOR_OK);
    await err("select public.interschool_quote($1)", [c.id], /IS_RATE_NOT_SET/);
    await err("select public.interschool_set_rate(500)", [], /IS_NOT_AUTHORISED/);
    await t.as(ADMIN); await t.rpc("select public.interschool_set_rate(500,0)");
    await t.as(SPONSOR_OK);
    await err("select public.interschool_quote($1,10)", [c.id], /IS_QUOTE_BELOW_EXPECTED/);
    await err("select public.interschool_quote($1,null,null,null,100,'please')", [c.id], /IS_NOT_AUTHORISED/);
    const q = await t.rpc<any>("select public.interschool_quote($1)", [c.id]);
    expect([q.participants, q.rate_minor, q.total_minor]).toEqual([2000, 500, 1_000_000]);          // 2,000 x GHS 5 = GHS 10,000
    await t.as(ADMIN); await t.rpc("select public.interschool_set_rate(900,0)");
    await t.as(SPONSOR_OK);
    const invoice = await t.rpc<any>("select public.interschool_decide_quote($1,true)", [q.id]);
    expect([invoice.amount_minor, invoice.status]).toEqual([1_000_000, "UNPAID"]);
    expect((await t.rpc<any>("select public.interschool_decide_quote($1,true)", [q.id])).id).toBe(invoice.id);
    await t.as(ADMIN); await t.rpc("select public.interschool_set_rate(500,0)");
  });
  it("will not publish or open registration without verified payment", async () => {
    await t.as(SPONSOR_OK);
    await t.rpc("select public.interschool_request_approval($1)", [c.id]);
    await t.as(ADMIN); await t.rpc("select public.interschool_decide($1,true,null)", [c.id]);
    await t.as(SPONSOR_OK); await err("select public.interschool_publish($1)", [c.id], /IS_FUNDING_REQUIRED/);
  });
  it("credits a payment once, only for the exact amount, and flags a second payment for refund", async () => {
    const invoice = (await t.q<any>("select id from quizbox_interschool.invoices where competition_id=$1", [c.id]))[0].id;
    await t.as(SPONSOR_OK);
    const a = await t.rpc<any>("select public.interschool_payment_start($1)", [invoice]), b = await t.rpc<any>("select public.interschool_payment_start($1)", [invoice]);
    expect(a.reference).toMatch(/^QBS-/); expect(b.reference).not.toBe(a.reference);
    const apply = async (event: string, ref: string, status: string, amount: number) => { await t.as("service"); return (await t.rpc<any>("select public.interschool_payment_apply('paystack',$1,$2,$3,$4,$5,'GHS')", [event, ref, status, `p-${event}`, amount])).outcome; };
    await t.as(SPONSOR_OK); await err("select public.interschool_payment_apply('paystack','x',$1,'successful','p',1000000,'GHS')", [a.reference], /permission denied/);
    expect(await apply("e0", a.reference, "successful", 100)).toBe("amount_mismatch");
    expect((await t.q<any>("select status from quizbox_interschool.invoices where id=$1", [invoice]))[0].status).toBe("UNPAID");
    expect(await apply("e1", b.reference, "successful", 1_000_000)).toBe("credited");
    expect(await apply("e1", b.reference, "successful", 1_000_000)).toBe("duplicate_event");
    expect(await apply("e2", b.reference, "successful", 1_000_000)).toBe("already_settled");
    await t.as(SPONSOR_OK); await err("select public.interschool_payment_start($1)", [invoice], /IS_INVOICE_ALREADY_SETTLED/);
    await t.q("update quizbox_interschool.payment_attempts set status='initiated' where reference=$1", [a.reference]);
    expect(await apply("e3", a.reference, "successful", 1_000_000)).toBe("duplicate_payment");
    expect((await t.q<any>("select funded_participants f from quizbox_interschool.competitions where id=$1", [c.id]))[0].f).toBe(2000);
    await t.as(SPONSOR_OK); await t.rpc("select public.interschool_publish($1)", [c.id]);
    expect((await t.rpc<any>("select public.interschool_public_get($1)", [c.slug])).registration).toBe("OPEN");
  });
  it("needs a new approval and payment for more places, and closes registration if the payment is reversed", async () => {
    await t.as(SPONSOR_OK);
    await err("select public.interschool_update($1,$2)", [c.id, JSON.stringify({ capacity: 2500 })], /IS_FUNDING_REQUIRED_FOR_CAPACITY/);
    await t.q("update quizbox_interschool.competitions set expected_participants=2500 where id=$1", [c.id]);
    await t.as(SPONSOR_OK);
    const extra = await t.rpc<any>("select public.interschool_quote($1)", [c.id]);
    expect([extra.participants, extra.total_minor]).toEqual([500, 250_000]);
    const invoice = await t.rpc<any>("select public.interschool_decide_quote($1,true)", [extra.id]);
    await t.as(ADMIN); await t.rpc("select public.interschool_fund_invoice($1,'APPROVE_CREDIT','District office purchase order 44')", [invoice.id]);
    await t.as(SPONSOR_OK); await t.rpc("select public.interschool_update($1,$2)", [c.id, JSON.stringify({ capacity: 2500 })]);
    const paid = (await t.q<any>("select reference from quizbox_interschool.payment_attempts where status='successful'"))[0].reference;
    await t.as("service"); await t.rpc("select public.interschool_payment_apply('paystack','r1',$1,'refunded','p-r1',1000000,'GHS')", [paid]);
    expect((await t.rpc<any>("select public.interschool_public_get($1)", [c.slug])).registration).toBe("AWAITING_FUNDING");
  });
  it("shows the sponsor numbers only, never a learner", async () => {
    await t.as(ADMIN);
    const q = await t.q<any>("select id from quizbox_interschool.invoices where competition_id=$1 and status='REFUNDED'", [c.id]);
    expect(q).toHaveLength(1);
    const x = await t.rpc<any>("select public.interschool_quote($1,2000,$2)", [c.id, SPONSOR_OK]);
    const inv = await t.rpc<any>("select public.interschool_decide_quote($1,true)", [x.id]);
    await t.rpc("select public.interschool_fund_invoice($1,'RECORD_PAYMENT','Bank transfer ref 9912')", [inv.id]);
    await t.nominate(c.id, 1, (await t.q<any>("select id from quizbox_interschool.divisions where competition_id=$1", [c.id]))[0].id, [uid(1, 1), uid(1, 2)]);
    await t.as(SPONSOR_OK);
    const home = await t.rpc<any[]>("select public.interschool_sponsor_home()");
    const figures = home[0].figures;
    expect([figures.schools_registered, figures.registered_participants, figures.regions[0].learners]).toEqual([1, 2, null]);
    expect(JSON.stringify(home)).not.toMatch(/Learner1|@example/);
    await err("select public.interschool_school_roster($1,$2)", [c.id, SCHOOLS[0]], /IS_NOT_AUTHORISED/);
    const rounds = await t.q<any>("select r.id from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id=r.division_id where d.competition_id=$1", [c.id]);
    await t.as(SPONSOR_OK);
    const asOrganiser = await t.rpc<any>("select public.interschool_registrations($1)", [c.id]);
    expect(JSON.stringify(asOrganiser)).not.toMatch(/Learner1/);
    expect(rounds.length).toBeGreaterThan(0);
  });
});

describe("certificates, notices and reminders", () => {
  it("issues certificates once results are final, verifiable by code, and revocable", async () => {
    const c = await field(2, 2, { rounds: (s) => [t.round(1, s), t.round(2, s)] });
    await t.openRound(c.rounds[0]); await t.play(uid(1, 1), c.rounds[0], 5); await t.play(uid(2, 1), c.rounds[0], 3); await t.play(uid(2, 2), c.rounds[0], 1);
    await finalise(c.rounds[0]);
    await t.as(ADMIN); await err("select public.interschool_issue_certificates($1)", [c.id], /IS_RESULTS_NOT_FINAL/);
    await t.openRound(c.rounds[1]); await t.play(uid(1, 1), c.rounds[1], 4); await t.play(uid(2, 1), c.rounds[1], 2);
    await finalise(c.rounds[1]);
    await t.as(ADMIN);
    const first = await t.rpc<any>("select public.interschool_issue_certificates($1)", [c.id]);
    expect((await t.rpc<any>("select public.interschool_issue_certificates($1)", [c.id])).issued).toBe(0);
    const kinds = await t.q<any>("select kind, count(*)::int n from quizbox_interschool.certificates where competition_id=$1 group by kind order by kind", [c.id]);
    expect(kinds).toEqual([{ kind: "CHAMPION_SCHOOL", n: 1 }, { kind: "FINALIST", n: 2 }, { kind: "PARTICIPATION", n: 3 }, { kind: "WINNER", n: 1 }]);
    expect(first.total).toBe(7);
    await t.as(uid(1, 1));
    const mine = await t.rpc<any[]>("select public.interschool_my_certificates()");
    expect(mine.map((m) => m.kind).sort()).toEqual(["FINALIST", "PARTICIPATION", "WINNER"]);
    await t.as("service");
    expect(await t.rpc<any>("select public.interschool_verify_certificate($1)", [mine[0].code.toLowerCase()])).toMatchObject({ valid: true, school: "School 1 Academy" });
    expect(await t.rpc("select public.interschool_verify_certificate('QBC-NOPE')")).toBeNull();
    await t.as(ADMIN); await t.rpc("select public.interschool_revoke_certificate($1,'Issued in error')", [mine[0].code]);
    await t.as("service");
    expect((await t.rpc<any>("select public.interschool_verify_certificate($1)", [mine[0].code])).valid).toBe(false);
  });
  it("sends each reminder once and tells everyone about a cancellation", async () => {
    const c = await field(2, 1);
    await t.q("update quizbox_interschool.competitions set registration_closes_at=now()+interval '20 hours' where id=$1", [c.id]);
    await t.openRound(c.rounds[0], 3, 5);
    await t.as("service");
    const one = await t.rpc<any>("select public.interschool_send_reminders()");
    expect(one.registration).toBeGreaterThanOrEqual(1); expect(one.rounds).toBeGreaterThanOrEqual(1);
    expect(await t.rpc<any>("select public.interschool_send_reminders()")).toEqual({ registration: 0, rounds: 0 });
    await t.as(ADMIN); await t.rpc("select public.interschool_set_status($1,'CANCELLED','Sponsor withdrew')", [c.id]);
    expect((await t.q<any>("select count(*)::int n from public.notifications where title='Competition cancelled'"))[0].n).toBeGreaterThanOrEqual(4);
    expect((await t.rpc<any>("select public.interschool_admin_overview()")).by_status.CANCELLED).toBeGreaterThanOrEqual(1);
  });
  it("re-applies every migration cleanly over a used database", async () => {
    await t.q("select 1");
    for (const m of MIGRATIONS) await db.exec(migration(m));
  });
});

describe("group stages and sponsor privacy", () => {
  // earlier cases leave fixtures behind, and a school cannot be in two at once
  beforeAll(async () => { await t.q("update quizbox_interschool.competitions set status='CANCELLED' where status<>'CANCELLED'"); });
  it("keeps resting schools in a group stage and takes the top school of each group into the knockout", async () => {
    const c = await field(5, 1, { settings: { school_scoring: "FIXTURE_POINTS" }, rounds: (s) => [t.round(1, s, { format: "GROUP" }), t.round(2, s, { format: "GROUP" }), t.round(3, s, { format: "GROUP", rule: "TOP_SCHOOLS", top_n: 1 }), t.round(4, s, { format: "KNOCKOUT", stage: "FINAL", rule: "FIXTURE_WINNERS" })] });
    await t.as(ADMIN);
    await t.rpc("select public.interschool_generate_fixtures($1,'GROUP',2)", [c.divisions[0]]);
    const groups = await t.q<any>("select distinct f.group_no g, s as school from quizbox_interschool.fixtures f join quizbox_interschool.rounds r on r.id=f.round_id cross join lateral unnest(array_remove(array[f.home_institution,f.away_institution],null)) s where r.division_id=$1", [c.divisions[0]]);
    expect(groups).toHaveLength(5);
    const strongest = new Map<number, number>();   // in each group the lowest-numbered school always scores highest
    for (const x of groups) { const n = SCHOOLS.indexOf(x.school) + 1; strongest.set(x.g, Math.min(strongest.get(x.g) ?? 99, n)); }
    for (const round of c.rounds.slice(0, 3)) {
      await t.openRound(round);
      const playing = await t.q<any>("select s as school from quizbox_interschool.fixtures f cross join lateral unnest(array[f.home_institution,f.away_institution]) s where f.round_id=$1 and f.away_institution is not null and f.status='SCHEDULED'", [round]);
      for (const x of playing) { const n = SCHOOLS.indexOf(x.school) + 1; await t.play(uid(n, 1), round, 6 - n); }
      await finalise(round);
    }
    const last = await results(c.rounds[2]);
    expect(last.schools).toHaveLength(5);
    const winners = [...strongest.values()].map((n) => SCHOOLS[n - 1]).sort();
    expect(last.schools.filter((x: any) => x.qualified).map((x: any) => x.institution_id).sort()).toEqual(winners);
    const final = await t.q<any>("select home_institution h, away_institution a from quizbox_interschool.fixtures where round_id=$1", [c.rounds[3]]);
    expect(final).toHaveLength(1);
    expect([final[0].h, final[0].a].sort()).toEqual(winners);
  });
  it("carries a corrected score into the totals of later rounds", async () => {
    const c = await field(2, 1, { settings: { score_carry: "ACCUMULATE" }, rounds: (s) => [t.round(1, s), t.round(2, s)] });
    for (const [i, round] of c.rounds.entries()) { await t.openRound(round); await t.play(uid(1, 1), round, 1); await t.play(uid(2, 1), round, 2 + i); await finalise(round); }
    const candidate = (await t.q<any>("select id from quizbox_interschool.candidates where competition_id=$1 and user_id=$2", [c.id, uid(1, 1)]))[0].id;
    await t.as(ADMIN); await t.rpc("select public.interschool_adjust_score($1,$2,5,'Marking appeal upheld')", [c.rounds[0], candidate]);
    const r = await results(c.rounds[1]);
    expect(r.learners.find((l: any) => l.candidate_id === candidate).total_score).toBe(6);
    expect(r.schools.find((s: any) => s.school === "School 1 Academy").total_score).toBe(120);
  });
  it("gives a sponsor organiser school results but no learner, and no learner-level powers", async () => {
    await t.as(ADMIN); await t.rpc("select public.interschool_set_rate(500,0)");
    const c = await t.competition(SPONSOR_OK, { publish: false, settings: { title: "Private cup", funding: "SPONSORED", capacity: 10, expected_participants: 10, sponsor_name: "Gold Bank", participation: "OPEN" } });
    await t.as(SPONSOR_OK);
    const q = await t.rpc<any>("select public.interschool_quote($1)", [c.id]);
    const inv = await t.rpc<any>("select public.interschool_decide_quote($1,true)", [q.id]);
    await t.as(ADMIN); await t.rpc("select public.interschool_fund_invoice($1,'RECORD_PAYMENT','Bank transfer 1')", [inv.id]);
    await t.as(SPONSOR_OK); await t.rpc("select public.interschool_request_approval($1)", [c.id]);
    await t.as(ADMIN); await t.rpc("select public.interschool_decide($1,true,null)", [c.id]);
    await t.as(SPONSOR_OK); await t.rpc("select public.interschool_publish($1)", [c.id]);
    await t.nominate(c.id, 1, c.divisions[0], [uid(1, 1)]);
    const [round] = await t.rounds(c.divisions[0]);
    await t.openRound(round); await t.play(uid(1, 1), round, 3); await finalise(round);
    await t.as(SPONSOR_OK);
    const seen = await t.rpc<any>("select public.interschool_results($1)", [round]);
    expect([seen.schools.length, seen.learners.length]).toEqual([1, 0]);
    const candidate = (await t.q<any>("select id from quizbox_interschool.candidates where competition_id=$1", [c.id]))[0].id;
    await t.as(SPONSOR_OK);
    await err("select public.interschool_disqualify($1,'not wanted')", [candidate], /IS_NOT_AUTHORISED/);
    for (const fn of ["interschool_operations", "interschool_registrations", "interschool_billing", "interschool_manage_get"]) {
      expect(JSON.stringify(await t.rpc(`select public.${fn}($1)`, [c.id]))).not.toMatch(new RegExp(`Learner1|${uid(1, 1)}`));
    }
  });
});

describe("rollback", () => {
  it("removes everything the migrations added, in reverse order, and they apply again", async () => {
    const fresh = await makeDb();
    for (const m of [...MIGRATIONS].reverse()) await fresh.exec(read(`supabase/rollback/${m.replace(/^\d+_/, "")}.sql`));
    const left = await fresh.query<{ n: number }>("select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'interschool%' or n.nspname='quizbox_interschool')::int + (select count(*) from pg_namespace where nspname='quizbox_interschool')::int + (select count(*) from public.platform_settings where key like '%interschool%')::int as n");
    expect(left.rows[0].n).toBe(0);
    for (const m of MIGRATIONS) await fresh.exec(migration(m));
    await fresh.close();
  });
});
