import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createFixtureWorld, destroyFixtureWorld, resolveTarget, sweepStaleRuns, type FixtureWorld } from "../operations/live-fixture";

// Challenges end to end against Preview (self-provisioned: the fixture creates and removes its own users, and the teardown removes their campaigns).
// Needs migrations 20261021100000 and 20261022100000 on Preview; if they are missing the first test fails with a clear message instead of a confusing one.
const questions = (n: number, stage = 1) => Array.from({ length: n }, (_, i) => ({ question_text: `QBRUN stage ${stage} question ${i + 1}?`, options: ["one", "two", "three", "four"], correct_index: i % 4, explanation: "because", stage_no: stage }));

describe.skipIf(process.env.QB_LIVE_ACCEPTANCE !== "1")("challenges acceptance (self-provisioned)", () => {
  let world: FixtureWorld, teacher: SupabaseClient, a: SupabaseClient, b: SupabaseClient, anon: SupabaseClient;
  let campaign: { id: string; slug: string }, keyed: { id: string; correct_index: number }[];

  beforeAll(async () => {
    sweepStaleRuns({ maxAgeMs: 60 * 60 * 1000 });
    world = await createFixtureWorld({ roles: ["teacher", "student", "student2"] });
    [teacher, a, b] = await Promise.all([world.client("teacher"), world.client("student"), world.client("student2")]);
    const t = resolveTarget();
    anon = createClient(t.url, t.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }, 180_000);
  afterAll(async () => { if (world) await destroyFixtureWorld(world); }, 120_000);

  it("has the Challenges migrations applied", async () => {
    const r = await teacher.rpc("challenge_my_campaigns");
    expect(r.error?.message ?? "").not.toMatch(/Could not find the function|PGRST202/);
  });

  it("lets a teacher create, fill and publish a challenge, and a student cannot create one", async () => {
    const denied = await a.rpc("challenge_create", { p_title: "QBRUN nope", p_summary: "", p_category: "general_knowledge", p_visibility: "PUBLIC", p_question_count: 3, p_time_limit_seconds: 300, p_max_attempts: 1 });
    expect(denied.error?.message).toMatch(/NOT_AUTHORIZED/);
    const made = await teacher.rpc("challenge_create", { p_title: `QBRUN ${world.runId} quiz`, p_summary: "run scoped", p_category: "general_knowledge", p_visibility: "PUBLIC", p_question_count: 3, p_time_limit_seconds: 300, p_max_attempts: 1 });
    expect(made.error).toBeNull(); campaign = made.data;
    expect((await teacher.rpc("challenge_set_questions", { p_id: campaign.id, p_questions: questions(3) })).error).toBeNull();
    expect((await teacher.rpc("challenge_publish", { p_id: campaign.id })).error).toBeNull();
    keyed = (await teacher.rpc("challenge_creator_get", { p_id: campaign.id })).data.questions;
    expect((await teacher.rpc("challenge_set_questions", { p_id: campaign.id, p_questions: questions(3) })).error?.message).toMatch(/ONLY_DRAFT_EDITABLE/);
  });

  it("keeps tables and the answer key away from browsers, and nothing is open to anonymous callers", async () => {
    for (const client of [anon, a]) {
      const r = await client.from("challenge_questions").select("*");
      expect(r.error?.message ?? "").toMatch(/permission denied/i);
    }
    expect((await anon.rpc("challenge_public_list")).error?.message ?? "").toMatch(/permission denied|not found|PGRST/i);
    expect((await anon.rpc("challenge_start", { p_slug: campaign.slug })).error).not.toBeNull();
  });

  it("scores a student attempt on the server without sending the key, once only", async () => {
    const started = await a.rpc("challenge_start", { p_slug: campaign.slug }); expect(started.error).toBeNull();
    expect(JSON.stringify(started.data)).not.toMatch(/correct_index|explanation/);
    const answers = started.data.questions.map((q: any, i: number) => ({ question_id: q.id, chosen_index: i === 0 ? keyed.find((k) => k.id === q.id)!.correct_index : (keyed.find((k) => k.id === q.id)!.correct_index + 1) % 4 }));
    const done = await a.rpc("challenge_submit", { p_attempt: started.data.attempt_id, p_answers: answers });
    expect(done.error).toBeNull(); expect(done.data.score).toBe(1); expect(done.data.max_score).toBe(3);
    expect((await a.rpc("challenge_submit", { p_attempt: started.data.attempt_id, p_answers: [] })).data.already_submitted).toBe(true);
    expect((await a.rpc("challenge_start", { p_slug: campaign.slug })).error?.message).toMatch(/NO_ATTEMPTS_LEFT/);
    expect((await b.rpc("challenge_submit", { p_attempt: started.data.attempt_id, p_answers: [] })).error?.message).toMatch(/NOT_FOUND/);
  });

  it("ranks the student and shows analytics to the owner only", async () => {
    const board = await a.rpc("challenge_leaderboard", { p_slug: campaign.slug });
    expect(board.data).toHaveLength(1); expect(board.data[0]).toMatchObject({ rank: 1, score: 1, is_me: true });
    const stats = await teacher.rpc("challenge_analytics", { p_id: campaign.id });
    expect(stats.error).toBeNull(); expect(stats.data).toMatchObject({ started: 1, completed: 1 });
    expect((await b.rpc("challenge_analytics", { p_id: campaign.id })).error?.message).toMatch(/NOT_AUTHORIZED/);
    expect((await teacher.rpc("challenge_set_status", { p_id: campaign.id, p_status: "COMPLETED" })).error).toBeNull();
    expect((await teacher.rpc("challenge_start", { p_slug: campaign.slug })).error).not.toBeNull();
  });
});
