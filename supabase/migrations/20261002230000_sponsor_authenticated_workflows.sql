-- Local preparation only. Public entrypoint is INVOKER; private implementation
-- resolves auth.uid(), active profiles and database memberships for every action.
begin;
alter table quizbox_competition.drafts alter column content_context_id drop not null;
alter table quizbox_competition.sponsor_organizations add column contact_email text;
alter table quizbox_competition.sponsor_organizations add column contact_phone text;
alter table quizbox_competition.documents add column extraction_token uuid;
alter table quizbox_competition.documents add column extraction_started_at timestamptz;
alter table quizbox_competition.generation_jobs add column execution_token uuid;
alter table quizbox_competition.generation_jobs add column request_key uuid not null default gen_random_uuid();
create unique index sponsor_generation_request on quizbox_competition.generation_jobs(competition_id,request_key);

create function quizbox_competition.require_member(p_sponsor uuid,p_write boolean default false,p_manage boolean default false)
returns text language plpgsql stable security definer set search_path='' as $$
declare r text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if quizbox_market.is_super() then return 'super_admin'; end if;
 select m.role into r from quizbox_competition.organization_members m join public.sponsor_profiles s on s.id=m.sponsor_id join quizbox_competition.sponsor_organizations o on o.sponsor_id=m.sponsor_id
 where m.sponsor_id=p_sponsor and m.user_id=auth.uid() and m.active and lower(s.status) not in ('suspended','archived') and quizbox_market.market_allowed(o.market_id);
 if r is null then raise exception 'SPONSOR_ACCESS_DENIED' using errcode='42501'; end if;
 if p_write and r='sponsor_viewer' or p_manage and r not in ('sponsor_owner','sponsor_admin') then raise exception 'SPONSOR_WRITE_DENIED' using errcode='42501'; end if;
 return r;
end $$;

create function quizbox_competition.dispatch(p_action text,p_sponsor uuid,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; s uuid; c uuid; d uuid; role_name text; member_id uuid;
 config jsonb; expected integer; changed integer; market uuid; country uuid;
 token uuid; state text; context public.content_contexts; source public.source_documents;
 job uuid; spec jsonb; source_ids uuid[]; market_ids uuid[]; validated jsonb; job_row quizbox_competition.generation_jobs;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>1500000 then raise exception 'INVALID_SPONSOR_INPUT'; end if;
 if p_action='create_organization' then
  if not exists(select 1 from public.profiles where id=auth.uid() and upper(role::text)='SPONSOR') and not quizbox_market.is_super() then raise exception 'SPONSOR_ROLE_REQUIRED' using errcode='42501'; end if;
  market:=(p_data->>'market_id')::uuid; country:=(p_data->>'country_id')::uuid;
  if not quizbox_market.market_allowed(market) or not exists(select 1 from public.markets where id=market and country_id=country and active) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
  if nullif(btrim(p_data->>'organization_name'),'') is null or nullif(btrim(p_data->>'organization_type'),'') is null or nullif(btrim(p_data->>'contact_email'),'') is null then raise exception 'ORGANIZATION_FIELDS_REQUIRED'; end if;
  -- Existing profile may be linked once by its original user; no role promotion.
  select id into s from public.sponsor_profiles where user_id=auth.uid() order by created_at limit 1 for update;
  if s is not null and exists(select 1 from quizbox_competition.sponsor_organizations where sponsor_id=s) then raise exception 'SPONSOR_ORGANIZATION_ALREADY_EXISTS'; end if;
  if s is null then
   insert into public.sponsor_profiles(user_id,organization_name,contact_name,status) values(auth.uid(),p_data->>'organization_name',p_data->>'contact_name','PENDING') returning id into s;
  else
   update public.sponsor_profiles set organization_name=p_data->>'organization_name',contact_name=p_data->>'contact_name',updated_at=now() where id=s;
  end if;
  insert into quizbox_competition.sponsor_organizations(sponsor_id,organization_type,country_id,market_id,website,contact_email,contact_phone)
  values(s,p_data->>'organization_type',country,market,p_data->>'website',p_data->>'contact_email',p_data->>'contact_phone');
  insert into quizbox_competition.organization_members(sponsor_id,user_id,role) values(s,auth.uid(),'sponsor_owner');
  return jsonb_build_object('sponsor_id',s);
 end if;
 if p_action='list_organizations' then
  return coalesce((select jsonb_agg(jsonb_build_object('sponsor_id',o.sponsor_id,'organization_name',s.organization_name,'organization_type',o.organization_type,'status',s.status,'market_id',o.market_id,'country_id',o.country_id,'role',m.role))
   from quizbox_competition.sponsor_organizations o join public.sponsor_profiles s on s.id=o.sponsor_id left join quizbox_competition.organization_members m on m.sponsor_id=o.sponsor_id and m.user_id=auth.uid() and m.active
   where m.user_id is not null and quizbox_market.market_allowed(o.market_id) or quizbox_market.is_super()),'[]');
 end if;
 role_name:=quizbox_competition.require_member(p_sponsor,p_action not in ('organization','list_drafts','draft','documents','source_detail','jobs','generation_sources'),p_action in ('edit_organization','member','sponsor_status'));
 if p_action='organization' then
  select to_jsonb(o)||jsonb_build_object('organization_name',s.organization_name,'contact_name',s.contact_name,'status',s.status,'role',role_name,
  'members',coalesce((select jsonb_agg(to_jsonb(m)) from quizbox_competition.organization_members m where m.sponsor_id=o.sponsor_id),'[]')) into result
  from quizbox_competition.sponsor_organizations o join public.sponsor_profiles s on s.id=o.sponsor_id where o.sponsor_id=p_sponsor;
  return result;
 elsif p_action='edit_organization' then
  if nullif(btrim(p_data->>'organization_name'),'') is null or nullif(btrim(p_data->>'contact_email'),'') is null then raise exception 'ORGANIZATION_FIELDS_REQUIRED'; end if;
  update public.sponsor_profiles set organization_name=p_data->>'organization_name',contact_name=p_data->>'contact_name',updated_at=now() where id=p_sponsor;
  update quizbox_competition.sponsor_organizations set website=p_data->>'website',contact_email=p_data->>'contact_email',contact_phone=p_data->>'contact_phone',updated_at=now() where sponsor_id=p_sponsor;
  return jsonb_build_object('saved',true);
 elsif p_action='sponsor_status' then
  if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_data->>'status' not in ('pending','active','suspended','archived') then raise exception 'INVALID_SPONSOR_STATUS'; end if;
  update public.sponsor_profiles set status=upper(p_data->>'status'),updated_at=now() where id=p_sponsor;
  return jsonb_build_object('saved',true);
 elsif p_action='member' then
  -- Serialize membership changes so concurrent removals cannot remove all owners.
  perform 1 from quizbox_competition.sponsor_organizations where sponsor_id=p_sponsor for update;
  member_id:=(p_data->>'user_id')::uuid;
  if p_data->>'role' not in ('sponsor_owner','sponsor_admin','sponsor_editor','sponsor_viewer') then raise exception 'INVALID_SPONSOR_ROLE'; end if;
  if role_name='sponsor_admin' and (p_data->>'role'='sponsor_owner' or exists(select 1 from quizbox_competition.organization_members where sponsor_id=p_sponsor and user_id=member_id and role='sponsor_owner')) then raise exception 'OWNER_MANAGEMENT_REQUIRED' using errcode='42501'; end if;
  if exists(select 1 from quizbox_competition.organization_members where sponsor_id=p_sponsor and user_id=member_id and role='sponsor_owner' and active)
  and (p_data->>'role'<>'sponsor_owner' or not coalesce((p_data->>'active')::boolean,true))
  and not exists(select 1 from quizbox_competition.organization_members where sponsor_id=p_sponsor and user_id<>member_id and role='sponsor_owner' and active) then raise exception 'LAST_OWNER_REQUIRED'; end if;
  if not exists(select 1 from public.profiles where id=member_id and lower(status::text)='active') then raise exception 'ACTIVE_MEMBER_REQUIRED'; end if;
  insert into quizbox_competition.organization_members(sponsor_id,user_id,role,active) values(p_sponsor,member_id,p_data->>'role',coalesce((p_data->>'active')::boolean,true))
  on conflict(sponsor_id,user_id) do update set role=excluded.role,active=excluded.active,updated_at=now();
  return jsonb_build_object('saved',true);
 elsif p_action='list_drafts' then
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.updated_at desc) from quizbox_competition.drafts x where sponsor_id=p_sponsor),'[]');
 elsif p_action='save_draft' then
  config:=p_data->'configuration'; c:=nullif(p_data->>'competition_id','')::uuid;
  if jsonb_typeof(config)<>'object' or nullif(btrim(config->>'title'),'') is null then raise exception 'COMPETITION_TITLE_REQUIRED'; end if;
  if c is null then
   insert into public.competitions(sponsor_id,title,description,created_by,status) values(p_sponsor,config->>'title',config->>'description',auth.uid(),'DRAFT') returning id into c;
   insert into quizbox_competition.drafts(competition_id,sponsor_id,created_by,configuration) values(c,p_sponsor,auth.uid(),config) returning to_jsonb(drafts.*) into result;
  else
   if exists(select 1 from quizbox_competition.snapshots where competition_id=c) then raise exception 'COMPETITION_FROZEN'; end if;
   expected:=(p_data->>'revision')::integer;
   update quizbox_competition.drafts set configuration=config,revision=revision+1,updated_at=now() where competition_id=c and sponsor_id=p_sponsor and revision=expected returning to_jsonb(drafts.*) into result;
   if result is null then raise exception 'DRAFT_CONFLICT_OR_ACCESS_DENIED'; end if;
   update public.competitions set title=config->>'title',description=config->>'description',updated_at=now() where id=c and sponsor_id=p_sponsor;
  end if;
  return result;
 end if;
 c:=(p_data->>'competition_id')::uuid;
 if not exists(select 1 from quizbox_competition.drafts where competition_id=c and sponsor_id=p_sponsor) then raise exception 'COMPETITION_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='draft' then return (select to_jsonb(x) from quizbox_competition.drafts x where competition_id=c);
 elsif p_action='documents' then
  return coalesce((select jsonb_agg((to_jsonb(doc)-'extraction_token')||jsonb_build_object('title',src.title,'approval_status',src.validation_status)) from quizbox_competition.documents doc join public.source_documents src on src.id=doc.id where doc.competition_id=c),'[]');
 elsif p_action='jobs' then
  return coalesce((select jsonb_agg(to_jsonb(j)-'execution_token' order by created_at desc) from quizbox_competition.generation_jobs j where competition_id=c),'[]');
 end if;
 if p_action<>'source_detail' and exists(select 1 from quizbox_competition.snapshots where competition_id=c) then raise exception 'COMPETITION_FROZEN'; end if;
 if p_action='queue_generation' then
  spec:=p_data->'spec';
  if jsonb_typeof(spec)<>'object' or nullif(spec->>'provider','') is null or nullif(spec->>'model','') is null or (spec->>'count')::integer not between 1 and 500 then raise exception 'INVALID_GENERATION_INPUT'; end if;
  if not exists(select 1 from public.sponsor_profiles where id=p_sponsor and lower(status)='active') then raise exception 'SPONSOR_NOT_ACTIVE'; end if;
  select array_agg(x::uuid) into source_ids from jsonb_array_elements_text(spec->'sourceIds') x;
  select coalesce(array_agg(x::uuid),'{}') into market_ids from jsonb_array_elements_text(spec->'marketIds') x;
  validated:=quizbox_market.validate_context(spec->>'scope',spec->>'sourceMode',market_ids,source_ids);
  if exists(select 1 from public.source_documents src where src.id=any(source_ids) and src.source_kind='SPONSOR_SOURCE' and (src.sponsor_id is distinct from p_sponsor or not exists(select 1 from quizbox_competition.documents doc where doc.id=src.id and doc.competition_id=c and doc.ingestion_status='READY_FOR_GENERATION' and doc.active))) then raise exception 'SOURCE_NOT_READY_OR_NOT_OWNED'; end if;
  insert into quizbox_competition.generation_jobs(competition_id,created_by,input_snapshot,provider,model,requested_count,request_key)
  values(c,auth.uid(),spec||jsonb_build_object('competitionId',c,'sponsorId',p_sponsor,'authorizedContext',validated),spec->>'provider',spec->>'model',(spec->>'count')::integer,(p_data->>'request_key')::uuid)
  on conflict(competition_id,request_key) do nothing returning id into job;
  if job is null then select id into job from quizbox_competition.generation_jobs where competition_id=c and request_key=(p_data->>'request_key')::uuid; end if;
  return jsonb_build_object('id',job);
 elsif p_action in ('claim_generation','generation_sources','finish_generation','fail_generation','cancel_generation') then
  job:=(p_data->>'job_id')::uuid;
  select * into job_row from quizbox_competition.generation_jobs where id=job and competition_id=c for update;
  if job_row.id is null then raise exception 'GENERATION_ACCESS_DENIED' using errcode='42501'; end if;
  if p_action='cancel_generation' then
   if job_row.status not in ('QUEUED','PROCESSING') then raise exception 'INVALID_GENERATION_TRANSITION'; end if;
   update quizbox_competition.generation_jobs set status='CANCELLED',execution_token=null,completed_at=now() where id=job;
   return jsonb_build_object('cancelled',true);
  elsif p_action='claim_generation' then
   if job_row.status<>'QUEUED' then raise exception 'GENERATION_NOT_CLAIMABLE'; end if;
   token:=gen_random_uuid(); update quizbox_competition.generation_jobs set status='PROCESSING',execution_token=token,started_at=now() where id=job;
   return jsonb_build_object('token',token,'input',job_row.input_snapshot,'provider',job_row.provider,'model',job_row.model);
  end if;
  if job_row.status<>'PROCESSING' or job_row.execution_token is distinct from (p_data->>'token')::uuid then raise exception 'GENERATION_CLAIM_MISMATCH'; end if;
  spec:=job_row.input_snapshot;
  if p_action='generation_sources' then
   select array_agg(x::uuid) into source_ids from jsonb_array_elements_text(spec->'sourceIds') x;
   select coalesce(array_agg(x::uuid),'{}') into market_ids from jsonb_array_elements_text(spec->'marketIds') x;
   perform quizbox_market.validate_context(spec->>'scope',spec->>'sourceMode',market_ids,source_ids);
   if not exists(select 1 from public.sponsor_profiles where id=p_sponsor and lower(status)='active') then raise exception 'SPONSOR_NOT_ACTIVE'; end if;
   if exists(select 1 from public.source_documents src where src.id=any(source_ids) and src.source_kind='SPONSOR_SOURCE' and (src.sponsor_id is distinct from p_sponsor or not exists(select 1 from quizbox_competition.documents doc where doc.id=src.id and doc.competition_id=c and doc.ingestion_status='READY_FOR_GENERATION' and doc.active))) then raise exception 'SOURCE_NOT_READY_OR_NOT_OWNED'; end if;
   return jsonb_build_object('input',spec,'actor',jsonb_build_object('userId',auth.uid(),'sponsorId',p_sponsor,'role',case when role_name='super_admin' then 'sponsor_admin' else role_name end,'marketIds',market_ids),'sources',coalesce((select jsonb_agg(jsonb_build_object('id',src.id,'kind',case src.source_kind when 'CURRICULUM' then 'curriculum' when 'SPONSOR_SOURCE' then 'sponsor_document' else 'harmonized_concept_pack' end,'market_id',src.market_id,'curriculum_id',src.curriculum_id,'authority_id',src.authority_id,'active',true,'validation_status',src.validation_status)) from public.source_documents src where src.id=any(source_ids)),'[]'),
   'chunks',coalesce((select jsonb_agg(jsonb_build_object('id',ch.id,'documentId',ch.document_id,'text',ch.source_text,'order',ch.position,'page',ch.page,'chapter',ch.chapter,'section',ch.section,'heading',ch.heading)) from quizbox_competition.chunks ch where ch.document_id=any(source_ids)),'[]'));
  elsif p_action='fail_generation' then
   update quizbox_competition.generation_jobs set status='FAILED',error_code='GENERATION_FAILED',execution_token=null,completed_at=now() where id=job;
   return jsonb_build_object('failed',true);
  elsif p_action='finish_generation' then
   if jsonb_typeof(p_data->'candidates')<>'array' or jsonb_array_length(p_data->'candidates')>job_row.requested_count
   or exists(select 1 from jsonb_array_elements(p_data->'candidates') x where x->>'competitionId'<>c::text or x->>'jobId'<>job::text or nullif(btrim(x->>'stem'),'') is null or nullif(btrim(x->>'explanation'),'') is null
    or not exists(select 1 from quizbox_competition.chunks ch join quizbox_competition.documents doc on doc.id=ch.document_id where ch.id=(x->>'sourceChunkId')::uuid and ch.document_id=(x->>'sourceDocumentId')::uuid and doc.competition_id=c and spec->'sourceIds' @> jsonb_build_array(ch.document_id))) then raise exception 'INVALID_GENERATION_OUTPUT'; end if;
   insert into quizbox_competition.candidates(id,competition_id,job_id,source_document_id,source_chunk_id,market_id,curriculum_id,payload,status)
   select (x->>'id')::uuid,c,job,(x->>'sourceDocumentId')::uuid,(x->>'sourceChunkId')::uuid,
   (select src.market_id from public.source_documents src where src.id=(x->>'sourceDocumentId')::uuid),nullif(x->>'curriculumId','')::uuid,
   (x-'status'-'approvedVersionId')||jsonb_build_object('status','GENERATED','approvedVersionId',null),'GENERATED' from jsonb_array_elements(p_data->'candidates') x;
   state:=case when jsonb_array_length(p_data->'candidates')=job_row.requested_count then 'COMPLETED' when jsonb_array_length(p_data->'candidates')>0 then 'PARTIAL' else 'FAILED' end;
   update quizbox_competition.generation_jobs set status=state,completed_at=now(),execution_token=null where id=job;
   return jsonb_build_object('status',state,'candidate_ids',coalesce((select jsonb_agg(id) from quizbox_competition.candidates where job_id=job),'[]'));
  end if;
 end if;
 if p_action='register_source' then
  market:=nullif(p_data->>'market_id','')::uuid;
  if market is not null and not quizbox_market.market_allowed(market) then raise exception 'MARKET_ACCESS_DENIED' using errcode='42501'; end if;
  if nullif(btrim(p_data->>'title'),'') is null or (p_data->>'checksum') !~ '^[0-9a-f]{64}$' or not coalesce((p_data->>'rights_confirmed')::boolean,false) or p_data->>'mime_type' not in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain') then raise exception 'INVALID_SOURCE_UPLOAD'; end if;
  d:=gen_random_uuid();
  insert into public.source_documents(id,uploaded_by,title,checksum,mime_type,rights_confirmed,sponsor_id,market_id,source_kind,validation_status,storage_bucket,storage_path,metadata)
  values(d,auth.uid(),p_data->>'title',p_data->>'checksum',p_data->>'mime_type',true,p_sponsor,market,'SPONSOR_SOURCE','review','competition-sources',p_sponsor::text||'/'||c::text||'/'||d::text,jsonb_build_object('competition_id',c));
  insert into quizbox_competition.documents(id,competition_id,version,checksum,author,publisher) values(d,c,1,p_data->>'checksum',p_data->>'author',p_data->>'publisher');
  return jsonb_build_object('id',d,'bucket','competition-sources','path',p_sponsor::text||'/'||c::text||'/'||d::text);
 end if;
 d:=(p_data->>'document_id')::uuid;
 select s.* into source from public.source_documents s join quizbox_competition.documents x on x.id=s.id where x.id=d and x.competition_id=c;
 if source.id is null then raise exception 'SOURCE_ACCESS_DENIED' using errcode='42501'; end if;
 if source.market_id is not null and not quizbox_market.market_allowed(source.market_id) then raise exception 'SOURCE_MARKET_ACCESS_DENIED' using errcode='42501'; end if;
 if p_action='source_detail' then
  return jsonb_build_object('id',d,'bucket',source.storage_bucket,'path',source.storage_path,'mime_type',source.mime_type,'checksum',source.checksum,'chunks',coalesce((select jsonb_agg(to_jsonb(x) order by position) from quizbox_competition.chunks x where document_id=d),'[]'));
 elsif p_action='fail_upload' then
  update quizbox_competition.documents set ingestion_status='FAILED',error_code='SOURCE_UPLOAD_FAILED',updated_at=now() where id=d and ingestion_status='UPLOADED';
  get diagnostics changed=row_count; if changed<>1 then raise exception 'UPLOAD_STATE_MISMATCH'; end if;
  return jsonb_build_object('failed',true);
 elsif p_action='retry_upload' then
  update quizbox_competition.documents set ingestion_status='UPLOADED',error_code=null,updated_at=now() where id=d and ingestion_status='FAILED' and error_code='SOURCE_UPLOAD_FAILED';
  get diagnostics changed=row_count; if changed<>1 then raise exception 'UPLOAD_NOT_RETRYABLE'; end if;
  return jsonb_build_object('id',d,'bucket',source.storage_bucket,'path',source.storage_path);
 elsif p_action='claim_extraction' then
  token:=gen_random_uuid();
  update quizbox_competition.documents set ingestion_status='PROCESSING',extraction_token=token,extraction_started_at=now(),error_code=null,updated_at=now()
  where id=d and (ingestion_status in ('UPLOADED','FAILED') or ingestion_status='PROCESSING' and extraction_started_at<now()-interval '10 minutes') returning id into s;
  if s is null then raise exception 'EXTRACTION_NOT_CLAIMABLE'; end if;
  return jsonb_build_object('token',token);
 elsif p_action='fail_extraction' then
  update quizbox_competition.documents set ingestion_status='FAILED',error_code='SOURCE_EXTRACTION_FAILED',extraction_token=null,updated_at=now() where id=d and extraction_token=(p_data->>'token')::uuid and ingestion_status='PROCESSING';
  get diagnostics changed=row_count; if changed<>1 then raise exception 'EXTRACTION_CLAIM_MISMATCH'; end if;
  return jsonb_build_object('failed',true);
 elsif p_action='finish_extraction' then
  perform 1 from quizbox_competition.documents where id=d and extraction_token=(p_data->>'token')::uuid and ingestion_status='PROCESSING' for update;
  if not found then raise exception 'EXTRACTION_CLAIM_MISMATCH'; end if;
  if jsonb_typeof(p_data->'chunks')<>'array' or jsonb_array_length(p_data->'chunks') not between 1 and 300 or exists(select 1 from jsonb_array_elements(p_data->'chunks') x where nullif(btrim(x->>'text'),'') is null or length(x->>'text')>4000 or x->>'documentId'<>d::text or (x->>'checksum') !~ '^[0-9a-f]{64}$') then raise exception 'INVALID_SOURCE_CHUNKS'; end if;
  insert into quizbox_competition.chunks(id,document_id,position,source_text,page,chapter,section,heading,checksum)
  select (x->>'id')::uuid,d,(x->>'order')::integer,x->>'text',(x->>'page')::integer,x->>'chapter',x->>'section',x->>'heading',x->>'checksum' from jsonb_array_elements(p_data->'chunks') x;
  update public.source_documents set content_text=(select string_agg(source_text,E'\n\n' order by position) from quizbox_competition.chunks where document_id=d),status='EXTRACTED',updated_at=now() where id=d;
  update quizbox_competition.documents set ingestion_status='READY_FOR_GENERATION',extraction_token=null,updated_at=now() where id=d;
  return jsonb_build_object('extracted',true,'approval_status','review');
 end if;
 raise exception 'UNKNOWN_SPONSOR_ACTION';
end $$;

create function public.qb_sponsor_workspace(p_action text,p_sponsor uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select quizbox_competition.dispatch(p_action,p_sponsor,p_data); $$;
revoke all on function quizbox_competition.require_member(uuid,boolean,boolean) from public,anon,authenticated;
revoke all on function quizbox_competition.dispatch(text,uuid,jsonb) from public,anon;
revoke all on function public.qb_sponsor_workspace(text,uuid,jsonb) from public,anon;
grant usage on schema quizbox_competition to authenticated;
grant execute on function quizbox_competition.dispatch(text,uuid,jsonb) to authenticated;
grant execute on function public.qb_sponsor_workspace(text,uuid,jsonb) to authenticated;

create function quizbox_competition.managed_source_access(p_sponsor uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin perform quizbox_competition.require_member(p_sponsor,false); return true;
exception when insufficient_privilege then return false;
end $$;
revoke all on function quizbox_competition.managed_source_access(uuid) from public,anon,authenticated;
-- Managed organizations use current membership, not the legacy uploader/login
-- pointer. Unmanaged Ghana sponsors retain their existing ownership rules.
create or replace function quizbox_market.document_owned(p_document uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.source_documents d where d.id=p_document and (quizbox_market.is_super() or
 case when d.source_kind='SPONSOR_SOURCE' and exists(select 1 from quizbox_competition.sponsor_organizations o where o.sponsor_id=d.sponsor_id)
 then quizbox_competition.managed_source_access(d.sponsor_id)
 else d.uploaded_by=auth.uid()
 or exists(select 1 from public.sponsor_profiles s where s.id=d.sponsor_id and s.user_id=auth.uid())
 or (d.source_kind<>'SPONSOR_SOURCE' and d.sponsor_id is null and d.tenant_id is null)
 or (d.source_kind<>'SPONSOR_SOURCE' and public.qb_is_tenant_member(d.tenant_id)) end));
$$;
revoke all on function quizbox_market.document_owned(uuid) from public,anon,authenticated;

-- Dedicated private bucket. Object access is tied to a registered source and
-- active organization membership; upload replacement and public reads are denied.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('competition-sources','competition-sources',false,10485760,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain']);
create function quizbox_competition.storage_access(p_path text,p_write boolean) returns boolean language plpgsql stable security definer set search_path='' as $$
declare sponsor uuid; state text;
begin
 select d.sponsor_id,x.ingestion_status into sponsor,state from public.source_documents s join quizbox_competition.documents x on x.id=s.id join quizbox_competition.drafts d on d.competition_id=x.competition_id
 where s.storage_bucket='competition-sources' and s.storage_path=p_path;
 if sponsor is null then return false; end if;
 perform quizbox_competition.require_member(sponsor,p_write);
 return not p_write or state='UPLOADED';
exception when insufficient_privilege then return false;
end $$;
revoke all on function quizbox_competition.storage_access(text,boolean) from public,anon;
grant execute on function quizbox_competition.storage_access(text,boolean) to authenticated;
create policy competition_source_read on storage.objects for select to authenticated using(bucket_id='competition-sources' and quizbox_competition.storage_access(name,false));
create policy competition_source_insert on storage.objects for insert to authenticated with check(bucket_id='competition-sources' and quizbox_competition.storage_access(name,true));
commit;
