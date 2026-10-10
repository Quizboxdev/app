import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createDeliveryFixture } from "../../competition/fixtures/database";

// Shared isolated-PostgreSQL fixture for Content Factory tests: the governance, ingest and SME SQL with a Ghana market, a Computing curriculum
// (indicators ind[0..2]), an approved source, SMEs id(10..12) and a content admin id(13). Copied from campaign.test.ts so other suites
// (question loading) run against the same real import function.
export const fixtureId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export async function createFactoryFixture() {
  const id = fixtureId;
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const curriculum = randomUUID(), source = randomUUID(), foreignSource = randomUUID(), subjectNode = randomUUID(), strand = randomUUID();
  const ind = [randomUUID(), randomUUID(), randomUUID()], mathInd = randomUUID();
  const { db, market } = await createDeliveryFixture();
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
  const testland = (await db.query<{ id: string }>("insert into markets(country_id,name,default_currency_code,timezone,locale,status) values($1,'Testland','TSD','UTC','en-XT','ACTIVE') returning id", [country])).rows[0].id;
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
  return { db, market, testland, curriculum, source, foreignSource, subjectNode, strand, ind, mathInd };
}
