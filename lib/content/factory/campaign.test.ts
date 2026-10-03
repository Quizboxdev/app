import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeliveryFixture } from "../../competition/fixtures/database";
import { executeCampaignJobs, nearDuplicates, type FactoryRpc } from "./campaign";
import { apportion, campaignEstimate, parseImport, precheckRows } from "./import";
import type { QuestionProvider } from "./generation";

// Isolated PostgreSQL: Content Factory + SME Workforce over the real governance, ingest and SME review SQL.
// Actors: id(2) OWNER (super admin), id(10)/id(11) Computing SMEs A/B, id(12) Mathematics-only SME, id(13) Ghana content admin.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
let db: PGlite;
async function as(user: string | null) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ?? ""]); await db.exec(user ? "set role authenticated" : "set role anon"); }
const factory = async <T = any>(action: string, data: Record<string, unknown> = {}) => (await db.query<{ v: T }>("select public.qb_content_factory($1,$2::jsonb) v", [action, JSON.stringify(data)])).rows[0].v;
const workforce = async <T = any>(action: string, data: Record<string, unknown> = {}) => (await db.query<{ v: T }>("select public.qb_sme_workforce($1,$2::jsonb) v", [action, JSON.stringify(data)])).rows[0].v;
// Direct fixture SQL runs as the database owner with no end-user identity.
const sql = async <T = any>(text: string, args: unknown[] = []) => { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub','',false)"); return (await db.query<T>(text, args)).rows; };
const rpc: FactoryRpc = async (name, args) => {
  const keys = Object.keys(args); const casts = keys.map((k, i) => `${k}=>$${i + 1}${typeof args[k] === "object" ? "::jsonb" : ""}`).join(",");
  return (await db.query<{ v: any }>(`select public.${name}(${casts}) v`, keys.map((k) => typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]))).rows[0].v;
};
let serial = 0;
// Deterministic local provider: unique, structurally valid candidates for the requested indicator.
const provider = (overrides: (i: number, spec: any) => Record<string, unknown> = () => ({})): QuestionProvider => ({ name: "mock", model: "fixture", async generate(_prompt, spec) {
  return Array.from({ length: spec.count }, (_, i) => ({ external_question_id: `p-${i}`, curriculum_node_id: spec.indicatorId, question_text: `Factory question ${++serial} about ${spec.indicatorCode} at ${spec.difficulty} level?`,
    answer_type: "SINGLE_CHOICE", option_a: `Alpha ${serial}`, option_b: `Bravo ${serial}`, option_c: `Charlie ${serial}`, option_d: `Delta ${serial}`, correct_answer: "A", explanation: "Alpha is supported by the source.",
    difficulty_label: spec.difficulty, cognitive_level: spec.cognitiveLevel, marks: 1, estimated_time_seconds: 60, source_type: "AI_GENERATED", ...overrides(i, spec) }));
} });

describe("Content Factory and SME workforce scheduler", () => {
  const curriculum = randomUUID(), source = randomUUID(), foreignSource = randomUUID(), subjectNode = randomUUID(), strand = randomUUID();
  const ind = [randomUUID(), randomUUID(), randomUUID()], mathInd = randomUUID();
  let market: string, testland: string, demo: string;
  const base = () => ({ name: "Ghana Computing B7 demo", market_id: market, curriculum_id: curriculum, target_question_count: 40, batch_size: 10, provider: "mock", model: "fixture",
    source_scope: { source_document_ids: [source], subject_codes: ["Computing"], grade_codes: ["B7"], node_ids: [ind[0], ind[1]] }, difficulty_mix: { easy: 50, medium: 50 }, cognitive_mix: { Recall: 100 } });

  beforeAll(async () => {
    ({ db, market } = await createDeliveryFixture());
    await db.exec("reset role");
    // Live-schema objects that the slim fixture omits: full import batch/staging tables and the real ingest core.
    await db.exec(`alter table curriculum_nodes add column if not exists parent_id uuid;
      alter table content_import_batches alter column id set default gen_random_uuid(), add column if not exists source_file text, add column if not exists source_hash text unique, add column if not exists status text,
        add column if not exists started_at timestamptz default now(), add column if not exists completed_at timestamptz, add column if not exists records_detected int, add column if not exists valid_records int,
        add column if not exists warning_records int, add column if not exists rejected_records int, add column if not exists inserted_records int, add column if not exists updated_records int,
        add column if not exists duplicates_skipped int, add column if not exists report jsonb default '{}', add column if not exists source_type text, add column if not exists provider text, add column if not exists model_version text;
      create table question_import_staging(id uuid primary key default gen_random_uuid(),import_batch_id uuid not null,row_number int not null,external_source_id text,normalized_payload jsonb not null,fingerprint text not null,classification text not null,issues jsonb,imported_question_id uuid,created_at timestamptz default now());`);
    const security = read("../../../supabase/migrations/20261002170000_production_readiness_security.sql");
    const start = security.indexOf("CREATE OR REPLACE FUNCTION public.qb_content_ingest("), end = security.indexOf("end $function$", start) + "end $function$".length;
    await db.exec(security.slice(start, end).replace("public.qb_content_ingest(", "quizbox_private.core_qb_content_ingest(")
      .replace(" perform quizbox_private.enforce_budget('qb_content_ingest',20,3600);", " p_spec:=quizbox_market.generation_context(p_spec);") + ";");
    await db.exec(read("../../../supabase/migrations/20261005100000_content_factory.sql"));

    const authority = (await db.query<{ id: string }>("select id from curriculum_authorities where market_id=$1 limit 1", [market])).rows[0].id;
    await db.query("insert into curricula(id,code,country,market_id) values($1,'GH-FAC','Ghana',$2)", [curriculum, market]);
    await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [curriculum, market, authority]);
    await db.query("insert into curriculum_nodes(id,curriculum_id,node_type,code,title,subject_code,grade_code,canonical_grade_code,education_level,is_active) values($1,$2,'subject','B7.COMP','Computing','Computing','B7','B7','JHS',true)", [subjectNode, curriculum]);
    await db.query("insert into curriculum_nodes(id,curriculum_id,parent_id,node_type,code,title,subject_code,grade_code,canonical_grade_code,education_level,is_active) values($1,$2,$3,'strand','B7.1','Introduction to computing','Computing','B7','B7','JHS',true)", [strand, curriculum, subjectNode]);
    for (const [i, node] of ind.entries()) await db.query("insert into curriculum_nodes(id,curriculum_id,parent_id,node_type,code,title,subject_code,grade_code,canonical_grade_code,education_level,is_active) values($1,$2,$3,'learning_indicator',$4,$5,'Computing','B7','B7','JHS',true)", [node, curriculum, strand, `B7.1.1.1.${i + 1}`, `Computing indicator ${i + 1}`]);
    await db.query("insert into curriculum_nodes(id,curriculum_id,node_type,code,title,subject_code,grade_code,canonical_grade_code,education_level,is_active) values($1,$2,'learning_indicator','B7.M.1','Number sense','Mathematics','B7','B7','JHS',true)", [mathInd, curriculum]);
    await db.query("insert into source_documents(id,title,checksum,rights_confirmed,market_id,curriculum_id,authority_id,source_kind,validation_status,approved_by,content_text,uploaded_by) values($1,'GH-FAC B7 Computing extract','sum-1',true,$2,$3,$4,'CURRICULUM','approved',$5,'Computing indicators for B7.',$5)", [source, market, curriculum, authority, id(2)]);
    // Testland: a second market with its own curriculum source (never mixable with Ghana).
    await db.query("insert into currencies values('TSD','Test dollar','T$',2,true) on conflict do nothing");
    const country = (await db.query<{ id: string }>("insert into countries(iso2_code,iso3_code,name,default_currency_code,timezone,locale) values('XT','TST','Testland','TSD','UTC','en-XT') returning id")).rows[0].id;
    testland = (await db.query<{ id: string }>("insert into markets(country_id,name,default_currency_code,timezone,locale,status) values($1,'Testland','TSD','UTC','en-XT','ACTIVE') returning id", [country])).rows[0].id;
    const tlCurriculum = randomUUID();
    const tlAuthority = (await db.query<{ id: string }>("insert into curriculum_authorities(market_id,code,name) values($1,'TLEA','Testland authority') returning id", [testland])).rows[0].id;
    await db.query("insert into curricula(id,code,country,market_id) values($1,'TL-FAC','Testland',$2)", [tlCurriculum, testland]);
    await db.query("insert into market_curricula(curriculum_id,market_id,authority_id,active) values($1,$2,$3,true)", [tlCurriculum, testland, tlAuthority]);
    await db.query("insert into source_documents(id,title,checksum,rights_confirmed,market_id,curriculum_id,authority_id,source_kind,validation_status,approved_by,content_text,uploaded_by) values($1,'Testland syllabus','sum-2',true,$2,$3,$4,'CURRICULUM','approved',$5,'Testland.',$5)", [foreignSource, testland, tlCurriculum, tlAuthority, id(2)]);
    for (const [n, name] of [[10, "SME A"], [11, "SME B"], [12, "Math SME"], [13, "Ghana Content Admin"]] as const) {
      await db.query("insert into profiles(id,role,status,country,default_market_id,full_name) values($1,$2,'active','Ghana',$3,$4)", [id(n), n === 13 ? "ADMIN" : "TEACHER", market, name]);
      await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id(n), `user-${n}@example.invalid`]);
      await db.query("insert into user_market_memberships(user_id,market_id,active) values($1,$2,true)", [id(n), market]);
    }
    await db.query("insert into user_capabilities(user_id,capability,active) values($1,'content_admin',true)", [id(13)]);
    for (const [n, subject] of [[10, "Computing"], [11, "Computing"], [12, "Mathematics"]] as const) {
      await db.query("insert into sme_profiles(user_id,reviewer_status,reviewer_tier,active) values($1,'verified','standard',true)", [id(n)]);
      await db.query("insert into sme_domain_assignments(reviewer_id,subject_code,curriculum_id,market_id,grade_codes,can_review,can_approve) values($1,$2,$3,$4,'{B7}',true,true)", [id(n), subject, curriculum, market]);
    }
    const policy = (await db.query<{ id: string }>("insert into compensation_policies(name,market_id,subject_code) values('Ghana Computing review',$1,'Computing') returning id", [market])).rows[0].id;
    await db.query("insert into compensation_policy_versions(policy_id,currency_code,effective_from,base_review_fee,approve_fee,reject_fee,revision_fee,senior_review_fee,funded_by,created_by) values($1,'GHS',now()-interval '1 day',1,0.5,0.25,0.25,2,'QuizBox',$2)", [policy, id(2)]);
  }, 180_000);
  afterAll(async () => { await db?.close(); });

  it("creates market-scoped campaigns and rejects unauthorized sources and invalid mixes", async () => {
    await as(id(4)); await expect(factory("list")).rejects.toThrow("QB_FACTORY_ACCESS_DENIED");
    await as(id(2));
    await expect(factory("create", { ...base(), source_scope: { ...base().source_scope, source_document_ids: [] } })).rejects.toThrow("QB_FACTORY_SOURCES_REQUIRED");
    await expect(factory("create", { ...base(), source_scope: { ...base().source_scope, source_document_ids: [foreignSource] } })).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
    await expect(factory("create", { ...base(), difficulty_mix: { easy: 60, medium: 60 } })).rejects.toThrow("QB_FACTORY_INVALID_MIX");
    demo = (await factory("create", base())).id;
    expect(await factory("get", { campaign_id: demo })).toMatchObject({ status: "DRAFT", market: "Ghana", curriculum: "GH-FAC", target_question_count: 40 });
  });

  it("plans a distribution across indicator, difficulty and cognitive level, and lets the admin adjust it", async () => {
    await as(id(2));
    expect(await factory("plan", { campaign_id: demo })).toEqual({ indicators: 2, allocated: 40, target: 40 });
    const plan = (await factory("get", { campaign_id: demo })).plan as Array<{ id: string; indicator_code: string; difficulty: string; target_count: number; strand_title: string }>;
    expect(plan.map((p) => [p.indicator_code, p.difficulty, p.target_count])).toEqual([["B7.1.1.1.1", "easy", 10], ["B7.1.1.1.1", "medium", 10], ["B7.1.1.1.2", "easy", 10], ["B7.1.1.1.2", "medium", 10]]);
    expect(plan[0].strand_title).toBe("Introduction to computing");
    expect(await factory("adjust", { campaign_id: demo, allocations: [{ id: plan[0].id, target_count: 11 }] })).toMatchObject({ allocated: 41, ready: false });
    expect(await factory("adjust", { campaign_id: demo, allocations: [{ id: plan[0].id, target_count: 10 }] })).toMatchObject({ allocated: 40, ready: true });
    expect(await factory("estimate", { campaign_id: demo })).toMatchObject({ expected_jobs: 4, executions_needed: 1, estimated_primary_reviews: 40, currency_cost: null, confirmation_required: false });
    expect(apportion(40, { a: 1, b: 1, c: 1 })).toEqual({ a: 14, b: 13, c: 13 });
    expect(campaignEstimate(50000, 25, 5, true)).toEqual({ jobs: 2000, executions: 400, primaryReviews: 50000, seniorReviews: 50000 });
  });

  it("requires explicit typed confirmation before starting a large campaign", async () => {
    await as(id(2));
    const big = (await factory("create", { ...base(), name: "Large confirmation check", target_question_count: 20, large_campaign_threshold: 10 })).id;
    await factory("plan", { campaign_id: big });
    await expect(factory("start", { campaign_id: big })).rejects.toThrow("QB_FACTORY_CONFIRMATION_REQUIRED");
    expect(await factory("start", { campaign_id: big, confirm: "Large confirmation check" })).toMatchObject({ status: "RUNNING" });
    expect(await factory("get", { campaign_id: big })).toMatchObject({ confirmed_by: id(2) });
    expect(await factory("cancel", { campaign_id: big })).toMatchObject({ status: "CANCELLED", jobs: { cancelled: 4, queued: 0 } });
  });

  it("splits a campaign into bounded jobs and honours pause/resume", async () => {
    await as(id(2));
    expect(await factory("start", { campaign_id: demo })).toEqual({ status: "RUNNING", jobs: 4 });
    const jobs = await factory<Array<{ requested_count: number; status: string }>>("jobs", { campaign_id: demo });
    expect(jobs.map((j) => [j.requested_count, j.status])).toEqual(Array(4).fill([10, "QUEUED"]));
    await factory("pause", { campaign_id: demo });
    await expect(factory("claim_jobs", { campaign_id: demo })).rejects.toThrow("QB_FACTORY_NOT_RUNNING");
    await factory("resume", { campaign_id: demo });
  });

  it("generates through the governed ingest, flags duplicates without deleting, and never auto-approves", async () => {
    await as(id(2));
    // One provider output repeats an existing question (exact) - it is ingested but flagged.
    await sql("insert into questions(subject_code,subject_name,grade,question_text,option_a,option_b,option_c,option_d,correct_answer,curriculum_node_id,curriculum_id,validation_status,status) values('Computing','Computing','B7','Which device stores data permanently?','Disk','RAM','Cache','Register','A',$1,$2,'review','inactive')", [ind[0], curriculum]);
    await sql("insert into legacy_content_attributions(question_id,curriculum_id,market_id,reason) select id,$1,$2,'fixture legacy' from questions where question_text='Which device stores data permanently?' on conflict do nothing", [curriculum, market]);
    await as(id(2));
    const first = await executeCampaignJobs(rpc, demo, provider((i) => i === 0 ? { question_text: "Which device stores data permanently?" } : {}));
    expect(first.claimed).toBe(4);
    expect(first.outcomes.map((o) => o.error ?? o.status)).toEqual(Array(4).fill("COMPLETED"));
    const state = await sql<{ n: string; review: string; active: string; dups: string }>(`select count(*) n,count(*) filter(where q.validation_status='review') review,count(*) filter(where q.status::text='active') active,count(*) filter(where q.duplicate_group_id is not null) dups
      from quizbox_factory.campaign_questions cq join questions q on q.id=cq.question_id where cq.campaign_id=$1`, [demo]);
    // The exact duplicate of an existing question is recorded on the job, not accepted; the existing question is untouched.
    expect(Object.values(state[0]).map(Number)).toEqual([36, 36, 0, Number(state[0].dups)]);
    expect(first.outcomes.map((o: any) => o.duplicates_skipped)).toEqual([1, 1, 1, 1]);
    expect((await sql<{ duplicate_group_id: string | null }>("select duplicate_group_id from questions where question_text='Which device stores data permanently?' and import_batch_id is null"))[0].duplicate_group_id).toBeNull();
    await as(id(2));
    expect(await factory("get", { campaign_id: demo })).toMatchObject({ status: "COMPLETED", generated_count: 36, review_pending_count: 36, accepted_count: 0 });
    expect((await factory("operations", { campaign_id: demo })).totals).toMatchObject({ duplicates_not_accepted: 4 });
    expect(nearDuplicates([{ question_text: "What does a CPU do in a computer?" } as never], [{ id: "x", text: "What does a CPU do in a computer" }])).toEqual([{ index: 0, question_id: "x", similarity: 1 }]);
  });

  it("retries failed jobs and auto-pauses after the configured consecutive failures", async () => {
    await as(id(2));
    const flaky = (await factory("create", { ...base(), name: "Failure threshold check", target_question_count: 20, retry_limit: 0, pause_failure_threshold: 2, source_scope: { ...base().source_scope, node_ids: [ind[2]] } })).id;
    await factory("plan", { campaign_id: flaky }); await factory("start", { campaign_id: flaky });
    const result = await executeCampaignJobs(rpc, flaky, { name: "mock", model: "fixture", generate: async () => { throw new Error("GENERATION_PROVIDER_FAILED"); } });
    expect(result.outcomes.map((o) => o.error)).toEqual(["GENERATION_PROVIDER_FAILED", "GENERATION_PROVIDER_FAILED"]);
    expect(await factory("get", { campaign_id: flaky })).toMatchObject({ status: "FAILED", jobs: { failed: 2 } });
    await expect(executeCampaignJobs(rpc, demo, provider())).rejects.toThrow("QB_FACTORY_NOT_RUNNING");
  });

  it("isolates campaigns by market and refuses generation outside the caller's market context", async () => {
    await sql("insert into quizbox_factory.campaigns(name,market_id,curriculum_id,target_question_count,provider,model,created_by,status) values('Testland only',$1,$2,10,'mock','fixture',$3,'RUNNING')", [testland, curriculum, id(2)]);
    await as(id(13));
    const names = (await factory<Array<{ name: string }>>("list")).map((c) => c.name);
    expect(names).toContain("Ghana Computing B7 demo"); expect(names).not.toContain("Testland only");
    const hidden = (await sql<{ id: string }>("select id from quizbox_factory.campaigns where name='Testland only'"))[0].id;
    await as(id(13)); await expect(factory("get", { campaign_id: hidden })).rejects.toThrow("QB_FACTORY_CAMPAIGN_NOT_FOUND");
    // The owner can see it, but generation runs in the caller's (Ghana) content context and is refused.
    await as(id(2)); await expect(factory("claim_jobs", { campaign_id: hidden })).rejects.toThrow("QB_FACTORY_SWITCH_MARKET_CONTEXT");
  });

  it("restricts workload policies to super admins and to the reviewer's authorized domains", async () => {
    await as(id(13)); await expect(workforce("save_policy", { reviewer_id: id(10), assignment_mode: "TOP_UP_QUEUE", target_open_queue: 15, max_open_queue: 20 })).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    await as(id(2));
    await expect(workforce("save_policy", { reviewer_id: id(12), market_id: market, subject_code: "Computing", assignment_mode: "TOP_UP_QUEUE", target_open_queue: 5, max_open_queue: 5 })).rejects.toThrow("QB_POLICY_OUTSIDE_AUTHORIZATION");
    await expect(workforce("save_policy", { reviewer_id: id(10), market_id: market, subject_code: "Computing", assignment_mode: "TOP_UP_QUEUE", target_open_queue: 25, max_open_queue: 20 })).rejects.toThrow();
    const all = [1, 2, 3, 4, 5, 6, 7];
    for (const [n, target] of [[10, 15], [11, 10]] as const) await workforce("save_policy", { reviewer_id: id(n), market_id: market, subject_code: "Computing", assignment_mode: "TOP_UP_QUEUE", target_open_queue: target, max_open_queue: 20, working_days: all });
    await workforce("save_policy", { reviewer_id: id(12), market_id: market, subject_code: "Mathematics", assignment_mode: "FIXED_DAILY", daily_limit: 40, max_open_queue: 40, working_days: all });
  });

  it("tops up queues to capacity, stays idempotent, and never assigns outside authorization", async () => {
    await as(id(13));
    expect((await workforce("run_scheduler", { dry_run: true })).assigned).toBe(0);
    const run = await workforce<{ assigned: number; policies: Array<{ reviewer: string; assigned: number; capacity: number }> }>("run_scheduler");
    expect(Object.fromEntries(run.policies.map((p) => [p.reviewer, p.assigned]))).toEqual({ "SME A": 15, "SME B": 10, "Math SME": 0 });
    expect((await workforce("run_scheduler")).assigned).toBe(0);
    const open = await sql<{ question_id: string; n: string }>("select question_id,count(*) n from sme_review_assignments where review_completed_at is null group by 1 having count(*)>1");
    expect(open).toEqual([]);
    expect((await sql("select 1 from sme_review_assignments w join questions q on q.id=w.question_id where w.reviewer_id=$1", [id(12)])).length).toBe(0);
  });

  it("creates earnings only for completed reviews, then replenishes the queue", async () => {
    const mine = await sql<{ id: string; version: number }>("select w.id,q.version from sme_review_assignments w join questions q on q.id=w.question_id where w.reviewer_id=$1 and w.review_completed_at is null order by w.assigned_at,w.id limit 5", [id(10)]);
    await as(id(10));
    for (const [i, w] of mine.entries()) {
      await db.query("select public.qb_sme_review_detail($1)", [w.id]);
      await db.query("select public.qb_sme_complete_review($1,$2,'Checked against the indicator.',true,$3)", [w.id, i === 4 ? "revision" : "approve", w.version]);
    }
    const earnings = await sql<{ n: string }>("select count(*) n from reviewer_earnings where reviewer_id=$1", [id(10)]);
    const assigned = await sql<{ n: string }>("select count(*) n from sme_review_assignments where reviewer_id=$1", [id(10)]);
    expect([Number(earnings[0].n), Number(assigned[0].n)]).toEqual([5, 15]);
    await as(id(13));
    const run = await workforce<{ policies: Array<{ reviewer: string; assigned: number }> }>("run_scheduler");
    expect(Object.fromEntries(run.policies.map((p) => [p.reviewer, p.assigned]))).toEqual({ "SME A": 5, "SME B": 0, "Math SME": 0 });
    await as(id(10));
    expect(await workforce("my_dashboard")).toMatchObject({ today: { outstanding: 15, completed: 5 }, month: { completed: 5, approved: 4, revisions: 1, revision_rate: 20, qa_reversals: 0 } });
    await as(id(2));
    expect((await factory("operations", { campaign_id: demo })).totals).toMatchObject({ approved: 4, under_review: 25, generated: 36, published: 0, coverage_percent: 50 });
    const coverage = await factory<{ indicators: Array<{ indicator: string; target: number; approved: number }> }>("coverage", { campaign_id: demo });
    expect(coverage.indicators.reduce((s, r) => s + r.approved, 0)).toBe(4);
  });

  it("applies fixed-daily limits, max queue, working days and SME pause", async () => {
    await as(id(2));
    const policyB = (await workforce<Array<{ id: string; reviewer: string }>>("policies", { reviewer_id: id(11) }))[0].id;
    await workforce("save_policy", { id: policyB, reviewer_id: id(11), market_id: market, subject_code: "Computing", assignment_mode: "FIXED_DAILY", daily_limit: 12, max_open_queue: 30, working_days: [1, 2, 3, 4, 5, 6, 7] });
    await as(id(13));
    let run = await workforce<{ policies: Array<{ reviewer: string; assigned: number; capacity: number; reason: string | null }> }>("run_scheduler");
    // 10 already assigned today against a daily limit of 12: only 2 more, even though 10 are unassigned.
    expect(run.policies.find((p) => p.reviewer === "SME B")).toMatchObject({ capacity: 2, assigned: 2 });
    const today = (await sql<{ d: number }>("select extract(isodow from now() at time zone 'Africa/Accra')::int d"))[0].d;
    await as(id(13)); await workforce("set_limits", { policy_id: policyB, max_open_queue: 10 });
    await as(id(2)); await workforce("save_policy", { id: policyB, reviewer_id: id(11), market_id: market, subject_code: "Computing", assignment_mode: "FIXED_DAILY", daily_limit: 12, max_open_queue: 10, working_days: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== today) });
    await as(id(13)); run = await workforce("run_scheduler", { dry_run: true });
    expect(run.policies.find((p) => p.reviewer === "SME B")).toMatchObject({ capacity: 0, reason: "NOT_WORKING_DAY" });
    await workforce("pause_reviewer", { reviewer_id: id(10), paused: true, reason: "Behind on QA feedback" });
    run = await workforce("run_scheduler", { dry_run: true });
    expect(run.policies.find((p) => p.reviewer === "SME A")).toMatchObject({ capacity: 0, reason: "PAUSED" });
    await workforce("pause_reviewer", { reviewer_id: id(10), paused: false });
    const trail = await sql<{ action: string }>("select action from quizbox_factory.events where action in ('REVIEWER_PAUSED','REVIEWER_RESUMED','POLICY_LIMITS_CHANGED','POLICY_UPDATED') order by id");
    expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(["POLICY_UPDATED", "POLICY_LIMITS_CHANGED", "REVIEWER_PAUSED", "REVIEWER_RESUMED"]));
    await expect(sql("update quizbox_factory.events set action='X'")).rejects.toThrow("QB_IMMUTABLE_HISTORY");
  });

  it("reassigns outstanding work without creating payable events", async () => {
    const [w] = await sql<{ id: string; version: number }>("select w.id,q.version from sme_review_assignments w join questions q on q.id=w.question_id where w.reviewer_id=$1 and w.review_completed_at is null order by w.id limit 1", [id(10)]);
    await as(id(13));
    const moved = await workforce<{ released: number; reassigned: Array<{ from: string; to: string }> }>("reassign", { assignment_ids: [w.id], to_reviewer_id: id(11), reason: "Rebalancing" });
    expect(moved.released).toBe(1); expect(moved.reassigned).toHaveLength(1);
    await as(id(10)); await expect(db.query("select public.qb_sme_complete_review($1,'approve','Late attempt on released work.',true,$2)", [w.id, w.version])).resolves.toBeDefined();
    expect((await sql("select 1 from reviewer_earnings e join sme_review_events v on v.id=e.review_event_id where v.assignment_id=$1", [w.id])).length).toBe(0);
    await as(id(13)); await expect(workforce("reassign", { assignment_ids: [moved.reassigned[0].to], to_reviewer_id: id(12) })).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
    const events = await sql<{ action: string }>("select action from quizbox_factory.assignment_events where details->>'from_assignment'=$1 or assignment_id::text=$1", [w.id]);
    expect(events.map((e) => e.action).sort()).toEqual(["ASSIGNED", "REASSIGNED", "RELEASED"]);
  });

  it("splits campaign allocations by configured capacity and respects the quota", async () => {
    await as(id(2));
    const alloc = (await factory("create", { ...base(), name: "Allocation campaign", target_question_count: 10, source_scope: { ...base().source_scope, node_ids: [ind[2]] }, difficulty_mix: { easy: 100 } })).id;
    await factory("plan", { campaign_id: alloc }); await factory("start", { campaign_id: alloc });
    await executeCampaignJobs(rpc, alloc, provider());
    for (const [n, daily] of [[10, 40], [11, 20]] as const) await workforce("save_policy", { reviewer_id: id(n), market_id: market, subject_code: "Computing", assignment_mode: "CAMPAIGN_ALLOCATION", campaign_id: alloc, campaign_priority: 500, daily_limit: daily, max_open_queue: 100, working_days: [1, 2, 3, 4, 5, 6, 7] });
    await as(id(13));
    expect(await workforce("allocate", { campaign_id: alloc, total: 6 })).toEqual(expect.objectContaining({}));
    const quotas = (await workforce<Array<{ reviewer: string; allocation_quota: number | null; assignment_mode: string }>>("policies")).filter((p) => p.assignment_mode === "CAMPAIGN_ALLOCATION").map((p) => [p.reviewer, p.allocation_quota]);
    expect(Object.fromEntries(quotas)).toEqual({ "SME A": 4, "SME B": 2 });
    const run = await workforce<{ policies: Array<{ reviewer: string; mode: string; assigned: number }> }>("run_scheduler", { campaign_id: alloc });
    expect(run.policies.filter((p) => p.mode === "CAMPAIGN_ALLOCATION").map((p) => [p.reviewer, p.assigned])).toEqual([["SME A", 4], ["SME B", 2]]);
    await factory("stop_assignment", { campaign_id: alloc });
    expect((await workforce("run_scheduler", { campaign_id: alloc, dry_run: true })).policies.every((p: { eligible: number }) => p.eligible === 0)).toBe(true);
    const dashboard = await workforce<Array<{ reviewer: string; outstanding: number; month: { completed: number } }>>("dashboard", { subject: "Computing" });
    expect(dashboard.map((d) => d.reviewer)).toEqual(["SME A", "SME B"]);
  });

  it("imports and hand-authors questions into review only, with provenance enforced", async () => {
    const rows = parseImport(`indicator_code,subject,grade,question_text,answer_type,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,cognitive_level,source_reference
B7.1.1.1.1,Computing,B7,"Which part of a computer processes instructions?",SINGLE_CHOICE,CPU,Monitor,Mouse,Speaker,A,The CPU executes instructions.,easy,Recall,GH-FAC extract p.2
B7.1.1.1.1,Computing,B7,Which is an input device?,SINGLE_CHOICE,Keyboard,Printer,Speaker,Monitor,A,A keyboard sends input.,easy,Recall,
B7.9.9.9.9,Computing,B7,Unknown indicator question?,SINGLE_CHOICE,A1,B1,C1,D1,A,Explained.,easy,Recall,GH-FAC extract`, "csv");
    expect(precheckRows(rows)).toEqual([{ row: 2, code: "IMPORT_PROVENANCE_REQUIRED" }]);
    await as(id(2));
    const imported = await rpc<{ inserted: number; published: number; row_errors: Array<{ row: number; code: string }> }>("qb_content_factory_import", { p_data: { market_id: market, curriculum_id: curriculum, source_document_ids: [source], campaign_id: demo, rows } });
    expect(imported).toMatchObject({ inserted: 1, published: 0, row_errors: [{ row: 2, code: "QB_IMPORT_PROVENANCE_REQUIRED" }, { row: 3, code: "QB_IMPORT_UNKNOWN_INDICATOR" }] });
    const manual = await rpc<{ inserted: number }>("qb_content_factory_import", { p_data: { market_id: market, curriculum_id: curriculum, source_document_ids: [source], origin: "HUMAN_AUTHOR",
      rows: [{ indicator_code: "B7.1.1.1.2", subject: "Computing", question_text: "What does RAM stand for?", option_a: "Random access memory", option_b: "Read always memory", option_c: "Run all modules", option_d: "Rapid array map", correct_answer: "A", explanation: "RAM is random access memory.", source_reference: "Author knowledge, GH-FAC strand 1" }] } });
    expect(manual.inserted).toBe(1);
    const made = await sql<{ source_type: string; validation_status: string; status: string; imported_by: string }>("select q.source_type,q.validation_status,q.status::text status,b.imported_by from questions q join content_import_batches b on b.id=q.import_batch_id where q.question_text in ('Which part of a computer processes instructions?','What does RAM stand for?') order by q.source_type");
    expect(made).toEqual([{ source_type: "HUMAN_AUTHOR", validation_status: "review", status: "inactive", imported_by: id(2) }, { source_type: "IMPORTED", validation_status: "review", status: "inactive", imported_by: id(2) }]);
    await as(id(2));
    await expect(rpc("qb_content_factory_import", { p_data: { market_id: market, curriculum_id: curriculum, source_document_ids: [foreignSource], rows } })).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
  });

  it("preserves generated work when a campaign is cancelled", async () => {
    await as(id(2));
    const before = (await sql<{ n: string }>("select count(*) n from quizbox_factory.campaign_questions where campaign_id=$1", [demo]))[0].n;
    await as(id(2));
    await expect(factory("cancel", { campaign_id: demo })).rejects.toThrow("QB_FACTORY_INVALID_TRANSITION");
    expect((await sql<{ n: string }>("select count(*) n from quizbox_factory.campaign_questions where campaign_id=$1", [demo]))[0].n).toBe(before);
  });
});
