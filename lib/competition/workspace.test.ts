import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SponsorRepository } from "./repository";
import { extractSource, ingestSource, uploadSource, type SourceStorage } from "./ingestion";
import type { SupabaseClient } from "@supabase/supabase-js";
import { configuredCompetitionProvider, executeGenerationJob } from "./generation-job";

let db: PGlite;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let sponsor: string; let competition: string; let document: string;
let repository: SponsorRepository;
const objects = new Map<string, Buffer>();
const storage: SourceStorage = { async upload(_bucket, path, bytes) { objects.set(path, bytes); }, async download(_bucket, path) { const bytes = objects.get(path); if (!bytes) throw new Error("MISSING_SOURCE_OBJECT"); return bytes; } };
async function actor(n: number) { await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]); await db.exec("set role authenticated"); }
describe("authenticated sponsor adapters over isolated PostgreSQL persistence", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema quizbox_market; create schema storage;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create table public.profiles(id uuid primary key,role text,status text);
      create table public.sponsor_profiles(id uuid primary key default gen_random_uuid(),user_id uuid references profiles(id),organization_name text,contact_name text,status text,created_at timestamptz default now(),updated_at timestamptz default now());
      create table public.competitions(id uuid primary key default gen_random_uuid(),sponsor_id uuid,title text,description text,created_by uuid,status text,updated_at timestamptz default now());
      create table public.content_contexts(id uuid primary key);
      create table public.source_documents(id uuid primary key,uploaded_by uuid,title text,checksum text,mime_type text,rights_confirmed boolean,sponsor_id uuid,market_id uuid,source_kind text,validation_status text,curriculum_id uuid,authority_id uuid,tenant_id uuid,storage_bucket text,storage_path text,metadata jsonb,content_text text,status text default 'UPLOADED',updated_at timestamptz default now());
      create table public.curricula(id uuid primary key,country text); create table public.tenants(id uuid primary key,country text);
      create table public.curriculum_nodes(id uuid primary key,curriculum_id uuid,education_level text);
      create table public.questions(id uuid primary key,version integer,subject_code text,curriculum_id uuid,curriculum_node_id uuid,
        canonical_grade_code text,grade text,tenant_id uuid,source_type text,validation_status text,status text,reviewed_by uuid,reviewed_at timestamptz,editorial_metadata jsonb default '{}',
        question_text text,explanation text,option_a text,option_b text,option_c text,option_d text,correct_answer text,source_document_ids uuid[]);
      create table public.question_versions(id uuid primary key,question_id uuid,version_no integer,snapshot jsonb);
      create function public.qb_content_validation_errors(jsonb) returns jsonb language sql as $$ select '[]'::jsonb $$;
      create table public.assessments(id uuid primary key); create table public.attempts(id uuid primary key);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated; grant select,insert on storage.objects to authenticated;
      create function quizbox_market.is_super() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.profiles where id=auth.uid() and role='OWNER' and status='active')$$;
      create function quizbox_market.market_allowed(m uuid) returns boolean language sql stable as $$ select m='${id(10)}'::uuid $$;
      create function public.qb_is_tenant_member(t uuid) returns boolean language sql as $$ select false $$;
      -- Market foundation enforcement is exercised separately by market-enforcement.test.ts.
      -- This dependency fixture rejects unapproved inputs for adapter transaction tests.
      create function quizbox_market.validate_context(scope text,mode text,markets uuid[],sources uuid[]) returns jsonb language plpgsql as $$
      begin if coalesce(cardinality(sources),0)=0 or exists(select 1 from unnest(sources) x where not exists(select 1 from public.source_documents s where s.id=x and s.validation_status='approved' and s.rights_confirmed)) then raise exception 'UNAPPROVED_SOURCE_CORPUS'; end if;
      return jsonb_build_object('scope',scope,'source_mode',mode,'market_ids',markets,'source_document_ids',sources); end $$;
      insert into profiles values('${id(1)}','SPONSOR','active'),('${id(2)}','SPONSOR','active'),('${id(3)}','STUDENT','active'),('${id(4)}','SPONSOR','active'),('${id(5)}','OWNER','active');
    `);
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261002200000_market_sme_foundation.sql", import.meta.url), "utf8"));
    await db.exec(`insert into public.countries(id,iso2_code,iso3_code,name,default_currency_code,timezone,locale) values('${id(10)}','ZZ','ZZZ','Isolated demo','GHS','Africa/Accra','en-GH');
      insert into public.markets(id,country_id,name,default_currency_code,timezone,locale) values('${id(10)}','${id(10)}','Isolated demo','GHS','Africa/Accra','en-GH');`);
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261002220000_sponsor_competition_lifecycle.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261002230000_sponsor_authenticated_workflows.sql", import.meta.url), "utf8"));
    const client = { async rpc(_name: string, args: Record<string, unknown>) { try { const result = await db.query<{ data: unknown }>("select public.qb_sponsor_workspace($1,$2::uuid,$3::jsonb) data", [args.p_action, args.p_sponsor, JSON.stringify(args.p_data)]); return { data: result.rows[0].data, error: null }; } catch (error) { return { data: null, error: { message: (error as Error).message } }; } } };
    repository = new SponsorRepository(client as unknown as Pick<SupabaseClient, "rpc">);
    await actor(1);
  });
  afterAll(async () => { await db.close(); });
  it("reverses the empty adapter migration and reapplies without changing baseline profiles", async () => {
    await db.exec("reset role");
    await db.exec(readFileSync(new URL("../../supabase/rollback/sponsor_authenticated_workflows.sql", import.meta.url), "utf8"));
    expect((await db.query<{ count: number }>("select count(*)::int count from public.profiles")).rows[0].count).toBe(5);
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261002230000_sponsor_authenticated_workflows.sql", import.meta.url), "utf8"));
    await actor(1);
  });
  it("creates QuizBox Demo Sponsor with authenticated owner membership", async () => {
    const created = await repository.createOrganization({ organization_name: "QuizBox Demo Sponsor", organization_type: "education", country_id: id(10), market_id: id(10), contact_name: "Demo Contact", contact_email: "demo@example.invalid" });
    sponsor = created.sponsor_id;
    expect((await repository.organization(sponsor)).role).toBe("sponsor_owner");
  });
  it("does not promote sponsor to Super Admin", async () => {
    expect((await repository.organization(sponsor)).role).toBe("sponsor_owner");
    await expect(repository.call("sponsor_status", sponsor, { status: "active" })).rejects.toThrow("SUPER_ADMIN_REQUIRED");
  });
  it("edits only permitted profile fields", async () => {
    await repository.editOrganization(sponsor, { organization_name: "QuizBox Demo Sponsor", contact_email: "demo@example.invalid", status: "active", verification_status: "verified" });
    expect((await repository.organization(sponsor)).status).toBe("PENDING");
  });
  it("denies another sponsor's direct organization access", async () => { await actor(2); await expect(repository.organization(sponsor)).rejects.toThrow("SPONSOR_ACCESS_DENIED"); expect(await repository.organizations()).toEqual([]); await actor(1); });
  it("cannot remove last owner", async () => { await expect(repository.member(sponsor, id(1), "sponsor_viewer", false)).rejects.toThrow("LAST_OWNER_REQUIRED"); });
  it("rejects sponsor Super Admin membership role", async () => { await expect(repository.member(sponsor, id(4), "super_admin", true)).rejects.toThrow("INVALID_SPONSOR_ROLE"); });
  it("adds viewer but denies writes", async () => { await repository.member(sponsor, id(4), "sponsor_viewer", true); await actor(4); expect((await repository.organization(sponsor)).role).toBe("sponsor_viewer"); await expect(repository.saveDraft(sponsor, { title: "No" })).rejects.toThrow("SPONSOR_WRITE_DENIED"); await actor(1); });
  it("deactivated member loses direct access", async () => { await repository.member(sponsor, id(4), "sponsor_viewer", false); await actor(4); await expect(repository.organization(sponsor)).rejects.toThrow("SPONSOR_ACCESS_DENIED"); await actor(1); });
  it("persists and resumes a draft before source approval", async () => {
    const saved = await repository.saveDraft(sponsor, { title: "Demo Knowledge Challenge", scope: "LOCAL_MARKET", sourceMode: "SPONSOR_SOURCE", marketIds: [id(10)], step: 4 }); competition = saved.competition_id;
    expect((await repository.draft(sponsor, competition)).configuration.step).toBe(4);
    expect(saved.content_context_id).toBeNull();
  });
  it("detects stale draft saves without destructive overwrite", async () => {
    const old = await repository.draft(sponsor, competition); const updated = await repository.saveDraft(sponsor, { ...old.configuration, description: "Preserved" }, old);
    await expect(repository.saveDraft(sponsor, { title: "Lost edit" }, old)).rejects.toThrow("DRAFT_CONFLICT_OR_ACCESS_DENIED");
    expect((await repository.draft(sponsor, competition)).revision).toBe(updated.revision);
  });
  it("denies cross-sponsor draft access", async () => { await actor(2); await expect(repository.draft(sponsor, competition)).rejects.toThrow("SPONSOR_ACCESS_DENIED"); await actor(1); });
  it("registers source with ownership before storage upload", async () => {
    const uploaded = await uploadSource(repository, storage, { sponsor, competition, title: "Demo Source", market: id(10), rightsConfirmed: true, mime: "text/plain", bytes: Buffer.from("A safety switch disconnects power.\n\nIsolate power before maintenance.") }); document = uploaded.id;
    expect((await repository.documents(sponsor, competition))[0].approval_status).toBe("review");
  });
  it("extracts TXT into persisted traceable chunks without approval", async () => {
    const chunks = await ingestSource(repository, storage, sponsor, competition, document);
    expect(chunks).toHaveLength(2); expect((await repository.source(sponsor, competition, document)).chunks).toHaveLength(2);
    expect((await repository.documents(sponsor, competition))[0].ingestion_status).toBe("READY_FOR_GENERATION");
    expect((await repository.documents(sponsor, competition))[0].approval_status).toBe("review");
  });
  it("does not rerun completed extraction", async () => { await expect(ingestSource(repository, storage, sponsor, competition, document)).rejects.toThrow("EXTRACTION_NOT_CLAIMABLE"); });
  it("denies foreign source download metadata", async () => { await actor(2); await expect(repository.source(sponsor, competition, document)).rejects.toThrow("SPONSOR_ACCESS_DENIED"); await actor(1); });
  it("records extraction failure and supports explicit retry", async () => {
    const uploaded = await uploadSource(repository, storage, { sponsor, competition, title: "Retry Source", market: id(10), rightsConfirmed: true, mime: "text/plain", bytes: Buffer.from("A valid source.") });
    await expect(ingestSource(repository, storage, sponsor, competition, uploaded.id, async () => { throw new Error("PARSER_FAILURE"); })).rejects.toThrow("PARSER_FAILURE");
    expect((await repository.documents(sponsor, competition)).find(d => d.id === uploaded.id)?.ingestion_status).toBe("FAILED");
    await ingestSource(repository, storage, sponsor, competition, uploaded.id);
    expect((await repository.documents(sponsor, competition)).find(d => d.id === uploaded.id)?.ingestion_status).toBe("READY_FOR_GENERATION");
  });
  it("records upload failure and retries the same source identity", async () => {
    const failing: SourceStorage = { ...storage, async upload() { throw new Error("SOURCE_UPLOAD_FAILED"); } };
    const args = { sponsor, competition, title: "Upload retry", market: id(10), rightsConfirmed: true, mime: "text/plain", bytes: Buffer.from("Retry the original bytes.") };
    await expect(uploadSource(repository, failing, args)).rejects.toThrow("SOURCE_UPLOAD_FAILED");
    const failed = (await repository.documents(sponsor, competition)).find(d => d.title === args.title)!;
    expect(failed.ingestion_status).toBe("FAILED"); expect(failed.error_code).toBe("SOURCE_UPLOAD_FAILED");
    const retry = await uploadSource(repository, storage, { ...args, document: failed.id });
    expect(retry.id).toBe(failed.id); expect((await repository.documents(sponsor, competition)).find(d => d.id === failed.id)?.ingestion_status).toBe("UPLOADED");
  });
  it("does not replace bytes when the storage response is lost", async () => {
    const responseLost: SourceStorage = { ...storage, async upload(bucket, path, bytes, mime) { await storage.upload(bucket, path, bytes, mime); throw new Error("RESPONSE_LOST"); } };
    const uploaded = await uploadSource(repository, responseLost, { sponsor, competition, title: "Response lost", market: id(10), rightsConfirmed: true, mime: "text/plain", bytes: Buffer.from("Verified object bytes.") });
    expect((await repository.documents(sponsor, competition)).find(d => d.id === uploaded.id)?.ingestion_status).toBe("UPLOADED");
  });
  it("enforces private storage ownership against real RLS", async () => {
    const source = await repository.source(sponsor, competition, document);
    await actor(2); await expect(db.query("insert into storage.objects(bucket_id,name) values('competition-sources',$1)", [source.path])).rejects.toThrow(/row-level security/); await actor(1);
  });
  it("exercises owner upload/read and foreign read exclusion against storage RLS", async () => {
    const source = await repository.registerSource(sponsor, competition, { title: "Storage fixture", market_id: id(10), rights_confirmed: true, mime_type: "text/plain", checksum: "a".repeat(64) });
    await db.query("insert into storage.objects(bucket_id,name) values('competition-sources',$1)", [source.path]);
    expect((await db.query("select id from storage.objects where name=$1", [source.path])).rows).toHaveLength(1);
    await actor(2); expect((await db.query("select id from storage.objects where name=$1", [source.path])).rows).toHaveLength(0); await actor(1);
  });
  it("allows Super Admin inspection without modifying sponsor capabilities", async () => { await actor(5); expect((await repository.organizations()).length).toBe(1); expect((await repository.organization(sponsor)).role).toBe("super_admin"); await actor(1); });
  it("denies unauthenticated entrypoint", async () => { await db.exec("reset role; set role anon"); await expect(db.query("select public.qb_sponsor_workspace('list_organizations')")).rejects.toThrow(/permission denied/); await actor(1); });
  it("rejects invalid PDF and DOCX signatures", async () => { await expect(extractSource(Buffer.from("fake"), "application/pdf")).rejects.toThrow("INVALID_PDF_SIGNATURE"); await expect(extractSource(Buffer.from("fake"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).rejects.toThrow("INVALID_DOCX_SIGNATURE"); });
  const spec = () => ({ scope: "LOCAL_MARKET", sourceMode: "SPONSOR_SOURCE", marketIds: [id(10)], sourceIds: [document], count: 1, provider: "mock", model: "fixture", audience: "student" });
  it("does not queue work for pending sponsors", async () => { await expect(repository.call("queue_generation", sponsor, { competition_id: competition, request_key: id(20), spec: spec() })).rejects.toThrow("SPONSOR_NOT_ACTIVE"); });
  it("does not queue unapproved sources", async () => { await actor(5); await repository.call("sponsor_status", sponsor, { status: "active" }); await actor(1); await expect(repository.call("queue_generation", sponsor, { competition_id: competition, request_key: id(20), spec: spec() })).rejects.toThrow("UNAPPROVED_SOURCE_CORPUS"); });
  it("persists generation job, candidates and provenance with a mocked provider", async () => {
    // Explicit approval of a disposable source fixture by the fixture administrator only.
    await db.exec("reset role"); await db.query("update public.source_documents set validation_status='approved' where id=$1", [document]); await db.query("update public.sponsor_profiles set status='ACTIVE' where id=$1", [sponsor]); await actor(1);
    const args = { competition_id: competition, request_key: id(21), spec: spec() };
    const job = await repository.call<{ id: string }>("queue_generation", sponsor, args);
    expect((await repository.call<{ id: string }>("queue_generation", sponsor, args)).id).toBe(job.id);
    const completed = await executeGenerationJob(repository, sponsor, competition, job.id, { name: "mock", model: "fixture", async generate(input, chunks) { return [{ id: id(30), competitionId: input.competitionId, jobId: input.jobId, sourceDocumentId: document, sourceChunkId: chunks[0].id, stem: "Does a safety switch disconnect power?", options: ["True", "False"], correctAnswer: 0, explanation: "The source states it disconnects power.", difficulty: "easy", cognitiveLevel: "recall", subject: "Computing", curriculumId: null, educationLevel: "SHS", model: "fixture", status: "GENERATED", approvedVersionId: null }]; } });
    expect(completed.status).toBe("COMPLETED"); expect(completed.candidate_ids).toEqual([id(30)]);
    await db.exec("reset role"); const rows = await db.query<{ status: string; source_chunk_id: string }>("select status,source_chunk_id from quizbox_competition.candidates where id=$1", [id(30)]); expect(rows.rows[0].status).toBe("GENERATED"); expect(rows.rows[0].source_chunk_id).toBeTruthy(); await actor(1);
  });
  it("refuses duplicate provider execution", async () => { const jobs = await repository.call<Array<{ id: string }>>("jobs", sponsor, { competition_id: competition }); await expect(executeGenerationJob(repository, sponsor, competition, jobs[0].id, { name: "mock", model: "fixture", async generate() { throw new Error("MUST_NOT_RUN"); } })).rejects.toThrow("GENERATION_NOT_CLAIMABLE"); });
  it("reauthorizes revoked sources before calling provider", async () => {
    const job = await repository.call<{ id: string }>("queue_generation", sponsor, { competition_id: competition, request_key: id(22), spec: spec() });
    await db.exec("reset role"); await db.query("update public.source_documents set validation_status='rejected' where id=$1", [document]); await actor(1);
    let invoked = false; await expect(executeGenerationJob(repository, sponsor, competition, job.id, { name: "mock", model: "fixture", async generate() { invoked = true; return []; } })).rejects.toThrow("UNAPPROVED_SOURCE_CORPUS"); expect(invoked).toBe(false);
    const jobs = await repository.call<Array<{ id: string; status: string }>>("jobs", sponsor, { competition_id: competition }); expect(jobs.find(j => j.id === job.id)?.status).toBe("FAILED");
  });
  it("loads the additive review bridge over the real isolated SME ledger", async () => {
    await db.exec("reset role");
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261002240000_sponsor_candidate_review_bridge.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../../supabase/rollback/sponsor_candidate_review_bridge.sql", import.meta.url), "utf8"));
    await db.exec(readFileSync(new URL("../../supabase/migrations/20261002240000_sponsor_candidate_review_bridge.sql", import.meta.url), "utf8"));
    await db.query("update public.source_documents set validation_status='approved' where id=$1", [document]);
    await actor(1);
    expect((await repository.call<Array<{ id: string }>>("candidates", sponsor, { competition_id: competition })).map(x => x.id)).toContain(id(30));
  });
  it("runs an explicitly configured provider through mocked HTTP without credits", async () => {
    let calls = 0;
    const provider = configuredCompetitionProvider({ QUIZBOX_GENERATION_PROVIDER: "mock", QUIZBOX_GENERATION_MODEL: "fixture", QUIZBOX_GENERATION_ENDPOINT: "http://localhost:9999/generate" }, async () => { calls++; return Response.json([]); });
    const job = await repository.call<{ id: string }>("queue_generation", sponsor, { competition_id: competition, request_key: id(23), spec: spec() });
    expect((await executeGenerationJob(repository, sponsor, competition, job.id, provider)).status).toBe("FAILED");
    expect(calls).toBe(1);
    expect(() => configuredCompetitionProvider({})).toThrow("GENERATION_PROVIDER_NOT_CONFIGURED");
  });
  it("retries a failed job explicitly without duplicating candidates", async () => {
    const job = await repository.call<{ id: string }>("queue_generation", sponsor, { competition_id: competition, request_key: id(24), spec: spec() });
    const provider = { name: "mock", model: "fixture", async generate() { throw new Error("PROVIDER_FIXTURE_FAILURE"); } };
    for (let n = 0; n < 3; n++) {
      await expect(executeGenerationJob(repository, sponsor, competition, job.id, provider)).rejects.toThrow("PROVIDER_FIXTURE_FAILURE");
      if (n < 2) expect(await repository.call("retry_generation", sponsor, { competition_id: competition, job_id: job.id })).toEqual({ id: job.id, status: "QUEUED" });
    }
    await expect(repository.call("retry_generation", sponsor, { competition_id: competition, job_id: job.id })).rejects.toThrow("GENERATION_NOT_RETRYABLE");
    const rows = await repository.call<Array<{ id: string; error_code: string; execution_count: number }>>("jobs", sponsor, { competition_id: competition });
    expect(rows.find(x => x.id === job.id)).toMatchObject({ execution_count: 3, error_code: "PROVIDER_FIXTURE_FAILURE" });
  });
  it("denies foreign sponsor candidate and bank access", async () => {
    await actor(2);
    await expect(repository.call("candidates", sponsor, { competition_id: competition })).rejects.toThrow("SPONSOR_ACCESS_DENIED");
    await expect(repository.call("bank", sponsor, { competition_id: competition })).rejects.toThrow("SPONSOR_ACCESS_DENIED");
    await actor(1);
  });
  let assignment: string;
  it("reports the real document-candidate materialization boundary without fabricated mapping", async () => {
    await actor(5);
    await expect(repository.call("assign_candidate", sponsor, { competition_id: competition, candidate_id: id(30), reviewer_id: id(3), domain_id: id(60) })).rejects.toThrow("CANDIDATE_QUESTION_MAPPING_REQUIRED");
  });
  it("links an identity-checked imported question to the existing SME workflow", async () => {
    // Dependency fixture ONLY: this deliberately does not count as full persisted E2E.
    // Combined market/editorial authorization for document-only questions is still a gate.
    await db.exec("reset role");
    await db.query("insert into public.curriculum_nodes(id,education_level) values($1,'SHS')", [id(61)]);
    await db.query("insert into public.questions(id,version,subject_code,curriculum_node_id,source_type,validation_status,status,question_text,explanation,option_a,option_b,correct_answer,source_document_ids) values($1,1,'Computing',$2,'AI_GENERATED','review','inactive','Does a safety switch disconnect power?','The source states it disconnects power.','True','False','A',array[$3::uuid])", [id(62), id(61), document]);
    await db.query("insert into public.question_versions values($1,$2,1,'{}')", [id(63), id(62)]);
    await actor(5);
    await db.query("select public.qb_sme_configure('sme_profiles',$1::jsonb)", [JSON.stringify({ user_id: id(3), reviewer_tier: "qualified", reviewer_status: "verified", active: true })]);
    await db.query("select public.qb_sme_configure('sme_domain_assignments',$1::jsonb)", [JSON.stringify({ id: id(60), reviewer_id: id(3), subject_code: "Computing", education_level: "SHS", can_review: true, can_approve: true })]);
    const work = await repository.call<{ id: string }>("assign_candidate", sponsor, { competition_id: competition, candidate_id: id(30), question_id: id(62), reviewer_id: id(3), domain_id: id(60) }); assignment = work.id;
    expect((await repository.call<{ id: string }>("assign_candidate", sponsor, { competition_id: competition, candidate_id: id(30), reviewer_id: id(3) })).id).toBe(assignment);
  });
  it("denies unassigned direct reviewer access", async () => {
    await actor(2); await expect(repository.call("review_detail", null, { candidate_id: id(30), assignment_id: assignment })).rejects.toThrow("QB_REVIEW_ACCESS_DENIED");
    await actor(3); expect(await repository.call("review_queue")).toEqual(expect.arrayContaining([expect.objectContaining({ candidate_id: id(30), assignment_id: assignment })]));
  });
  it("persists start and approval with immutable history and unresolved compensation", async () => {
    await repository.call("review_detail", null, { candidate_id: id(30), assignment_id: assignment });
    const args = { candidate_id: id(30), assignment_id: assignment, decision: "approve", note: "Reviewed with the provided source", human_reviewed: true, version: 1 };
    const approved = await repository.call<{ id: string }>("complete_review", null, args);
    expect((await repository.call<{ id: string }>("complete_review", null, args)).id).toBe(approved.id);
    await db.exec("reset role");
    expect((await db.query<{ n: number }>("select count(*)::int n from quizbox_competition.review_events")).rows[0].n).toBe(1);
    await expect(db.query("update quizbox_competition.candidate_history set new_state='REJECTED'")).rejects.toThrow("IMMUTABLE_COMPETITION_RECORD");
    await actor(5);
    expect(await repository.call("oversight")).toMatchObject({ unresolved_compensation: [expect.objectContaining({ candidate_id: id(30) })] });
  });
  it("adds approved versions to the bank and supports exclusion", async () => {
    await actor(1); const old = await repository.draft(sponsor, competition); await repository.saveDraft(sponsor, { ...old.configuration, totalQuestions: 1, sourceIds: [document] }, old);
    await repository.call("include_bank", sponsor, { competition_id: competition, candidate_id: id(30), position: 0 });
    expect(await repository.call("bank", sponsor, { competition_id: competition })).toEqual([expect.objectContaining({ question_version_id: id(63), included: true })]);
    await repository.call("include_bank", sponsor, { competition_id: competition, candidate_id: id(30), included: false });
    expect(await repository.call("bank", sponsor, { competition_id: competition })).toEqual([expect.objectContaining({ included: false })]);
  });
  it("revoking the SME profile removes reviewer queue and direct access", async () => {
    await actor(5); await db.query("select public.qb_sme_configure('sme_profiles',$1::jsonb)", [JSON.stringify({ user_id: id(3), reviewer_tier: "qualified", reviewer_status: "suspended", active: false })]);
    await actor(3); expect(await repository.call("review_queue")).toEqual([]);
    await expect(repository.call("review_detail", null, { candidate_id: id(30), assignment_id: assignment })).rejects.toThrow("QB_REVIEW_DOMAIN_DENIED"); await actor(1);
  });
  it("reclaims expired executions and rejects the previous execution token", async () => {
    const job = await repository.call<{ id: string }>("queue_generation", sponsor, { competition_id: competition, request_key: id(25), spec: spec() });
    const claim = await repository.call<{ token: string }>("claim_generation", sponsor, { competition_id: competition, job_id: job.id });
    await expect(repository.call("retry_generation", sponsor, { competition_id: competition, job_id: job.id })).rejects.toThrow("GENERATION_NOT_RETRYABLE");
    await db.exec("reset role"); await db.query("update quizbox_competition.generation_jobs set started_at=now()-interval '11 minutes' where id=$1", [job.id]); await actor(1);
    await repository.call("retry_generation", sponsor, { competition_id: competition, job_id: job.id });
    await repository.call("claim_generation", sponsor, { competition_id: competition, job_id: job.id });
    await expect(repository.call("finish_generation", sponsor, { competition_id: competition, job_id: job.id, token: claim.token, candidates: [] })).rejects.toThrow("GENERATION_CLAIM_MISMATCH");
  });
  it("keeps policy-pinned competition earnings idempotent and immutable", async () => {
    await actor(5);
    await db.query("select public.qb_sme_configure('sme_profiles',$1::jsonb)", [JSON.stringify({ user_id: id(3), reviewer_tier: "qualified", reviewer_status: "verified", active: true })]);
    const policy = (await db.query<{ data: { id: string } }>("select public.qb_sme_configure('compensation_policies',$1::jsonb) data", [JSON.stringify({ name: "Isolated sponsor policy", sponsor_id: sponsor, active: true })])).rows[0].data;
    const rate = (await db.query<{ data: { id: string } }>("select public.qb_sme_configure('compensation_policy_versions',$1::jsonb) data", [JSON.stringify({ policy_id: policy.id, currency_code: "GHS", effective_from: "2020-01-01T00:00:00Z", base_review_fee: "2.5", approve_fee: "1.25", reject_fee: "0.5", revision_fee: "0.25", senior_review_fee: "2", funded_by: "demo sponsor" })])).rows[0].data;
    await actor(1);
    const job = await repository.call<{ id: string }>("queue_generation", sponsor, { competition_id: competition, request_key: id(26), spec: spec() });
    await executeGenerationJob(repository, sponsor, competition, job.id, { name: "mock", model: "fixture", async generate(input, chunks) { return [{ id: id(31), competitionId: competition, jobId: input.jobId, sourceDocumentId: document, sourceChunkId: chunks[0].id, stem: "Should power be isolated before maintenance?", options: ["True", "False"], correctAnswer: 0, explanation: "The source requires power isolation before maintenance.", difficulty: "easy", cognitiveLevel: "recall", subject: "Computing", curriculumId: null, educationLevel: "SHS", model: "fixture", status: "GENERATED", approvedVersionId: null }]; } });
    await db.exec("reset role");
    await db.query("insert into public.questions(id,version,subject_code,curriculum_node_id,source_type,validation_status,status,question_text,explanation,option_a,option_b,correct_answer,source_document_ids) values($1,1,'Computing',$2,'AI_GENERATED','review','inactive','Should power be isolated before maintenance?','The source requires power isolation before maintenance.','True','False','A',array[$3::uuid])", [id(64), id(61), document]);
    await db.query("insert into public.question_versions values($1,$2,1,'{}')", [id(65), id(64)]);
    await actor(5);
    const work = await repository.call<{ id: string; compensation_policy_version_id: string }>("assign_candidate", sponsor, { competition_id: competition, candidate_id: id(31), question_id: id(64), reviewer_id: id(3), domain_id: id(60) });
    expect(work.compensation_policy_version_id).toBe(rate.id);
    await actor(3); await repository.call("review_detail", null, { candidate_id: id(31), assignment_id: work.id });
    const args = { candidate_id: id(31), assignment_id: work.id, decision: "approve", note: "Source and answer reviewed", human_reviewed: true, version: 1 };
    await repository.call("complete_review", null, args); await repository.call("complete_review", null, args);
    await db.exec("reset role");
    const earnings = await db.query<{ compensation_policy_version_id: string; final_amount: string; currency_code: string }>("select compensation_policy_version_id,final_amount::text,currency_code from public.reviewer_earnings");
    expect(earnings.rows).toEqual([{ compensation_policy_version_id: rate.id, final_amount: "3.750000", currency_code: "GHS" }]);
    await expect(db.query("update public.reviewer_earnings set final_amount=0")).rejects.toThrow("QB_IMMUTABLE_HISTORY");
    await actor(1);
  });
  it("rejects bank inclusion above the configured target", async () => {
    await repository.call("include_bank", sponsor, { competition_id: competition, candidate_id: id(30), position: 0 });
    await expect(repository.call("include_bank", sponsor, { competition_id: competition, candidate_id: id(31), position: 1 })).rejects.toThrow("BANK_TARGET_COUNT_EXCEEDED");
  });
  it("does not bank an old approved version after the linked question changes", async () => {
    await db.exec("reset role"); await db.query("update public.questions set version=2 where id=$1", [id(62)]); await actor(1);
    await expect(repository.call("include_bank", sponsor, { competition_id: competition, candidate_id: id(30), position: 0 })).rejects.toThrow("UNAPPROVED_BANK_OR_PROVENANCE");
  });
  it("refuses bridge rollback after persisted review and generation activity", async () => {
    await db.exec("reset role");
    await expect(db.exec(readFileSync(new URL("../../supabase/rollback/sponsor_candidate_review_bridge.sql", import.meta.url), "utf8"))).rejects.toThrow("ROLLBACK_REQUIRES_ARCHIVE_AND_ISOLATED_RESTORE");
    await db.exec("rollback"); await actor(1);
  });
  it("refuses rollback with persisted workflow records", async () => {
    await db.exec("reset role");
    await expect(db.exec(readFileSync(new URL("../../supabase/rollback/sponsor_authenticated_workflows.sql", import.meta.url), "utf8"))).rejects.toThrow("ROLLBACK_REQUIRES_ARCHIVE_AND_ISOLATED_RESTORE");
    await db.exec("rollback"); await actor(1);
  });
  it("revoked managed owner cannot retain uploader-based source access", async () => {
    await repository.member(sponsor, id(4), "sponsor_owner", true); await repository.member(sponsor, id(1), "sponsor_viewer", false);
    await db.exec("reset role");
    expect((await db.query<{ allowed: boolean }>("select quizbox_market.document_owned($1) allowed", [document])).rows[0].allowed).toBe(false);
    await actor(4); await db.exec("reset role"); expect((await db.query<{ allowed: boolean }>("select quizbox_market.document_owned($1) allowed", [document])).rows[0].allowed).toBe(true);
    await actor(4); await repository.member(sponsor, id(1), "sponsor_owner", true); await actor(1);
  });
  it("retains unmanaged legacy sponsor ownership", async () => {
    await actor(2); await db.exec("reset role");
    await db.query("insert into public.sponsor_profiles(id,user_id,status) values($1,$2,'ACTIVE')", [id(90), id(2)]);
    await db.query("insert into public.source_documents(id,sponsor_id,source_kind) values($1,$2,'SPONSOR_SOURCE')", [id(91), id(90)]);
    expect((await db.query<{ allowed: boolean }>("select quizbox_market.document_owned($1) allowed", [id(91)])).rows[0].allowed).toBe(true); await actor(1);
  });
});
