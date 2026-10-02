import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configurationPayload } from "./configuration";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
let db: PGlite;
let transaction = false;
async function safe<T>(operation: () => Promise<T>): Promise<T> {
  if (!transaction) return operation();
  await db.exec("savepoint assertion");
  try { const result = await operation(); await db.exec("release savepoint assertion"); return result; }
  catch (error) { await db.exec("rollback to savepoint assertion; release savepoint assertion"); throw error; }
}
async function scalar(sql: string, params: unknown[] = []) {
  const result = await safe(() => db.query<Record<string, any>>(sql, params));
  return Object.values(result.rows[0] ?? {})[0];
}
const actor = (value: number) => scalar("select set_config('request.jwt.claim.sub',$1,false)", [id(value)]);
const configure = (entity: string, payload: Record<string, unknown>) => scalar("select public.qb_sme_configure($1,$2::jsonb)", [entity, JSON.stringify(payload)]);
const version = (policy: string, extra = {}) => configure("compensation_policy_versions", { policy_id: policy, currency_code: "GHS", effective_from: "2020-01-01T00:00:00Z", base_review_fee: "2.500000", approve_fee: "1.250000", reject_fee: "0.500000", revision_fee: "0.250000", senior_review_fee: "2.000000", complexity_multiplier: "1.200000", quality_bonus_amount: "0.500000", tax_or_withholding: { percentage: "10" }, funded_by: "platform", ...extra });
const assign = (question = 20, reviewer = 2, domain = 10, kind = "primary", prior: string | null = null) => scalar("select public.qb_sme_assign_review($1,$2,$3,$4,null,$5)", [id(question), id(reviewer), id(domain), kind, prior]);
async function completed() {
  const policy = await configure("compensation_policies", { name: "Global", active: true });
  const rates = await version(policy.id);
  const work = await assign();
  await actor(2);
  await scalar("select public.qb_sme_review_detail($1)", [work.id]);
  const result = await scalar("select public.qb_sme_complete_review($1,'approve','Reviewed independently',true,1)", [work.id]);
  await actor(1);
  const earning = (await db.query<Record<string, any>>("select * from public.reviewer_earnings")).rows[0];
  return { rates, work, result, earning, policy };
}

describe("market / SME PostgreSQL integration (isolated, no hosted calls)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create table public.profiles(id uuid primary key,role text,status text);
      create table public.curricula(id uuid primary key,country text);
      create table public.tenants(id uuid primary key,country text);
      create table public.sponsor_profiles(id uuid primary key);
      create table public.curriculum_nodes(id uuid primary key,curriculum_id uuid,education_level text);
      create table public.questions(id uuid primary key,version integer,subject_code text,curriculum_id uuid,curriculum_node_id uuid,
        canonical_grade_code text,grade text,tenant_id uuid,source_type text,validation_status text,status text,reviewed_by uuid,reviewed_at timestamptz,editorial_metadata jsonb default '{}');
      create table public.question_versions(id uuid primary key,question_id uuid,version_no integer);
      create function public.qb_content_validation_errors(jsonb) returns jsonb language sql as $$ select '[]'::jsonb $$;
      insert into public.profiles values('${id(1)}','OWNER','active'),('${id(2)}','TEACHER','active'),('${id(3)}','ADMIN','active'),('${id(4)}','TEACHER','active'),('${id(5)}','STUDENT','active');
      insert into public.curricula values('${id(6)}','Ghana');
      insert into public.tenants values('${id(7)}','Ghana');
      insert into public.curriculum_nodes values('${id(8)}','${id(6)}','secondary');
    `);
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261002200000_market_sme_foundation.sql", import.meta.url), "utf8"));
    await actor(1);
    await configure("sme_profiles", { user_id: id(2), reviewer_tier: "qualified", reviewer_status: "verified", payment_status: "verified", active: true });
    await configure("sme_profiles", { user_id: id(4), reviewer_tier: "senior", reviewer_status: "verified", payment_status: "verified", active: true });
    await configure("user_capabilities", { user_id: id(3), capability: "finance_admin", active: true });
    await configure("sme_domain_assignments", { id: id(10), reviewer_id: id(2), subject_code: "Mathematics", grade_codes: ["SHS1"], can_review: true, can_approve: true });
    await configure("sme_domain_assignments", { id: id(11), reviewer_id: id(4), subject_code: "Mathematics", can_review: true, can_approve: true, can_senior_review: true });
    await db.exec(`insert into public.questions(id,version,subject_code,curriculum_id,curriculum_node_id,canonical_grade_code,grade,source_type,validation_status,status)
      values('${id(20)}',1,'Mathematics','${id(6)}','${id(8)}','SHS1','B10','HUMAN_AUTHOR','review','inactive'),('${id(21)}',1,'Science','${id(6)}','${id(8)}','SHS1','B10','HUMAN_AUTHOR','review','inactive');
      insert into public.question_versions values('${id(30)}','${id(20)}',1),('${id(31)}','${id(21)}',1);`);
  }, 60_000);
  beforeEach(async () => { await db.exec("begin"); transaction = true; await actor(1); });
  afterEach(async () => { transaction = false; await db.exec("rollback"); });
  afterAll(async () => { await db.close(); });

  it("preserves Ghana compatibility without merging B10 and SHS1", async () => {
    expect(await scalar("select count(*)::int from public.markets where default_currency_code='GHS'")).toBe(1);
    expect(await scalar("select market_id is not null from public.curricula")).toBe(true);
    expect((await db.query("select grade,canonical_grade_code from public.questions where id=$1", [id(20)])).rows[0]).toEqual({ grade: "B10", canonical_grade_code: "SHS1" });
  });
  it("creates currencies, countries and markets through configuration", async () => {
    await configure("currencies", { code: "USD", name: "US dollar", symbol: "$", decimal_places: 2 });
    const country = await configure("countries", { iso2_code: "US", iso3_code: "USA", name: "United States", default_currency_code: "USD", timezone: "America/New_York", locale: "en-US" });
    const market = await configure("markets", { country_id: country.id, name: "US Schools", default_currency_code: "USD", timezone: "America/New_York", locale: "en-US" });
    expect(market.default_currency_code).toBe("USD");
  });
  it("blocks new review assignment in a deactivated market", async () => {
    await db.exec("update public.markets set active=false");
    await expect(assign()).rejects.toThrow("QB_MARKET_INACTIVE");
  });
  it("rejects invalid currency precision and timezone", async () => {
    await expect(configure("currencies", { code: "BAD!", name: "Bad", symbol: "?", decimal_places: 2 })).rejects.toThrow();
    await expect(configure("currencies", { code: "USD", name: "Dollar", symbol: "$", decimal_places: 7 })).rejects.toThrow();
    await expect(configure("markets", { country_id: await scalar("select id from public.countries"), name: "Invalid", default_currency_code: "GHS", timezone: "Unknown/Nowhere", locale: "en-GH" })).rejects.toThrow("QB_INVALID_LOCALE_TIMEZONE");
  });
  it("links SME profiles to existing users and rejects an unknown profile", async () => {
    const profile = await configure("sme_profiles", { user_id: id(3), reviewer_tier: "expert", qualification_summary: "Reviewed qualification", years_experience: 7 });
    expect(profile.user_id).toBe(id(3));
    await expect(configure("sme_profiles", { user_id: id(99), reviewer_tier: "expert" })).rejects.toThrow();
  });
  it("permits matching domains and rejects unauthorized subject assignment", async () => {
    const work = await assign(); expect(work.reviewer_id).toBe(id(2));
    await expect(assign(21)).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
  });
  it("requires an independent authorized senior reviewer", async () => {
    await expect(assign(20, 2, 10, "senior")).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
    await expect(assign(20, 4, 11, "senior")).rejects.toThrow("QB_INDEPENDENT_SENIOR_REVIEW_REQUIRED");
  });
  it("rejects students and ordinary admins from new configuration", async () => {
    for (const user of [3, 5]) {
      await actor(user);
      await expect(configure("compensation_policies", { name: "Forbidden" })).rejects.toThrow("QB_SME_CONFIGURATION_DENIED");
    }
  });
  it("enforces tenant / sponsor, then market, then global policy precedence", async () => {
    const market = await scalar("select id from public.markets");
    const global = await configure("compensation_policies", { name: "Global" }); await version(global.id);
    const local = await configure("compensation_policies", { name: "Market", market_id: market }); const localV = await version(local.id);
    const tenant = await configure("compensation_policies", { name: "Tenant", tenant_id: id(7) }); const tenantV = await version(tenant.id);
    expect(await scalar("select quizbox_sme.resolve_policy($1,null,null,'qualified','Mathematics','secondary',now())", [market])).toBe(localV.id);
    expect(await scalar("select quizbox_sme.resolve_policy($1,$2,null,'qualified','Mathematics','secondary',now())", [market, id(7)])).toBe(tenantV.id);
    expect(await scalar("select quizbox_sme.resolve_policy(null,null,null,'qualified','Mathematics','secondary',now())")).not.toBeNull();
    await db.exec(`insert into public.sponsor_profiles values('${id(40)}')`);
    const sponsor = await configure("compensation_policies", { name: "Sponsor", sponsor_id: id(40) }); const sponsorV = await version(sponsor.id);
    expect(await scalar("select quizbox_sme.resolve_policy($1,null,$2,'qualified','Mathematics','secondary',now())", [market, id(40)])).toBe(sponsorV.id);
  });
  it("fails closed on ambiguous equally scoped policies", async () => {
    for (const name of ["A", "B"]) { const policy = await configure("compensation_policies", { name }); await version(policy.id); }
    await expect(assign()).rejects.toThrow("QB_AMBIGUOUS_COMPENSATION_POLICY");
  });
  it("pins policy versions to assigned work and never rewrites prior rates", async () => {
    const policy = await configure("compensation_policies", { name: "Rates" }); const old = await version(policy.id);
    const work = await assign();
    const next = await version(policy.id, { effective_from: "2021-01-01T00:00:00Z", base_review_fee: "100.000000" });
    expect(work.compensation_policy_version_id).toBe(old.id);
    expect(await scalar("select quizbox_sme.resolve_policy(null,null,null,'qualified','Mathematics','secondary','2020-06-01')")).toBe(old.id);
    expect(await scalar("select quizbox_sme.resolve_policy(null,null,null,'qualified','Mathematics','secondary',now())")).toBe(next.id);
    await expect(safe(() => db.query("update public.compensation_policy_versions set base_review_fee=99 where id=$1", [old.id]))).rejects.toThrow("QB_IMMUTABLE_HISTORY");
  });
  it("restricts detail / answers to the assigned reviewer or content administrator", async () => {
    const work = await assign();
    await actor(5); await expect(scalar("select public.qb_sme_review_detail($1)", [work.id])).rejects.toThrow("QB_REVIEW_ACCESS_DENIED");
    await actor(4); await expect(scalar("select public.qb_sme_complete_review($1,'approve','Reviewed',true,1)", [work.id])).rejects.toThrow("QB_REVIEW_ACCESS_DENIED");
  });
  it("persists attributed review events, snapshots earnings and suppresses retry duplicates", async () => {
    const { work, earning, result } = await completed();
    expect(String(earning.final_amount)).toBe("4.500000");
    expect(earning.status).toBe("pending_qa");
    await actor(2);
    const retry = await scalar("select public.qb_sme_complete_review($1,'approve','Reviewed independently',true,1)", [work.id]);
    expect(retry.id).toBe(result.id);
    expect(await scalar("select count(*)::int from public.reviewer_earnings")).toBe(1);
    expect(await scalar("select count(*)::int from public.sme_review_events")).toBe(1);
  });
  it("does not pay work without an explicitly configured applicable policy", async () => {
    const work = await assign(); await actor(2); await scalar("select public.qb_sme_review_detail($1)", [work.id]);
    await scalar("select public.qb_sme_complete_review($1,'revision','Needs a clearer explanation',true,1)", [work.id]);
    expect(await scalar("select count(*)::int from public.reviewer_earnings")).toBe(0);
  });
  it("preserves publication separation and enforces configured independent senior QA", async () => {
    const { result } = await completed();
    await db.exec("update public.markets set configuration='{\"require_senior_qa\":true}'");
    await expect(scalar("select public.qb_sme_publish_question($1,1)", [id(20)])).rejects.toThrow("QB_SENIOR_QA_REQUIRED");
    const senior = await assign(20, 4, 11, "senior", result.id);
    await actor(4); await scalar("select public.qb_sme_review_detail($1)", [senior.id]);
    await scalar("select public.qb_sme_complete_review($1,'approve','Independent QA confirmed',true,1)", [senior.id]);
    await expect(scalar("select public.qb_sme_publish_question($1,1)", [id(20)])).rejects.toThrow("QB_SME_PUBLISH_DENIED");
    await actor(1); const published = await scalar("select public.qb_sme_publish_question($1,1)", [id(20)]);
    expect(published.status).toBe("active");
  });
  it("does not allow review-only assignments to approve", async () => {
    await configure("sme_domain_assignments", { id: id(10), can_approve: false });
    const work = await assign(); await actor(2); await scalar("select public.qb_sme_review_detail($1)", [work.id]);
    await expect(scalar("select public.qb_sme_complete_review($1,'approve','Verified',true,1)", [work.id])).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
    await scalar("select public.qb_sme_complete_review($1,'reject','Factually incorrect',true,1)", [work.id]);
  });
  it("requires attestation and rejects outdated question versions", async () => {
    const work = await assign(); await actor(2); await scalar("select public.qb_sme_review_detail($1)", [work.id]);
    await expect(scalar("select public.qb_sme_complete_review($1,'approve','Verified',false,1)", [work.id])).rejects.toThrow("QB_HUMAN_REVIEW_REQUIRED");
    await expect(scalar("select public.qb_sme_complete_review($1,'approve','Verified',true,2)", [work.id])).rejects.toThrow("QB_CONTENT_CONFLICT");
  });
  it("keeps currencies and payout minimum thresholds separate", async () => {
    const { earning, rates } = await completed(); const market = await scalar("select id from public.markets");
    await scalar("select public.qb_sme_release_earning($1,'payable','QA verified')", [earning.id]);
    await expect(scalar("select public.qb_sme_create_payout($1,'USD','2000-01-01','2100-01-01',$2)", [market, [earning.id]])).rejects.toThrow("QB_INELIGIBLE_EARNINGS");
    expect(await scalar("select compensation_policy_version_id from public.reviewer_earnings")).toBe(rates.id);
  });
  it("enforces the pinned policy's payout threshold", async () => {
    const policy = await configure("compensation_policies", { name: "Minimum payout" });
    await version(policy.id, { minimum_payout_threshold: "10.000000" });
    const work = await assign(); await actor(2); await scalar("select public.qb_sme_review_detail($1)", [work.id]);
    await scalar("select public.qb_sme_complete_review($1,'approve','Verified',true,1)", [work.id]);
    await actor(1); const earning = await scalar("select id from public.reviewer_earnings"); const market = await scalar("select id from public.markets");
    await scalar("select public.qb_sme_release_earning($1,'payable','QA verified')", [earning]);
    await expect(scalar("select public.qb_sme_create_payout($1,'GHS','2000-01-01','2100-01-01',$2)", [market, [earning]])).rejects.toThrow("QB_BELOW_PAYOUT_THRESHOLD");
  });
  it("stops suspended reviewers and never changes already earned amounts after a rate change", async () => {
    const { earning, policy } = await completed();
    await version(policy.id, { effective_from: "2021-01-01T00:00:00Z", base_review_fee: "999.000000" });
    expect(await scalar("select final_amount::text from public.reviewer_earnings where id=$1", [earning.id])).toBe("4.500000");
    await configure("sme_profiles", { user_id: id(2), reviewer_status: "suspended" });
    await expect(assign()).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
  });
  it("prevents legacy decision writes on an assigned question", async () => {
    await assign();
    await actor(2);
    await expect(safe(() => db.query("update public.questions set validation_status='approved' where id=$1", [id(20)]))).rejects.toThrow("QB_ASSIGNED_REVIEW_REQUIRED");
  });
  it("does not turn an admin or owner role into unrestricted subject-review authority", async () => {
    for (const user of [1, 3]) {
      await actor(user);
      await expect(safe(() => db.query("update public.questions set validation_status='approved' where id=$1", [id(21)]))).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED");
    }
  });
  it("requires QA release and verified payment status before payout reservation", async () => {
    const { earning } = await completed(); const market = await scalar("select id from public.markets");
    await expect(scalar("select public.qb_sme_create_payout($1,'GHS','2000-01-01','2100-01-01',$2)", [market, [earning.id]])).rejects.toThrow("QB_INELIGIBLE_EARNINGS");
    await scalar("select public.qb_sme_release_earning($1,'payable','QA verified')", [earning.id]);
    const batch = await scalar("select public.qb_sme_create_payout($1,'GHS','2000-01-01','2100-01-01',$2)", [market, [earning.id]]);
    expect(batch.status).toBe("draft"); expect(String(batch.total)).toBe("4.5");
    await expect(scalar("select public.qb_sme_create_payout($1,'GHS','2000-01-01','2100-01-01',$2)", [market, [earning.id]])).rejects.toThrow("QB_INELIGIBLE_EARNINGS");
    await expect(scalar("select public.qb_sme_payout_action($1,'approve')", [batch.id])).rejects.toThrow("QB_INDEPENDENT_PAYOUT_APPROVER_REQUIRED");
    await actor(3); await scalar("select public.qb_sme_payout_action($1,'approve')", [batch.id]);
    await scalar("select public.qb_sme_payout_action($1,'paid')", [batch.id]);
    await scalar("select public.qb_sme_payout_action($1,'paid')", [batch.id]);
    expect(await scalar("select count(*)::int from public.reviewer_earning_states where status='paid'")).toBe(1);
    expect(await scalar("select current_status from public.sme_earnings_current")).toBe("paid");
    await expect(safe(() => db.query("delete from public.reviewer_earnings"))).rejects.toThrow("QB_IMMUTABLE_HISTORY");
  });
  it("derives work and currency-separated financial metrics", async () => {
    const { earning } = await completed(); await scalar("select public.qb_sme_release_earning($1,'payable','QA verified')", [earning.id]);
    expect((await db.query("select assigned_count,reviewed_count,approved_count,pending_count from public.sme_performance where reviewer_id=$1", [id(2)])).rows[0]).toEqual({ assigned_count: 1, reviewed_count: 1, approved_count: 1, pending_count: 0 });
    expect(await scalar("select payable_amount from public.sme_financial_performance")).toBe("4.500000");
  });
  it("enforces RLS, prohibits direct writes and exposes no anonymous SME RPCs", async () => {
    await completed(); await actor(5); await db.exec("set local role authenticated");
    expect(await scalar("select count(*)::int from public.reviewer_earnings")).toBe(0);
    expect(await scalar("select count(*)::int from public.sme_review_assignments")).toBe(0);
    expect(await scalar("select count(*)::int from public.sme_financial_performance")).toBe(0);
    await expect(safe(() => db.exec("insert into public.user_capabilities(user_id,capability) values(auth.uid(),'super_admin')"))).rejects.toThrow("permission denied");
    expect(await scalar("select has_function_privilege('anon','public.qb_sme_complete_review(uuid,text,text,boolean,integer)','EXECUTE')")).toBe(false);
  });
});

describe("SME configuration form validation", () => {
  it("rejects unsupported currencies and noninteger precision", () => {
    const form = new FormData(); for (const [name, value] of Object.entries({ code: "ZZZ", name: "Invalid", symbol: "?", decimal_places: "2" })) form.set(name, value);
    expect(() => configurationPayload("currencies", form)).toThrow("ISO 4217");
    form.set("code", "USD"); form.set("decimal_places", "1.5"); expect(() => configurationPayload("currencies", form)).toThrow("integer");
  });
  it("keeps canonical grade scopes configurable", () => {
    const form = new FormData(); for (const [name, value] of Object.entries({ reviewer_id: id(2), subject_code: "Mathematics", grade_codes: "SHS1, SHS2", can_review: "on" })) form.set(name, value);
    expect(configurationPayload("sme_domain_assignments", form).grade_codes).toEqual(["SHS1", "SHS2"]);
  });
});
