import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryFixture } from "./fixtures/database";

// Isolated PostgreSQL: the shipped analytics contracts (20261006110000) followed by the security fix (20261006120000).
// Fixture users: id(1) sponsor A owner, id(5) sponsor B owner, id(4)/id(6) students, id(3) teacher (no results), id(2) OWNER.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite;
async function as(user: string | null) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec(user ? "set role authenticated" : "set role anon"); }
const call = async <T = any>(fn: string, arg: string | null = null) => (await db.query<{ v: T }>(`select public.${fn}($1::uuid) v`, [arg])).rows[0].v;
const FUNCTIONS = ["qb_student_competition_analytics", "qb_student_achievements", "qb_sponsor_participation_funnel", "qb_sponsor_score_distribution", "qb_sponsor_demographics", "qb_sponsor_question_performance"];

describe("analytics contracts: authorization and real data", () => {
  const sponsorA = randomUUID(), sponsorB = randomUUID(), competition = randomUUID(), question = randomUUID(), school = randomUUID();
  beforeAll(async () => {
    let market: string; ({ db, market } = await createDeliveryFixture());
    await db.exec("reset role");
    await db.exec(read("../../supabase/migrations/20261006110000_analytics_contracts_final.sql"));
    await db.exec(read("../../supabase/migrations/20261006120000_analytics_contracts_security.sql"));
    await db.exec("set session_replication_role=replica");
    await db.query("insert into sponsor_profiles(id,user_id,organization_name) values($1,$2,'Sponsor A'),($3,$4,'Sponsor B')", [sponsorA, id(1), sponsorB, id(5)]);
    await db.query("insert into institutions(id,name) values($1,'Fixture Academy')", [school]);
    await db.query("insert into quizbox_competition.drafts(competition_id,sponsor_id,created_by,configuration,revision) values($1,$2,$3,'{}',1)", [competition, sponsorA, id(1)]);
    await db.query("insert into questions(id,subject_code,subject_name,grade,question_text,option_a,option_b,option_c,option_d,correct_answer,difficulty_label) values($1,'Science','Science','B10','Which gas do plants absorb?','CO2','O2','N2','H2','A','medium')", [question]);
    const snapshot = randomUUID();
    for (const [student, pct, rank] of [[id(4), 100, 1], [id(6), 50, 2]] as const) {
      const attempt = randomUUID(), result = randomUUID();
      await db.query("insert into quizbox_competition.registrations(id,competition_id,snapshot_id,participant_id,market_id,institution_id,eligible,status,eligibility_snapshot,registered_at) values($1,$2,$3,$4,$5,$6,true,'REGISTERED','{}',now())", [randomUUID(), competition, snapshot, student, market, student === id(4) ? school : null]);
      await db.query("insert into quizbox_competition.participations(id,competition_id,snapshot_id,participant_id,attempt_id,attempt_number,eligibility_snapshot) values($1,$2,$3,$4,$5,1,'{}')", [randomUUID(), competition, snapshot, student, attempt]);
      await db.query("insert into quizbox_competition.official_results(id,competition_id,snapshot_id,participant_id,attempt_id,result_id,score,possible_score,percentage,duration_seconds,submitted_at,rank_eligible) values($1,$2,$3,$4,$5,$6,$7,2,$8,30,now(),true)", [result, competition, snapshot, student, attempt, randomUUID(), pct / 50, pct]);
      await db.query("insert into quizbox_competition.leaderboard(competition_id,participant_id,result_id,rank) values($1,$2,$3,$4)", [competition, student, result, rank]);
      await db.query("insert into responses(id,attempt_id,question_id,is_correct,selected_answer) values($1,$2,$3,$4,'A')", [randomUUID(), attempt, question, pct === 100]);
    }
    await db.exec("set session_replication_role=origin");
  }, 180_000);
  afterAll(async () => { await db?.close(); });

  it("denies every analytics function to anonymous callers", async () => {
    await as(null);
    for (const fn of FUNCTIONS) await expect(call(fn, id(4))).rejects.toThrow(/permission denied/);
  });

  it("lets a learner read only their own competition analytics, built from official results", async () => {
    await as(id(4));
    expect(await call("qb_student_competition_analytics")).toMatchObject({ competitions_entered: 1, competitions_completed: 1, latest_score: 100, best_score: 100, current_rank: 1, top_3_finishes: 1, wins: 1 });
    await expect(call("qb_student_competition_analytics", id(6))).rejects.toThrow("NOT_AUTHORIZED");
    await expect(call("qb_student_achievements", id(6))).rejects.toThrow("NOT_AUTHORIZED");
    await as(id(2)); expect(await call("qb_student_competition_analytics", id(6))).toMatchObject({ best_score: 50, current_rank: 2 });
  });

  it("awards achievements only from real results and never fabricates one", async () => {
    await as(id(4)); expect((await call<Array<{ code: string; tier: string }>>("qb_student_achievements")).map((a) => a.code).sort()).toEqual(["FIRST_COMPETITION", "PERFECT_SCORE", "TOP_3", "WINNER"]);
    await as(id(6)); expect((await call<Array<{ code: string }>>("qb_student_achievements")).map((a) => a.code).sort()).toEqual(["FIRST_COMPETITION", "TOP_3"]);
    await as(id(3)); expect(await call("qb_student_achievements")).toEqual([]);
    expect(await call("qb_student_competition_analytics")).toMatchObject({ competitions_entered: 0, competitions_completed: 0, current_rank: null, achievements: [], participation_trend: [] });
  });

  it("computes sponsor analytics from the sponsor's own competitions", async () => {
    await as(id(1));
    expect(await call("qb_sponsor_participation_funnel", sponsorA)).toEqual({ registrations: 2, started: 2, completed: 2, drop_off_rate: 0 });
    expect((await call<Array<{ label: string; value: number }>>("qb_sponsor_score_distribution", sponsorA)).filter((b) => b.value > 0)).toEqual([{ label: "40–59%", value: 1 }, { label: "80–100%", value: 1 }]);
    expect(await call("qb_sponsor_demographics", sponsorA)).toEqual({ markets: [{ label: "Ghana", value: 2 }], institutions: [{ label: "Fixture Academy", value: 1 }] });
    expect(await call("qb_sponsor_question_performance", sponsorA)).toEqual([expect.objectContaining({ label: "Which gas do plants absorb?", difficulty: "medium", attempts: 2, percentage: 50 })]);
  });

  it("keeps sponsors isolated, allowing only owners, active members and Super Admins", async () => {
    await as(id(5));
    for (const fn of FUNCTIONS.slice(2)) await expect(call(fn, sponsorA)).rejects.toThrow("NOT_AUTHORIZED");
    expect(await call("qb_sponsor_participation_funnel")).toEqual({ registrations: 0, started: 0, completed: 0, drop_off_rate: 0 });
    expect(await call("qb_sponsor_score_distribution")).toEqual([]);
    await as(id(4)); await expect(call("qb_sponsor_participation_funnel", sponsorA)).rejects.toThrow("NOT_AUTHORIZED");
    await db.exec("reset role"); await db.exec("set session_replication_role=replica"); await db.query("insert into quizbox_competition.organization_members(sponsor_id,user_id,role,active) values($1,$2,'sponsor_viewer',true)", [sponsorA, id(5)]); await db.exec("set session_replication_role=origin");
    await as(id(5)); expect(await call("qb_sponsor_participation_funnel", sponsorA)).toMatchObject({ registrations: 2 });
    await as(id(2)); expect(await call("qb_sponsor_participation_funnel", sponsorA)).toMatchObject({ completed: 2 });
  });
});
