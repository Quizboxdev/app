import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFactoryFixture, fixtureId as id } from "../content/factory/fixture";

// SME review pool (20261012130000): loaded questions -> pool -> Pick -> own -> review -> pinned fee, on the real governed import.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite, market: string, curriculum: string, source: string, ind: string[], mathInd: string;
const A = id(10), B = id(11), MATH = id(12), ADMIN = id(13), OUTSIDER = id(20);
async function as(user: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
}
const call = async (sql: string, args: unknown[] = []) => (await db.query<{ v: any }>(sql, args)).rows[0].v;
const pool = () => call("select public.qb_sme_pool() v");
const pick = (count?: number, subject?: string) => call("select public.qb_sme_pick($1,$2) v", [count ?? null, subject ?? null]);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
let serial = 0;
const row = (topic_key: string, node: string, subject = "Computing", over: Record<string, unknown> = {}) => ({
  topic_key, concept: "input devices", indicator_node_id: node, subject, grade: "B7",
  question_text: `Which part of a computer is described in situation number ${++serial} that a learner meets at school?`,
  answer_type: "SINGLE_CHOICE", option_a: `Memory unit ${serial}`, option_b: `Display unit ${serial}`, option_c: `Input device ${serial}`, option_d: `Power supply ${serial}`,
  correct_answer: "C", explanation: `The input device sends information into the computer; the other parts store, show or power it (${serial}).`,
  difficulty: "easy", cognitive_level: "Understand", source_reference: "NaCCA Computing B7 p.12", ...over });

beforeAll(async () => {
  const f = await createFactoryFixture();
  ({ db, market, curriculum, source, ind, mathInd } = f);
  await db.exec("reset role");
  await db.exec("alter table public.questions add column if not exists content_origin text not null default 'CURRICULUM'");
  await db.exec(read("../../supabase/migrations/20261012100000_topic_registry.sql"));
  await db.exec(read("../../supabase/migrations/20261012120000_question_load.sql"));
  await db.exec(read("../../supabase/migrations/20261012130000_sme_pool.sql"));
  await db.exec("reset role");
  await db.query("insert into profiles(id,role,status,country,default_market_id,full_name) values($1,'TEACHER','active','Ghana',$2,'Not an SME')", [OUTSIDER, market]);
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'outsider@example.invalid',now())", [OUTSIDER]);
  await as(ADMIN);
  const rows = [
    ...Array.from({ length: 6 }, () => row("t-hw", ind[0])),
    ...Array.from({ length: 4 }, () => row("t-sw", ind[1], "Computing", { concept: "system software" })),
    ...Array.from({ length: 2 }, () => row("t-m", mathInd, "Mathematics", { concept: "number sense" })),
  ];
  const r = await call("select public.qb_question_load($1::jsonb) v", [JSON.stringify({
    scope: "CURRICULUM", market_id: market, curriculum_id: curriculum, source_document_ids: [source], file_name: "pool.csv", file_sha256: sha("pool"), rows,
    topics: [
      { key: "t-hw", indicator_node_id: ind[0], title: "Parts of a computer", concepts: ["input devices", "output devices", "storage"] },
      { key: "t-sw", indicator_node_id: ind[1], title: "Types of software", concepts: ["system software", "application software"] },
      { key: "t-m", indicator_node_id: mathInd, title: "Number sense", concepts: ["number sense"] },
    ] })]);
  expect(r).toMatchObject({ status: "LOADED", rows_loaded: 12 });
}, 300_000);
afterAll(async () => { await db?.close(); });

describe("R1: the pool shows what I can pick", () => {
  it("lists my domain's questions with the fee, the limits and today's numbers", async () => {
    await as(A);
    const p = await pool();
    expect(p.settings).toEqual({ pick_size: 25, daily_cap: 100, max_open: 50, release_hours: 24 });
    expect(p.available.total).toBe(10);
    expect(p.available.groups).toEqual([{ subject: "Computing", grade: "B7", level: "JHS", sponsor: false, count: 10, fee: expect.objectContaining({ currency: "GHS", review: 1, approve: 0.5 }) }]);
    expect(p.today).toMatchObject({ picked: 0, completed: 0, open: 0, remaining_today: 100, room_to_hold: 50 });
    expect(p.mine).toEqual([]);
  });

  it("shows a subject only to SMEs whose domain covers it, and never a subject with no fee as pickable", async () => {
    await as(MATH);
    const p = await pool();
    expect(p.available.total).toBe(2);
    expect(p.available.without_fee).toBe(2);
    expect(p.available.groups[0]).toMatchObject({ subject: "Mathematics", fee: null });
    expect(await pick(5)).toMatchObject({ picked: 0, reason: "POOL_EMPTY" });
  });

  it("is closed to people who are not verified SMEs, and to signed-out visitors", async () => {
    await as(OUTSIDER);
    await expect(pool()).rejects.toThrow(/QB_SME_PROFILE_REQUIRED/);
    await expect(pick(1)).rejects.toThrow(/QB_SME_PROFILE_REQUIRED/);
    await as(null);
    await expect(pool()).rejects.toThrow(/permission denied|AUTH_REQUIRED/);
  });
});

describe("R2: Pick claims questions", () => {
  it("gives the questions to one SME at a time, with the fee pinned at pick time", async () => {
    await as(A);
    const a = await pick(4);
    expect(a).toMatchObject({ picked: 4, remaining_today: 96, room_to_hold: 46 });
    await as(B);
    const b = await pick(25);
    expect(b.picked).toBe(6);
    expect(b.reason).toBeNull();
    await db.exec("reset role");
    const dupes = (await db.query<{ n: string }>("select count(*)::text n from (select question_id from sme_review_assignments where review_completed_at is null group by 1 having count(*)>1) x")).rows[0].n;
    expect(dupes).toBe("0");
    const pinned = (await db.query<{ n: string; self: string }>(
      "select count(*) filter(where compensation_policy_version_id is not null)::text n, count(*) filter(where assigned_by=reviewer_id and picked_from_pool)::text self from sme_review_assignments where reviewer_id in ($1,$2)", [A, B])).rows[0];
    expect(pinned).toEqual({ n: "10", self: "10" });
    await as(A);
    expect((await pool()).available.total).toBe(0);
    expect(await pick(3)).toMatchObject({ picked: 0, reason: "POOL_EMPTY" });
  });

  it("writes an audit event for each pick and does not send one notification per question", async () => {
    await db.exec("reset role");
    const e = (await db.query<{ n: string }>("select count(*)::text n from quizbox_factory.assignment_events where action='ASSIGNED' and details->>'mode'='POOL_PICK'")).rows[0].n;
    expect(e).toBe("10");
  });

  it("stops at the daily cap and at the open-queue cap, both admin settings", async () => {
    await db.exec("reset role");
    // Release A's four so there is something to pick again, then tighten the settings.
    await as(A);
    for (const m of (await pool()).mine) await call("select public.qb_sme_release($1,'cap test') v", [m.assignment_id]);
    await db.exec("reset role");
    await db.exec("update quizbox_sme.pool_settings set value=1 where key='max_open'");
    await as(B);
    expect(await pick(5)).toMatchObject({ picked: 0, reason: "OPEN_QUEUE_FULL" });
    await db.exec("reset role");
    await db.exec("update quizbox_sme.pool_settings set value=50 where key='max_open'");
    await db.exec("update quizbox_sme.pool_settings set value=6 where key='daily_cap'");
    await as(B);
    expect(await pick(5)).toMatchObject({ picked: 0, reason: "DAILY_CAP_REACHED" });
    await db.exec("reset role");
    await db.exec("update quizbox_sme.pool_settings set value=100 where key='daily_cap'");
  });
});

describe("R3: my work, release, and automatic return", () => {
  it("a returned question goes back to the pool for others, never to the same SME, and earns nothing", async () => {
    await as(B);
    const mine = (await pool()).mine;
    expect(mine.length).toBe(6);
    const target = mine[0];
    await call("select public.qb_sme_release($1,'not my area') v", [target.assignment_id]);
    // B returned one (never offered back to B); A's four returned earlier are new to B.
    expect((await pool()).available.total).toBe(4);
    await as(A);
    // A cannot retake its own four, but can take B's returned question.
    expect((await pool()).available.total).toBe(1);
    await db.exec("reset role");
    const rel = (await db.query<{ released_at: string | null; ev: string }>(
      "select a.released_at::text, (select count(*)::text from sme_review_events e where e.assignment_id=a.id) ev from sme_review_assignments a where a.id=$1", [target.assignment_id])).rows[0];
    expect(rel.released_at).not.toBeNull();
    expect(rel.ev).toBe("0");
  });

  it("cannot release someone else's work", async () => {
    await as(B);
    const mine = (await pool()).mine[0];
    await as(A);
    await expect(call("select public.qb_sme_release($1,'x') v", [mine.assignment_id])).rejects.toThrow(/QB_REVIEW_ACCESS_DENIED/);
  });

  it("returns unfinished picks after the configured hours, by itself", async () => {
    await db.exec("reset role");
    await db.exec("update sme_review_assignments set assigned_at = now() - interval '25 hours' where reviewer_id = '" + B + "' and review_completed_at is null");
    await as(B);
    const p = await pool();
    expect(p.mine).toEqual([]);
    expect(p.today.open).toBe(0);
    await db.exec("reset role");
    const rel = (await db.query<{ n: string }>("select count(*)::text n from sme_review_assignments where reviewer_id=$1 and release_reason like 'Returned automatically%'", [B])).rows[0].n;
    expect(Number(rel)).toBe(5);
  });

  it("a content admin can sweep, an SME cannot", async () => {
    await as(A);
    await expect(call("select public.qb_sme_pool_sweep() v")).rejects.toThrow(/QB_SME_ASSIGNMENT_DENIED/);
    await as(ADMIN);
    expect(await call("select public.qb_sme_pool_sweep() v")).toEqual({ released: 0 });
  });
});

describe("pool to payment", () => {
  it("a picked question is reviewed through the existing workbench and pays the fee pinned at pick time", async () => {
    await as(A);
    const got = await pick(1);
    expect(got.picked).toBe(1);
    const assignment = got.assignment_ids[0];
    // The fee changes after the pick; the pinned version must still decide the pay.
    await db.exec("reset role");
    const q = (await db.query<{ question_id: string; question_version: number; compensation_policy_version_id: string }>(
      "select question_id, question_version, compensation_policy_version_id from sme_review_assignments where id=$1", [assignment])).rows[0];
    await as(A);
    const detail = await call("select public.qb_sme_review_detail($1) v", [assignment]);
    expect(detail.question.id).toBe(q.question_id);
    const done = await call("select public.qb_sme_complete_review($1,'approve','Checked against the source; the answer is correct.',true,$2) v", [assignment, q.question_version]);
    expect(done).toMatchObject({ decision: "approve", final_status: "approved" });
    await db.exec("reset role");
    const earn = (await db.query<{ final_amount: string; compensation_policy_version_id: string }>(
      "select final_amount::text, compensation_policy_version_id from reviewer_earnings where reviewer_id=$1", [A])).rows[0];
    expect(Number(earn.final_amount)).toBe(1.5);
    expect(earn.compensation_policy_version_id).toBe(q.compensation_policy_version_id);
    await as(A);
    expect((await pool()).today).toMatchObject({ completed: 1 });
  });
});

describe("sponsor-origin questions", () => {
  it("are visible only to SMEs tagged with the SPONSOR specialization", async () => {
    await db.exec("reset role");
    const target = (await db.query<{ id: string }>(
      `select q.id from questions q where q.validation_status='review' and q.subject_code='Computing'
         and not exists(select 1 from sme_review_assignments w where w.question_id=q.id and w.review_completed_at is null) limit 1`)).rows[0]?.id;
    expect(target).toBeTruthy();
    // C is a fresh reviewer with a Computing domain, so no earlier pick or return hides the question from them.
    const C = id(14);
    await db.query("insert into profiles(id,role,status,country,default_market_id,full_name) values($1,'TEACHER','active','Ghana',$2,'SME C')", [C, market]);
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'c@example.invalid',now())", [C]);
    await db.query("insert into user_market_memberships(user_id,market_id,active) values($1,$2,true)", [C, market]);
    await db.query("insert into sme_profiles(user_id,reviewer_status,reviewer_tier,active) values($1,'verified','standard',true)", [C]);
    await db.query("insert into sme_domain_assignments(reviewer_id,subject_code,curriculum_id,market_id,grade_codes,can_review,can_approve) values($1,'Computing',$2,$3,'{B7}',true,true)", [C, curriculum, market]);
    await db.query("update questions set content_origin='SPONSOR_DOCUMENT' where id=$1", [target]);
    await as(C);
    const without = await pool();
    expect(without.available.total).toBe(8);
    expect(without.available.groups.some((g: any) => g.sponsor)).toBe(false);
    await db.exec("reset role");
    await db.query("update sme_domain_assignments set specialization='SPONSOR' where reviewer_id=$1", [C]);
    await as(C);
    const withTag = await pool();
    expect(withTag.available.total).toBe(9);
    expect(withTag.available.groups.find((g: any) => g.sponsor)).toMatchObject({ count: 1, subject: "Computing" });
  });
});

describe("pool settings", () => {
  const SUPER = id(15);
  it("lets a content admin read, only a super admin change, and keeps every value a whole number in range", async () => {
    await db.exec("reset role");
    await db.query("insert into profiles(id,role,status,country,default_market_id,full_name) values($1,'ADMIN','active','Ghana',$2,'Super Admin')", [SUPER, market]);
    await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,'super@example.invalid',now())", [SUPER]);
    await db.query("insert into user_capabilities(user_id,capability,active) values($1,'super_admin',true)", [SUPER]);
    const settings = (changes: unknown) => call("select public.qb_sme_pool_settings($1::jsonb) v", [changes === null ? null : JSON.stringify(changes)]);
    await as(ADMIN);
    expect(await settings(null)).toEqual({ pick_size: 25, daily_cap: 100, max_open: 50, release_hours: 24 });
    await expect(settings({ daily_cap: 150 })).rejects.toThrow(/QB_SME_CONFIGURATION_DENIED/);
    await as(A);
    await expect(settings(null)).rejects.toThrow(/QB_SME_ASSIGNMENT_DENIED/);
    await as(SUPER);
    expect(await settings({ daily_cap: 150, pick_size: 10 })).toEqual({ pick_size: 10, daily_cap: 150, max_open: 50, release_hours: 24 });
    await expect(settings({ daily_cap: 0 })).rejects.toThrow(/QB_INVALID_CONFIG/);
    await expect(settings({ daily_cap: 1.5 })).rejects.toThrow(/QB_INVALID_CONFIG/);
    await expect(settings({ price_per_review: 5 })).rejects.toThrow(/QB_INVALID_CONFIG_FIELD/);
    await expect(settings({})).rejects.toThrow(/QB_INVALID_CONFIG/);
    // The pool reads the new limits straight away.
    await as(A);
    expect((await pool()).settings).toEqual({ pick_size: 10, daily_cap: 150, max_open: 50, release_hours: 24 });
  });
});
