import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Challenges extensions: rounds, uploaded source passages, prizes, branding, analytics (isolated PostgreSQL; foundation applied first, both unchanged).
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const FOUNDATION = read("../../supabase/migrations/20261021100000_challenges_foundation.sql");
const MIGRATION = read("../../supabase/migrations/20261022100000_challenges_extensions.sql");
const ROLLBACK = read("../../supabase/rollback/challenges_extensions.sql");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [OWNER, TEACHER, P1, P2, P3, OTHER_TEACHER, CHILD] = [1, 2, 3, 4, 5, 6, 7].map(id);
let db: PGlite;
const as = async (user: string | null | "service") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
};
const rpc = async (sql: string, params: unknown[] = []) => Object.values((await db.query<Record<string, any>>(sql, params)).rows[0] ?? {})[0] as any;
const fails = async (sql: string, params: unknown[], message: RegExp) => { await expect(db.query(sql, params)).rejects.toThrow(message); };
const mkq = (n: number, stage = 1, extra: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ question_text: `Stage ${stage} question ${i + 1} text?`, options: ["one", "two", "three", "four"], correct_index: 0, explanation: "because", stage_no: stage, ...extra }));
const create = (title: string, category = "general_knowledge", count = 3, attempts = 2, seconds = 600) =>
  rpc("select public.challenge_create($1,'x',$2,'PUBLIC',$3,$4,$5)", [title, category, count, seconds, attempts]);
const key = async (cid: string) => (await rpc("select public.challenge_creator_get($1)", [cid])).questions as any[];
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role;
    create table public.profiles(id uuid primary key, role text, status text, full_name text, email text);
    create table public.student_profiles(id uuid primary key default gen_random_uuid(), user_id uuid, managed_by uuid);
    create table public.user_capabilities(user_id uuid not null, capability text not null constraint user_capabilities_capability_check check (capability in ('super_admin')), active boolean not null default true);
    create table public.audit_logs(id uuid primary key default gen_random_uuid(), actor_user_id uuid, action text, entity_type text, entity_id uuid, status text, details jsonb);
    create table public.questions(id uuid primary key default gen_random_uuid(), subject_code text, grade text, question_text text, option_a text, option_b text, option_c text, option_d text, correct_answer text, explanation text, status text default 'active', answer_type text default 'SINGLE_CHOICE');
    insert into public.profiles values ('${OWNER}','OWNER','active','Site Owner','owner@example.com'),('${TEACHER}','TEACHER','active','Efua Mensah','efua@example.com'),('${P1}','STUDENT','active','Kofi Boateng','kofi@example.com'),
      ('${P2}','STUDENT','active','Abena Owusu','abena@example.com'),('${P3}','STUDENT','active','Yaw Darko','yaw@example.com'),('${OTHER_TEACHER}','TEACHER','active','Yaw Asante','ya@example.com'),('${CHILD}','STUDENT','active','Ama',null);
    insert into public.student_profiles(user_id, managed_by) values ('${CHILD}','${TEACHER}');
  `);
  await db.exec(FOUNDATION);
  await db.exec(MIGRATION);
});
afterAll(async () => { await db.close(); });

describe("challenges extensions", () => {
  it("re-applies cleanly", async () => { await db.exec(MIGRATION); });

  it("runs a two round challenge: round two unlocks only after the pass mark, and the leaderboard totals both rounds", async () => {
    await as(TEACHER);
    const c = await create("Two Rounds", "general_knowledge", 3, 2);
    await fails("select public.challenge_set_stages($1,$2)", [c.id, "[]"], /INVALID_STAGES/);
    await rpc("select public.challenge_set_stages($1,$2)", [c.id, JSON.stringify([
      { title: "Qualifier", question_count: 3, time_limit_seconds: 300, pass_percent: 60 }, { title: "Final", question_count: 3, time_limit_seconds: 300, pass_percent: 0 }])]);
    await fails("select public.challenge_publish($1)", [c.id], /NOT_ENOUGH_QUESTIONS/);
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify([...mkq(3, 1), ...mkq(3, 2)])]);
    await fails("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(3, 3))], /INVALID_QUESTIONS/);
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify([...mkq(3, 1), ...mkq(3, 2)])]);
    await rpc("select public.challenge_publish($1)", [c.id]);
    const k = await key(c.id);

    await as(P1);
    await fails("select public.challenge_start($1,null,2)", [c.slug], /STAGE_LOCKED/);
    const progress0 = await rpc("select public.challenge_my_progress($1)", [c.slug]);
    expect(progress0.map((s: any) => s.state)).toEqual(["OPEN", "LOCKED"]);
    const s1 = await rpc("select public.challenge_start($1)", [c.slug]);
    expect(s1.stage_no).toBe(1); expect(s1.stage_title).toBe("Qualifier");
    const wrongAll = s1.questions.map((q: any) => ({ question_id: q.id, chosen_index: (k.find((x) => x.id === q.id).correct_index + 1) % 4 }));
    await rpc("select public.challenge_submit($1,$2)", [s1.attempt_id, JSON.stringify(wrongAll)]);
    await fails("select public.challenge_start($1,null,2)", [c.slug], /STAGE_LOCKED/);          // 0% is below the 60% pass mark
    const s1b = await rpc("select public.challenge_start($1)", [c.slug]);
    expect(s1b.stage_no).toBe(1);                                                                   // a second try at round one
    const rightAll = s1b.questions.map((q: any) => ({ question_id: q.id, chosen_index: k.find((x) => x.id === q.id).correct_index }));
    expect((await rpc("select public.challenge_submit($1,$2)", [s1b.attempt_id, JSON.stringify(rightAll)])).score).toBe(3);
    const s2 = await rpc("select public.challenge_start($1,null,2)", [c.slug]);
    expect(s2.stage_no).toBe(2); expect(s2.questions).toHaveLength(3);
    const two = s2.questions.map((q: any, i: number) => ({ question_id: q.id, chosen_index: i === 0 ? k.find((x) => x.id === q.id).correct_index : (k.find((x) => x.id === q.id).correct_index + 1) % 4 }));
    await rpc("select public.challenge_submit($1,$2)", [s2.attempt_id, JSON.stringify(two)]);
    const progress = await rpc("select public.challenge_my_progress($1)", [c.slug]);
    expect(progress.map((s: any) => [s.state, s.best_score])).toEqual([["USED", 3], ["OPEN", 1]]);
    const board = await rpc("select public.challenge_leaderboard($1)", [c.slug]);
    expect(board).toHaveLength(1); expect(board[0]).toMatchObject({ rank: 1, score: 4, max_score: 6, stages_done: 2, name: "Kofi B." });
  });

  it("stores uploaded passages by version and keeps questions tied to a verbatim quote", async () => {
    await as(TEACHER);
    const c = await create("Book Week", "book", 3, 1);
    const chunks = [{ heading: "Chapter 1", body: "Ananse wanted all the wisdom in the world, so he gathered it in a clay pot." }, { heading: "Chapter 2", body: "He tried to hide the pot at the top of a tall tree." }];
    await fails("select public.challenge_content_add($1,'The Tale','book','tale.txt',null,$2,false)", [c.id, JSON.stringify(chunks)], /RIGHTS_NOT_CONFIRMED/);
    const added = await rpc("select public.challenge_content_add($1,'The Tale','book','tale.txt',repeat('a',64),$2,true)", [c.id, JSON.stringify(chunks)]);
    expect(added.version).toBe(1); expect(added.chunks).toBe(2);
    const v2 = await rpc("select public.challenge_content_add($1,'The Tale','book','tale2.txt',null,$2,true,$3)", [c.id, JSON.stringify([chunks[0]]), added.asset_id]);
    expect(v2.version).toBe(2); expect(v2.asset_id).toBe(added.asset_id);
    const list = await rpc("select public.challenge_content_list($1)", [c.id]);
    expect(list[0].versions.map((v: any) => v.version)).toEqual([2, 1]);
    const got = await rpc("select public.challenge_content_chunks($1,$2)", [c.id, added.version_id]);
    expect(got).toHaveLength(2);
    const chunk = got[0].id;
    await fails("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(3, 1, { source_chunk_id: chunk, source_quote: "Ananse hid the pot in the river" }))], /QUOTE_NOT_IN_SOURCE/);
    await fails("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(3, 1, { source_chunk_id: id(999) }))], /INVALID_SOURCE/);
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(2, 1, { source_chunk_id: chunk, source_quote: "gathered it in a  CLAY pot" }).concat(mkq(1, 1)))]);
    await fails("select public.challenge_publish($1)", [c.id], /NOT_GROUNDED/);                       // one question has no passage
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(3, 1, { source_chunk_id: chunk, source_quote: "Ananse wanted all the wisdom" }))]);
    await rpc("select public.challenge_publish($1)", [c.id]);
    await as(OTHER_TEACHER);
    await fails("select public.challenge_content_list($1)", [c.id], /NOT_AUTHORIZED/);
    await as(P1); await fails("select public.challenge_content_chunks($1,$2)", [c.id, added.version_id], /NOT_AUTHORIZED/);
  });

  it("records prizes, awards them to the final ranking and tracks delivery", async () => {
    await as(TEACHER);
    const c = await create("Prize Quiz", "general_knowledge", 3, 1);
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(3))]);
    await fails("select public.challenge_set_prizes($1,$2)", [c.id, JSON.stringify([{ rank_from: 3, rank_to: 1, title: "Bad range" }])], /check|violates/);
    expect((await rpc("select public.challenge_set_prizes($1,$2)", [c.id, JSON.stringify([{ rank_from: 1, title: "Tablet", kind: "goods" }, { rank_from: 2, rank_to: 3, title: "Certificate", kind: "certificate" }])])).count).toBe(2);
    await rpc("select public.challenge_publish($1)", [c.id]);
    const k = await key(c.id);
    const run = async (user: string, correct: number) => {
      await as(user); const s = await rpc("select public.challenge_start($1)", [c.slug]);
      await rpc("select public.challenge_submit($1,$2)", [s.attempt_id, JSON.stringify(s.questions.map((q: any, i: number) => ({ question_id: q.id, chosen_index: i < correct ? k.find((x) => x.id === q.id).correct_index : (k.find((x) => x.id === q.id).correct_index + 1) % 4 })))]);
    };
    await run(P1, 3); await run(P2, 2); await run(P3, 1);
    await db.exec("reset role"); await db.exec(`insert into public.challenge_attempts(campaign_id,user_id,stage_no,attempt_no,question_ids,expires_at,submitted_at,score,max_score,duration_ms) select '${c.id}','${CHILD}',1,1,'{}',now(),now(),3,3,10`);
    await as(TEACHER);
    await fails("select public.challenge_finalize($1)", [c.id], /INVALID_TRANSITION/);              // still live
    await rpc("select public.challenge_set_status($1,'COMPLETED')", [c.id]);
    await fails("select public.challenge_set_prizes($1,'[]')", [c.id], /ONLY_DRAFT_EDITABLE/);
    expect((await rpc("select public.challenge_finalize($1)", [c.id])).awards).toBe(3);
    expect((await rpc("select public.challenge_finalize($1)", [c.id])).already_finalized).toBe(true);
    const list = await rpc("select public.challenge_awards_list($1)", [c.id]);
    expect(list.map((a: any) => [a.rank, a.prize, a.name])).toEqual([[1, "Tablet", "Kofi Boateng"], [2, "Certificate", "Abena Owusu"], [3, "Certificate", "Yaw Darko"]]);   // the managed child is never ranked
    expect(list[0].email).toBe("kofi@example.com");
    await as(OTHER_TEACHER); await fails("select public.challenge_award_update($1,'FULFILLED')", [list[0].award_id], /NOT_AUTHORIZED/);
    await as(TEACHER); await rpc("select public.challenge_award_update($1,'FULFILLED','Handed over at school')", [list[0].award_id]);
    await as(P1); const mine = await rpc("select public.challenge_my_awards()");
    expect(mine).toHaveLength(1); expect(mine[0]).toMatchObject({ prize: "Tablet", status: "FULFILLED", rank: 1 });
    await as(P2); expect((await rpc("select public.challenge_my_awards()"))[0].status).toBe("PENDING");
    await as(P3); await fails("select public.challenge_award_update($1,'FULFILLED')", [list[2].award_id], /NOT_AUTHORIZED/);
  });

  it("validates branding and shows it on the public card without exposing anything private", async () => {
    await as(TEACHER);
    const c = await create("Brand Quiz", "school", 3, 1);
    await fails("select public.challenge_set_brand($1,$2)", [c.id, JSON.stringify({ accent: "red" })], /INVALID_BRAND/);
    await fails("select public.challenge_set_brand($1,$2)", [c.id, JSON.stringify({ logo_url: "https://evil.example/x.png" })], /INVALID_BRAND/);
    await fails("select public.challenge_set_brand($1,$2)", [c.id, JSON.stringify({ tagline: "x".repeat(200) })], /INVALID_BRAND/);
    const set = await rpc("select public.challenge_set_brand($1,$2)", [c.id, JSON.stringify({ organiser_name: "Accra Academy", accent: "#1A7F5A", tagline: "Think fast", welcome: "Good luck" })]);
    expect(set.brand.accent).toBe("#1a7f5a");
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(3))]); await rpc("select public.challenge_publish($1)", [c.id]);
    await as("service");
    const card = await rpc("select public.challenge_public_get($1)", [c.slug]);
    expect(card.brand.organiser_name).toBe("Accra Academy"); expect(card.stage_count).toBe(1);
    expect(JSON.stringify(card)).not.toMatch(/correct_index|access_code|owner_id/);
  });

  it("reports analytics to the owner only", async () => {
    await as(TEACHER);
    const c = await create("Stats Quiz", "general_knowledge", 3, 3);
    await rpc("select public.challenge_set_questions($1,$2)", [c.id, JSON.stringify(mkq(3))]); await rpc("select public.challenge_publish($1)", [c.id]);
    const k = await key(c.id);
    await as("service"); await db.query("select public.challenge_track_view($1)", [c.slug]); await db.query("select public.challenge_track_view($1)", [c.slug]);
    for (const [user, correct] of [[P1, 3], [P2, 1]] as const) {
      await as(user); const s = await rpc("select public.challenge_start($1)", [c.slug]);
      await rpc("select public.challenge_submit($1,$2)", [s.attempt_id, JSON.stringify(s.questions.map((q: any, i: number) => ({ question_id: q.id, chosen_index: i < correct ? k.find((x) => x.id === q.id).correct_index : (k.find((x) => x.id === q.id).correct_index + 1) % 4 })))]);
    }
    await as(P3); await rpc("select public.challenge_start($1)", [c.slug]);   // started, never finished
    await as(TEACHER);
    const a = await rpc("select public.challenge_analytics($1)", [c.id]);
    expect(a).toMatchObject({ views: 2, started: 3, players: 3, completed: 2, expired: 0 });
    expect(a.avg_score_percent).toBe(66.7);
    expect(a.stages).toEqual([{ stage_no: 1, started: 3, completed: 2, players: 3 }]);
    expect(a.questions).toHaveLength(3); expect(a.distribution.length).toBeGreaterThan(0);
    await as(OTHER_TEACHER); await fails("select public.challenge_analytics($1)", [c.id], /NOT_AUTHORIZED/);
    await as(OWNER); expect((await rpc("select public.challenge_analytics($1)", [c.id])).started).toBe(3);
    const overview = await rpc("select public.challenge_admin_overview()");
    expect(overview.players_30d).toBeGreaterThanOrEqual(3); expect(overview.top.length).toBeGreaterThan(0);
    await as(TEACHER); await fails("select public.challenge_admin_overview()", [], /NOT_AUTHORIZED/);
  });

  it("the rollback leaves the foundation working, and the extensions can be applied again", async () => {
    await db.exec("reset role"); await db.exec(ROLLBACK); await db.exec(FOUNDATION);
    expect(await rpc("select count(*)::int from pg_proc where proname in ('challenge_analytics','challenge_finalize','challenge_set_stages')")).toBe(0);
    expect(await rpc("select to_regclass('public.challenge_stages') is null")).toBe(true);
    await db.exec(MIGRATION);
  });
});
