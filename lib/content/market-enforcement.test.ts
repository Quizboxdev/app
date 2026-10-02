import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let db: PGlite;
let gh: string;
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
async function value(sql: string, args: unknown[] = []) {
  await db.exec("savepoint assertion");
  try {
    const result = await db.query<Record<string, unknown>>(sql, args);
    await db.exec("release savepoint assertion");
    return Object.values(result.rows[0] ?? {})[0];
  } catch (error) {
    await db.exec("rollback to savepoint assertion; release savepoint assertion");
    throw error;
  }
}
async function actor(n: number, authenticated = false) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
  if (authenticated) await db.exec("set role authenticated");
}
const context = (scope: string, mode: string, markets: string[], sources: number[]) => value("select public.qb_create_content_context($1,$2,$3::uuid[],$4::uuid[])", [scope, mode, markets, sources.map(id)]);

describe("market governance PostgreSQL integration (isolated contract fixtures)", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      create table profiles(id uuid primary key,role text,status text,country text);
      create table student_profiles(user_id uuid,grade text,status text);
      create table curricula(id uuid primary key,code text,country text);
      create table tenants(id uuid primary key,country text);
      create table tenant_memberships(user_id uuid,tenant_id uuid,status text);
      create table sponsor_profiles(id uuid primary key,user_id uuid);
      create table curriculum_nodes(id uuid primary key,curriculum_id uuid,education_level text,is_active boolean,source_grade_code text,canonical_grade_code text,subject_code text);
      create table questions(id uuid primary key,version int,subject_code text,curriculum_id uuid,curriculum_node_id uuid,canonical_grade_code text,grade text,tenant_id uuid,source_type text,validation_status text,status text,reviewed_by uuid,reviewed_at timestamptz,editorial_metadata jsonb default '{}',import_batch_id uuid);
      create table question_versions(id uuid primary key,question_id uuid,version_no int);
      create table classes(id uuid primary key,curriculum_id uuid,tenant_id uuid);
      create table class_memberships(id uuid primary key,class_id uuid);
      create table question_banks(id uuid primary key,tenant_id uuid);
      create table assignments(id uuid primary key,class_id uuid);
      create table question_bank_items(id uuid primary key,question_id uuid,bank_id uuid);
      create table question_media(question_id uuid);
      create table learning_events(id uuid primary key,curriculum_node_id uuid);
      create table mastery_records(id uuid primary key,curriculum_node_id uuid);
      create table source_documents(id uuid primary key,tenant_id uuid,uploaded_by uuid,title text,checksum text,rights_confirmed boolean);
      create table competitions(id uuid primary key,sponsor_id uuid,assessment_id uuid,created_by uuid);
      create table competition_stages(id uuid primary key,competition_id uuid);
      create table competition_rounds(id uuid primary key,stage_id uuid,assessment_id uuid);
      create table competition_results(competition_id uuid,score int);
      create table competition_sponsors(competition_id uuid,committed_amount int);
      create table competition_teams(id uuid primary key,competition_id uuid);
      create table competition_team_members(id uuid primary key,team_id uuid);
      create table content_import_batches(id uuid primary key,generation_spec jsonb,imported_by uuid);
      create table attempts(id uuid primary key,assessment_id uuid,student_user_id uuid);
      create table assessment_questions(assessment_id uuid,question_id uuid);
      create function qb_is_tenant_member(uuid) returns boolean language sql stable as $$ select false $$;
      create function qb_content_validation_errors(jsonb) returns jsonb language sql as $$ select '[]'::jsonb $$;
      create function qb_question_is_available(q questions) returns boolean language sql stable security definer set search_path='' as $$ select q.status='active' and q.validation_status='approved' $$;
      create function qb_can_access_learning_assessment(p_assessment_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null $$;
      create function qb_content_queue(p_filters jsonb default '{}',p_page int default 1,p_limit int default 25) returns jsonb language plpgsql security definer set search_path='' as $$ begin return (select jsonb_build_object('total',count(*)) from (select q.* from public.questions q where (p_filters->>'curriculum')::uuid=q.curriculum_id) q); end $$;
      create function qb_content_coverage(p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$ begin return (with nodes as (select * from public.curriculum_nodes where is_active), production as (select * from public.questions where source_type='HUMAN_AUTHOR') select jsonb_build_object('nodes',(select count(*) from nodes),'questions',(select count(*) from production))); end $$;
      create function qb_content_batches() returns jsonb language plpgsql security definer set search_path='' as $$ begin return (select jsonb_build_object('total',(select count(*) from public.content_import_batches),'rows',(select jsonb_agg(to_jsonb(b)) from public.content_import_batches b))); end $$;
      create function qb_can_manage_class(p_class_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select true $$;
      create function qb_is_class_member(p_class_id uuid) returns boolean language sql stable security definer set search_path='' as $$ select true $$;
      create function qb_competition_leaderboard(p_competition_id uuid) returns table(score int) language sql stable security definer set search_path='' as $$ select cr.score from public.competition_results cr where cr.competition_id = p_competition_id $$;
      create function qb_competition_funding_summary(p_competition_id uuid) returns jsonb language sql stable security definer set search_path='' as $$ select jsonb_build_object('amount',sum(cs.committed_amount)) from public.competition_sponsors cs where cs.competition_id = p_competition_id $$;
      create function qb_admin_content_health() returns jsonb language plpgsql stable security definer set search_path='' as $$ declare result jsonb;
      begin
      select jsonb_build_object('questions',count(*),'banks',(select count(*)
      from public.question_banks
      )) into result from public.questions;
      return result; end $$;
      create function qb_register_competition_school(p_competition_id uuid,p_institution_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_create_competition_team(p_competition_id uuid,p_institution_id uuid,p_team_name text) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_add_team_member(p_team_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_verify_team_member(p_team_member_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_attach_competition_sponsor(p_competition_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_record_competition_result(p_competition_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_finalize_competition_leaderboard(p_competition_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_content_detail(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return jsonb_build_object('id',p_id); end $$;
      create function qb_content_review(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin if (select role from public.profiles where id=auth.uid()) not in ('OWNER','ADMIN') then raise exception 'ORIGINAL_ROLE_DENIED'; end if; return '{}'; end $$;
      create function qb_content_request_generation(p_spec jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin return p_spec; end $$;
      create function qb_content_ingest(p_spec jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin return p_spec; end $$;
      create function qb_publish_assignment(p_class_id uuid,p_curriculum_node_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      create function qb_start_attempt(p_assessment_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin return '{}'; end $$;
      insert into profiles values('${id(1)}','OWNER','active','Ghana'),('${id(2)}','TEACHER','active','Ghana'),('${id(3)}','STUDENT','active','Ghana'),('${id(4)}','SPONSOR','active','Ghana'),('${id(5)}','TEACHER','active',null),('${id(6)}','ADMIN','active','Ghana');
      insert into student_profiles values('${id(3)}','B10','active');
      insert into curricula values('${id(10)}','GH-CCP-2020','Ghana'),('${id(11)}','FOREIGN','Other'),('${id(12)}','UNKNOWN',null);
      insert into tenants values('${id(13)}','Ghana');
      insert into curriculum_nodes values('${id(20)}','${id(10)}','secondary',true,'B10','SHS1','Mathematics'),('${id(21)}','${id(11)}','secondary',true,'Y10','Y10','Mathematics');
      insert into questions(id,version,subject_code,curriculum_id,curriculum_node_id,canonical_grade_code,grade,source_type,validation_status,status) values('${id(30)}',1,'Mathematics','${id(10)}','${id(20)}','SHS1','B10','HUMAN_AUTHOR','approved','active'),('${id(31)}',1,'Mathematics','${id(11)}','${id(21)}','Y10','Y10','HUMAN_AUTHOR','approved','active');
      insert into classes values('${id(40)}','${id(10)}','${id(13)}'),('${id(42)}',null,'${id(13)}');
      insert into sponsor_profiles values('${id(41)}','${id(4)}');
      insert into assessment_questions values('${id(50)}','${id(30)}'),('${id(51)}','${id(31)}');
      alter table curricula enable row level security; alter table curriculum_nodes enable row level security; alter table questions enable row level security; alter table source_documents enable row level security;
      create policy original_curricula_read on curricula for select to authenticated using(true);
      create policy original_nodes_read on curriculum_nodes for select to authenticated using(true);
      create policy original_questions_read on questions for select to authenticated using(true);
      create policy original_sources_read on source_documents for select to authenticated using(true);
      grant select on curricula,curriculum_nodes,questions,source_documents,competitions to authenticated;
    `);
    await db.exec(migration("20261002200000_market_sme_foundation.sql"));
    await db.exec(migration("20261002210000_content_market_enforcement.sql"));
    gh = (await db.query<{ id: string }>("select id from markets")).rows[0].id;
    await db.exec(`
      insert into countries(id,iso2_code,iso3_code,name,default_currency_code,timezone,locale) values('${id(60)}','GB','GBR','United Kingdom','GHS','Europe/London','en-GB');
      insert into markets(id,country_id,name,default_currency_code,timezone,locale) values('${id(61)}','${id(60)}','UK Schools','GHS','Europe/London','en-GB');
      insert into curriculum_authorities(id,market_id,code,name) values('${id(62)}','${id(61)}','TEST','Acceptance authority');
      update curricula set market_id='${id(61)}' where id='${id(11)}';
      insert into market_curricula values('${id(11)}','${id(61)}','${id(62)}',true);
      insert into legacy_content_attributions values('${id(31)}','${id(11)}','${id(61)}','Explicit test fixture');
      insert into source_documents(id,title,checksum,rights_confirmed,market_id,curriculum_id,authority_id,source_kind,validation_status,approved_by,content_text)
       select '${id(70)}','Ghana curriculum','sha256-fixture',true,'${gh}','${id(10)}',authority_id,'CURRICULUM','approved','${id(1)}','Approved curriculum extract' from market_curricula where curriculum_id='${id(10)}';
      insert into source_documents(id,title,checksum,rights_confirmed,market_id,curriculum_id,authority_id,source_kind,validation_status,approved_by,content_text) values('${id(71)}','UK curriculum','hash',true,'${id(61)}','${id(11)}','${id(62)}','CURRICULUM','approved','${id(1)}','Approved foreign extract');
      insert into source_documents(id,title,checksum,rights_confirmed,market_id,sponsor_id,uploaded_by,source_kind,validation_status,approved_by,content_text) values('${id(72)}','Sponsor document','hash',true,'${gh}','${id(41)}','${id(4)}','SPONSOR_SOURCE','approved','${id(1)}','Sponsor approved extract');
      insert into source_documents(id,title,checksum,rights_confirmed,source_kind,validation_status,approved_by,content_text) values('${id(73)}','Harmonized pack','hash',true,'HARMONIZED_PACK','approved','${id(1)}','Explicit harmonized extract');
      insert into harmonized_concept_mappings values('${id(73)}','${id(20)}','concept-a',true);
      insert into sme_profiles(user_id,reviewer_tier,reviewer_status,active) values('${id(2)}','qualified','verified',true);
      insert into sme_domain_assignments(id,reviewer_id,subject_code,curriculum_id,market_id,education_level,grade_codes,can_review,can_approve) values('${id(80)}','${id(2)}','Mathematics','${id(10)}','${gh}','secondary',array['SHS1'],true,true);
    `);
  }, 60_000);
  beforeEach(async () => { await db.exec("begin"); await actor(2); });
  afterEach(async () => { await db.exec("rollback; reset role"); });
  afterAll(async () => { await db.close(); });

  it("exposes the document-only candidate materialization blocker without inventing a curriculum node", async () => {
    await actor(4);
    const selected = await context("LOCAL_MARKET", "SPONSOR_SOURCE", [gh], [72]);
    await value("select public.qb_activate_content_context($1)", [selected]);
    await expect(value("insert into public.questions(id,version,subject_code,source_type,validation_status,status) values($1,1,'Computing','AI_GENERATED','review','inactive') returning id", [id(90)]))
      .rejects.toThrow("QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT");
  });

  it("backfills only proven Ghana records and preserves national/source grade identity", async () => {
    expect(await value("select default_market_id from profiles where id=$1", [id(2)])).toBe(gh);
    expect(await value("select default_market_id from profiles where id=$1", [id(5)])).toBeNull();
    expect(await value("select grade from questions where id=$1", [id(30)])).toBe("B10");
    expect(await value("select canonical_grade_code from questions where id=$1", [id(30)])).toBe("SHS1");
    expect(await value("select count(*)::int from market_attribution_issues where entity='curriculum' and record_id=$1", [id(12)])).toBe(1);
  });
  it("Ghana teacher reads Ghana curriculum only, including manipulated direct IDs", async () => {
    await actor(2, true);
    expect(await value("select count(*)::int from curricula")).toBe(1);
    expect(await value("select count(*)::int from curricula where id=$1", [id(11)])).toBe(0);
    expect(await value("select count(*)::int from curriculum_nodes where id=$1", [id(21)])).toBe(0);
    expect(await value("select count(*)::int from questions where id=$1", [id(31)])).toBe(0);
  });
  it("denies foreign market manipulation through the market switch RPC", async () => {
    await actor(2, true);
    await expect(value("select qb_select_content_market($1)", [id(61)])).rejects.toThrow("QB_CONTENT_MARKET_DENIED");
  });
  it("requires an assigned market rather than guessing Ghana", async () => {
    await actor(5, true);
    await expect(value("select qb_content_market_context()")).rejects.toThrow("QB_CONTENT_MARKET_REQUIRED");
    expect(await value("select count(*)::int from curricula")).toBe(0);
  });
  it("student practice denies foreign assessment IDs server-side", async () => {
    await actor(3, true);
    expect(await value("select qb_can_access_learning_assessment($1)", [id(50)])).toBe(true);
    expect(await value("select qb_can_access_learning_assessment($1)", [id(51)])).toBe(false);
    await expect(value("select qb_start_attempt($1)", [id(51)])).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
  });
  it("teacher publication rejects foreign objective manipulation", async () => {
    await expect(value("select qb_publish_assignment($1,$2::uuid[])", [id(40), [id(21)]])).rejects.toThrow("QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT");
    expect(await value("select qb_publish_assignment($1,$2::uuid[])", [id(40), [id(20)]])).toEqual({});
  });
  it("retains existing role checks after inserting market guards", async () => {
    await expect(value("select qb_content_review($1)", [id(30)])).rejects.toThrow("ORIGINAL_ROLE_DENIED");
  });
  it("does not grant ordinary admins implicit cross-market access", async () => {
    await actor(6, true);
    expect(await value("select count(*)::int from curricula where id=$1", [id(11)])).toBe(0);
    await expect(value("select qb_content_detail($1)", [id(31)])).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
  });
  it("allows Super Admin to explicitly switch across markets", async () => {
    await actor(1, true);
    await value("select qb_select_content_market($1)", [id(61)]);
    expect(await value("select count(*)::int from curricula where id=$1", [id(11)])).toBe(1);
  });
  it("requires explicit authorized multi-market membership and sources", async () => {
    await expect(context("MULTI_MARKET", "CURRICULUM_ALIGNED", [gh, id(61)], [70, 71])).rejects.toThrow("QB_CONTENT_MARKET_DENIED");
    await db.query("insert into user_market_memberships values($1,$2,true)", [id(2), id(61)]);
    expect(await context("MULTI_MARKET", "CURRICULUM_ALIGNED", [gh, id(61)], [70, 71])).toEqual(expect.any(String));
  });
  it("supports local curriculum-aligned sources but denies a foreign source", async () => {
    expect(await context("LOCAL_MARKET", "CURRICULUM_ALIGNED", [gh], [70])).toEqual(expect.any(String));
    await expect(context("LOCAL_MARKET", "CURRICULUM_ALIGNED", [gh], [71])).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
  });
  it("supports sponsor sources and hybrid without granting other users document ownership", async () => {
    await expect(context("LOCAL_MARKET", "SPONSOR_SOURCE", [gh], [72])).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
    await actor(4, true);
    expect(await context("LOCAL_MARKET", "SPONSOR_SOURCE", [gh], [72])).toEqual(expect.any(String));
    expect(await context("LOCAL_MARKET", "HYBRID", [gh], [70, 72])).toEqual(expect.any(String));
    await expect(context("LOCAL_MARKET", "HYBRID", [gh], [72])).rejects.toThrow("QB_SOURCE_MODE_MISMATCH");
  });
  it("global uses explicit packs/documents, never automatic national curriculum mixing", async () => {
    await actor(1, true);
    await expect(context("GLOBAL", "CURRICULUM_ALIGNED", [], [])).rejects.toThrow("QB_EXPLICIT_CONTENT_CONTEXT_REQUIRED");
    await expect(context("GLOBAL", "CURRICULUM_ALIGNED", [], [70, 71])).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
    expect(await context("GLOBAL", "CURRICULUM_ALIGNED", [], [73])).toEqual(expect.any(String));
  });
  it("revalidates active contexts after membership is revoked", async () => {
    const c = await context("LOCAL_MARKET", "CURRICULUM_ALIGNED", [gh], [70]);
    await value("select qb_activate_content_context($1)", [c]);
    await db.query("update user_market_memberships set active=false where user_id=$1", [id(2)]);
    await expect(value("select qb_content_market_context()")).rejects.toThrow("QB_CONTENT_MARKET_DENIED");
  });
  it("generation resolves approved documents and persists full audience/provenance context", async () => {
    const spec = { indicatorId: id(20), curriculumId: id(10), sourceDocumentIds: [id(70)] };
    const resolved = await value("select qb_resolve_generation_sources($1::jsonb)", [JSON.stringify(spec)]) as Record<string, any>;
    expect(resolved.documents[0].id).toBe(id(70));
    expect(resolved.spec.content_context.provenance[0].curriculum_id).toBe(id(10));
    expect(resolved.spec.target_audience).toMatchObject({ source_grade: "B10", canonical_grade: "SHS1" });
    await db.query("insert into content_import_batches(id,generation_spec,imported_by) values($1,$2::jsonb,$3)", [id(90), JSON.stringify(spec), id(2)]);
    expect(await value("select content_context->>'scope' from content_import_batches where id=$1", [id(90)])).toBe("LOCAL_MARKET");
  });
  it("fails generation before provider retrieval when sources are missing or foreign", async () => {
    await expect(value("select qb_resolve_generation_sources($1::jsonb)", [JSON.stringify({ indicatorId: id(20), curriculumId: id(10) })])).rejects.toThrow("QB_EXPLICIT_CONTENT_CONTEXT_REQUIRED");
    await expect(value("select qb_content_request_generation($1::jsonb)", [JSON.stringify({ indicatorId: id(20), curriculumId: id(10), sourceDocumentIds: [id(71)] })])).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
  });
  it("SME domain checks require assigned market, subject, curriculum and education level", async () => {
    expect(await value("select quizbox_sme.domain_matches($1,$2,$3,$4,false,false)", [id(80), id(30), id(2), gh])).toBe(true);
    expect(await value("select quizbox_sme.domain_matches($1,$2,$3,$4,false,false)", [id(80), id(31), id(2), id(61)])).toBe(false);
    await db.query("update user_market_memberships set active=false where user_id=$1", [id(2)]);
    expect(await value("select quizbox_sme.domain_matches($1,$2,$3,$4,false,false)", [id(80), id(30), id(2), gh])).toBe(false);
  });
  it("review queues and coverage summaries do not include foreign content", async () => {
    const queue = await value("select qb_content_queue()") as Record<string, number>;
    expect(queue.total).toBe(1);
    const coverage = await value("select qb_content_coverage()") as Record<string, number>;
    expect(coverage).toMatchObject({ nodes: 1, questions: 1 });
    await expect(value("select qb_content_queue($1::jsonb)", [JSON.stringify({ curriculum: id(11) })])).rejects.toThrow("QB_EXPLICIT_CURRICULUM_REQUIRED");
  });
  it("prevents direct client approval and membership forgery", async () => {
    await actor(2, true);
    await expect(value("insert into user_market_memberships values($1,$2,true)", [id(2), id(61)])).rejects.toThrow("permission denied");
    await expect(value("update source_documents set validation_status='approved' where id=$1", [id(70)])).rejects.toThrow("permission denied");
  });
  it("does not grant anonymous execution of privileged context RPCs", async () => {
    expect(await value("select has_function_privilege('anon','public.qb_content_market_context()','EXECUTE')")).toBe(false);
    expect(await value("select has_function_privilege('authenticated','quizbox_market.validate_context(text,text,uuid[],uuid[])','EXECUTE')")).toBe(false);
  });
  it.each(["LOCAL_MARKET","MULTI_MARKET","GLOBAL"])("binds and enforces sponsor %s competition scope", async scope => {
    await db.query("insert into user_market_memberships values($1,$2,true)",[id(4),id(61)]);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("insert into competitions(id,sponsor_id,created_by) values($1,$2,$3)",[id(91),id(41),id(4)]);
    await actor(4,true);
    const c=await context(scope,scope==="GLOBAL" ? "SPONSOR_SOURCE" : "CURRICULUM_ALIGNED",scope==="GLOBAL" ? [] : scope==="LOCAL_MARKET" ? [gh] : [gh,id(61)],scope==="GLOBAL" ? [72] : scope==="LOCAL_MARKET" ? [70] : [70,71]);
    await value("select qb_set_competition_content_context($1,$2)",[id(91),c]);
    await actor(3,true);
    expect(await value("select count(*)::int from competitions where id=$1",[id(91)])).toBe(1);
    await actor(5,true);
    expect(await value("select count(*)::int from competitions where id=$1",[id(91)])).toBe(scope==="GLOBAL" ? 1 : 0);
  });
  it("does not bind a competitor's context or change a frozen binding", async () => {
    const c=await context("LOCAL_MARKET","CURRICULUM_ALIGNED",[gh],[70]);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("insert into competitions(id,sponsor_id,created_by) values($1,$2,$3)",[id(91),id(41),id(4)]);
    await actor(4,true);
    await expect(value("select qb_set_competition_content_context($1,$2)",[id(91),c])).rejects.toThrow("QB_CONTENT_CONTEXT_DENIED");
    const own=await context("LOCAL_MARKET","SPONSOR_SOURCE",[gh],[72]);
    await value("select qb_set_competition_content_context($1,$2)",[id(91),own]);
    await expect(value("select qb_set_competition_content_context($1,$2)",[id(91),own])).rejects.toThrow("QB_COMPETITION_CONTEXT_LOCKED");
  });
  it("student practice defaults to assigned canonical grade",async()=>{
    await db.query("update student_profiles set grade='B7' where user_id=$1",[id(3)]);
    await actor(3,true);
    expect(await value("select qb_can_access_learning_assessment($1)",[id(50)])).toBe(false);
  });
  it("student cannot retrieve answer-bearing raw generation extracts",async()=>{
    await actor(3,true);
    await expect(value("select qb_resolve_generation_sources($1::jsonb)",[JSON.stringify({indicatorId:id(20),curriculumId:id(10),sourceDocumentIds:[id(70)]})])).rejects.toThrow("QB_CONTENT_ACCESS_DENIED");
  });
  it("source approval and curriculum authority management require explicit Super Admin",async()=>{
    await actor(6,true);
    await expect(value("select qb_market_configure('user_market_memberships',$1::jsonb)",[JSON.stringify({user_id:id(6),market_id:id(61),active:true})])).rejects.toThrow("QB_MARKET_CONFIGURATION_DENIED");
    await actor(1,true);
    const result=await value("select qb_market_configure('user_market_memberships',$1::jsonb)",[JSON.stringify({user_id:id(5),market_id:gh,active:true,make_default:true})]) as Record<string,unknown>;
    expect(result.market_id).toBe(gh);
  });
  it("approved source text is immutable rather than silently changing job provenance",async()=>{
    await actor(1);
    await expect(value("update source_documents set content_text='Different' where id=$1",[id(70)])).rejects.toThrow("QB_APPROVED_SOURCE_IMMUTABLE");
  });
  it("persists attempt context without modifying original answer payload contracts",async()=>{
    await actor(3);
    await db.query("insert into attempts values($1,$2,$3,null)",[id(95),id(50),id(3)]);
    expect(await value("select content_context->>'scope' from attempts where id=$1",[id(95)])).toBe("LOCAL_MARKET");
  });
  it("preserves existing function identities instead of moving delegated bodies",async()=>{
    expect(await value("select count(*)::int from pg_proc where pronamespace='quizbox_market'::regnamespace and proname='qb_start_attempt'")).toBe(0);
    expect(await value("select prosrc like '%quizbox_market.assessment_allowed%' from pg_proc where pronamespace='public'::regnamespace and proname='qb_start_attempt'")).toBe(true);
  });
  it("does not expose another assigned market's sources under a local default",async()=>{
    await db.query("insert into user_market_memberships values($1,$2,true)",[id(2),id(61)]);
    await actor(2,true);
    expect(await value("select count(*)::int from source_documents where id=$1",[id(71)])).toBe(0);
    const local=await value("select qb_list_content_sources()") as Array<{id:string}>;
    expect(local.map(row=>row.id)).not.toContain(id(71));
    const explicit=await value("select qb_list_content_sources(null,'MULTI_MARKET',$1::uuid[])",[[gh,id(61)]]) as Array<{id:string}>;
    expect(explicit.map(row=>row.id)).toContain(id(71));
  });
  it("legacy Ghana class metadata remains accessible without guessing a curriculum",async()=>{
    expect(await value("select qb_can_manage_class($1)",[id(42)])).toBe(true);
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("insert into classes values($1,$2,null)",[id(43),id(11)]);
    await actor(2);
    expect(await value("select qb_can_manage_class($1)",[id(43)])).toBe(false);
  });
  it("admin content health is scoped before aggregation",async()=>{
    await actor(6,true);
    const health=await value("select qb_admin_content_health()") as Record<string,number>;
    expect(health.questions).toBe(1);
  });
  it("generation and attempt context snapshots cannot be rewritten",async()=>{
    await actor(3);
    await db.query("insert into attempts values($1,$2,$3,null)",[id(95),id(50),id(3)]);
    await expect(value("update attempts set content_context='{}' where id=$1",[id(95)])).rejects.toThrow("QB_CONTENT_CONTEXT_IMMUTABLE");
  });
  it("cannot move a bound national authority or curriculum into a different country",async()=>{
    await actor(1);
    await expect(value("update curriculum_authorities set market_id=$1 where id=$2",[gh,id(62)])).rejects.toThrow("QB_NATIONAL_AUTHORITY_IDENTITY_IMMUTABLE");
    await expect(value("update curricula set market_id=$1 where id=$2",[gh,id(11)])).rejects.toThrow("QB_NATIONAL_CURRICULUM_IDENTITY_IMMUTABLE");
  });
  it("a national document cannot impersonate a harmonized mapping pack",async()=>{
    await actor(1);
    await expect(value("insert into harmonized_concept_mappings values($1,$2,'bad',true)",[id(70),id(20)])).rejects.toThrow("QB_EXPLICIT_HARMONIZED_SOURCE_REQUIRED");
  });
  it("competition generation uses its bound source mode without changing the user's default",async()=>{
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("insert into competitions(id,sponsor_id,created_by) values($1,$2,$3)",[id(91),id(41),id(4)]);
    await actor(4,true);
    const c=await context("LOCAL_MARKET","SPONSOR_SOURCE",[gh],[72]);
    await value("select qb_set_competition_content_context($1,$2)",[id(91),c]);
    const resolved=await value("select qb_resolve_generation_sources($1::jsonb)",[JSON.stringify({competitionId:id(91),indicatorId:id(20),curriculumId:id(10)})]) as Record<string,any>;
    expect(resolved.spec.content_context.source_mode).toBe("SPONSOR_SOURCE");
    expect(resolved.documents.map((row:{id:string})=>row.id)).toEqual([id(72)]);
    await expect(value("select qb_resolve_generation_sources($1::jsonb)",[JSON.stringify({competitionId:id(91),indicatorId:id(20),curriculumId:id(10),sourceDocumentIds:[id(70)]})])).rejects.toThrow("QB_COMPETITION_SOURCE_SET_MISMATCH");
  });
  it("rejecting an approved source revokes existing contexts without changing its text",async()=>{
    const c=await context("LOCAL_MARKET","CURRICULUM_ALIGNED",[gh],[70]);
    await value("select qb_activate_content_context($1)",[c]);
    await actor(1);
    await value("update source_documents set validation_status='rejected' where id=$1",[id(70)]);
    await actor(2,true);
    await expect(value("select qb_content_market_context()")).rejects.toThrow("QB_CONTENT_SOURCE_DENIED");
  });
});
