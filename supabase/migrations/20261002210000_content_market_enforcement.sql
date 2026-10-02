begin;

-- Requires the market/SME foundation. No provider, payment or answer changes.
create schema quizbox_market;
revoke all on schema quizbox_market from public,anon,authenticated;
create table public.curriculum_authorities (
 id uuid primary key default gen_random_uuid(), market_id uuid not null references public.markets(id),
 code text not null, name text not null, active boolean not null default true, unique(market_id,code)
);
create table public.market_curricula (
 curriculum_id uuid primary key references public.curricula(id), market_id uuid not null references public.markets(id),
 authority_id uuid references public.curriculum_authorities(id), active boolean not null default true
);
create table public.user_market_memberships (
 user_id uuid not null references public.profiles(id), market_id uuid not null references public.markets(id),
 active boolean not null default true, primary key(user_id,market_id)
);
create table public.content_contexts (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references public.profiles(id),
 scope text not null check(scope in ('LOCAL_MARKET','MULTI_MARKET','GLOBAL')),
 source_mode text not null check(source_mode in ('CURRICULUM_ALIGNED','SPONSOR_SOURCE','HYBRID')),
 market_ids uuid[] not null, source_document_ids uuid[] not null,
 check(cardinality(source_document_ids) between 1 and 100),
 check((scope='LOCAL_MARKET' and cardinality(market_ids)=1) or (scope='MULTI_MARKET' and cardinality(market_ids) between 2 and 100) or (scope='GLOBAL' and cardinality(market_ids)=0))
);
alter table public.profiles add column default_market_id uuid references public.markets(id);
alter table public.profiles add column active_content_context_id uuid references public.content_contexts(id);
alter table public.source_documents add column market_id uuid references public.markets(id);
alter table public.source_documents add column curriculum_id uuid references public.curricula(id);
alter table public.source_documents add column authority_id uuid references public.curriculum_authorities(id);
alter table public.source_documents add column sponsor_id uuid references public.sponsor_profiles(id);
alter table public.source_documents add column source_kind text not null default 'CURRICULUM' check(source_kind in ('CURRICULUM','SPONSOR_SOURCE','HARMONIZED_PACK'));
alter table public.source_documents add column validation_status text not null default 'review' check(validation_status in ('review','approved','rejected'));
alter table public.source_documents add column approved_by uuid references public.profiles(id);
alter table public.source_documents add column content_text text;
alter table public.questions add column source_document_ids uuid[] not null default '{}';
alter table public.question_banks add column market_id uuid references public.markets(id);
alter table public.competitions add column content_context_id uuid references public.content_contexts(id);
alter table public.content_import_batches add column content_context jsonb;
alter table public.attempts add column content_context jsonb;
create table public.harmonized_concept_mappings (
 source_document_id uuid not null references public.source_documents(id), node_id uuid not null references public.curriculum_nodes(id),
 concept_key text not null, approved boolean not null default false, primary key(source_document_id,node_id,concept_key)
);
create table public.legacy_content_attributions (
 question_id uuid primary key references public.questions(id), curriculum_id uuid not null references public.curricula(id),
 market_id uuid not null references public.markets(id), reason text not null
);
create table public.market_attribution_issues (
 entity text not null, record_id uuid not null, reason text not null, primary key(entity,record_id)
);

-- The only Ghana literals are compatibility data, not shared-service branches.
insert into public.curriculum_authorities(market_id,code,name)
 select m.id,'NaCCA','National Council for Curriculum and Assessment' from public.markets m join public.countries c on c.id=m.country_id where c.iso2_code='GH';
insert into public.market_curricula(curriculum_id,market_id,authority_id)
 select c.id,c.market_id,a.id from public.curricula c left join public.curriculum_authorities a on a.market_id=c.market_id and a.code='NaCCA' and c.code='GH-CCP-2020' where c.market_id is not null;
insert into public.user_market_memberships(user_id,market_id)
 select distinct p.id,m.id from public.profiles p join public.countries c on lower(trim(p.country)) in (lower(c.name),lower(c.iso2_code),lower(c.iso3_code)) join public.markets m on m.country_id=c.id
 union select distinct tm.user_id,t.market_id from public.tenant_memberships tm join public.tenants t on t.id=tm.tenant_id where lower(tm.status::text)='active' and t.market_id is not null;
do $$ declare t text; begin
 foreach t in array array['student_profiles','teacher_profiles','sponsor_profiles'] loop
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name=t and column_name='country') then
   execute format('insert into public.user_market_memberships(user_id,market_id) select distinct r.user_id,m.id from public.%I r join public.profiles p on p.id=r.user_id join public.countries c on lower(trim(r.country)) in (lower(c.name),lower(c.iso2_code),lower(c.iso3_code)) join public.markets m on m.country_id=c.id on conflict(user_id,market_id) do nothing',t);
  end if;
 end loop;
end $$;
update public.profiles p set default_market_id=x.market_id from (select user_id,(array_agg(market_id))[1] market_id from public.user_market_memberships group by user_id having count(*)=1) x where p.id=x.user_id;
insert into public.legacy_content_attributions
 select q.id,q.curriculum_id,mc.market_id,'Existing question and node agree with explicitly country-attributed curriculum'
 from public.questions q join public.curriculum_nodes n on n.id=q.curriculum_node_id and n.curriculum_id=q.curriculum_id join public.market_curricula mc on mc.curriculum_id=q.curriculum_id;
update public.source_documents d set market_id=t.market_id from public.tenants t where d.tenant_id=t.id and t.market_id is not null;
update public.question_banks b set market_id=t.market_id from public.tenants t where b.tenant_id=t.id and t.market_id is not null;
update public.question_banks b set market_id=x.market_id from (select i.bank_id,(array_agg(distinct l.market_id))[1] market_id from public.question_bank_items i join public.legacy_content_attributions l on l.question_id=i.question_id group by i.bank_id having count(distinct l.market_id)=1) x where b.id=x.bank_id and b.market_id is null;
insert into public.market_attribution_issues select 'profile',id,'No unambiguous default market' from public.profiles where default_market_id is null;
insert into public.market_attribution_issues select 'curriculum',c.id,'Market or authority requires provenance review' from public.curricula c left join public.market_curricula m on m.curriculum_id=c.id where m.authority_id is null;
insert into public.market_attribution_issues select 'question',q.id,'No agreeing country-attributed curriculum/node' from public.questions q where not exists(select 1 from public.legacy_content_attributions l where l.question_id=q.id);
insert into public.market_attribution_issues select 'source_document',id,'Source requires explicit authority, rights and approval review' from public.source_documents;
insert into public.market_attribution_issues select 'question_bank',id,'No unambiguous content market' from public.question_banks where market_id is null;

create function quizbox_market.is_super() returns boolean language sql stable security definer set search_path='' as $$ select quizbox_sme.has_capability('super_admin'); $$;
create function quizbox_market.market_allowed(p_market uuid,p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=p_user and lower(p.status::text)='active') and exists(select 1 from public.markets m join public.countries c on c.id=m.country_id where m.id=p_market and m.active and c.active
 and ((p_user=auth.uid() and quizbox_market.is_super()) or exists(select 1 from public.user_market_memberships u where u.user_id=p_user and u.market_id=m.id and u.active)));
$$;
create function quizbox_market.document_owned(p_document uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.source_documents d where d.id=p_document and (quizbox_market.is_super() or d.uploaded_by=auth.uid()
 or exists(select 1 from public.sponsor_profiles s where s.id=d.sponsor_id and s.user_id=auth.uid())
 or (d.source_kind<>'SPONSOR_SOURCE' and d.sponsor_id is null and d.tenant_id is null)
 or (d.source_kind<>'SPONSOR_SOURCE' and public.qb_is_tenant_member(d.tenant_id))));
$$;
create function quizbox_market.validate_context(p_scope text,p_mode text,p_markets uuid[],p_sources uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare docs jsonb; total integer; curricula boolean; sponsor boolean;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') or p_scope is null or p_mode is null or p_markets is null or p_sources is null
 or p_scope not in ('LOCAL_MARKET','MULTI_MARKET','GLOBAL') or p_mode not in ('CURRICULUM_ALIGNED','SPONSOR_SOURCE','HYBRID')
 or cardinality(p_sources) not between 1 and 100
 or (p_scope='LOCAL_MARKET' and cardinality(p_markets)<>1) or (p_scope='MULTI_MARKET' and cardinality(p_markets) not between 2 and 100) or (p_scope='GLOBAL' and cardinality(p_markets)<>0)
 then raise exception 'QB_EXPLICIT_CONTENT_CONTEXT_REQUIRED' using errcode='42501'; end if;
 if cardinality(p_sources)<>(select count(distinct v) from unnest(p_sources) v) or cardinality(p_markets)<>(select count(distinct v) from unnest(p_markets) v) then raise exception 'QB_DUPLICATE_CONTEXT_SELECTION'; end if;
 if exists(select 1 from unnest(p_markets) m where not quizbox_market.market_allowed(m)) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if;
 select count(*),bool_or(d.source_kind in ('CURRICULUM','HARMONIZED_PACK')),bool_or(d.source_kind='SPONSOR_SOURCE'),jsonb_agg(jsonb_build_object('id',d.id,'checksum',d.checksum,'kind',d.source_kind,'market_id',d.market_id,'curriculum_id',d.curriculum_id,'authority_id',d.authority_id))
 into total,curricula,sponsor,docs from public.source_documents d where d.id=any(p_sources) and d.validation_status='approved' and d.approved_by is not null and d.rights_confirmed and nullif(d.checksum,'') is not null
 and quizbox_market.document_owned(d.id)
 and (d.market_id is null or quizbox_market.market_allowed(d.market_id))
 and (p_scope='GLOBAL' or d.market_id=any(p_markets))
 and (p_scope<>'GLOBAL' or d.source_kind in ('SPONSOR_SOURCE','HARMONIZED_PACK'))
 and (d.source_kind<>'CURRICULUM' or exists(select 1 from public.market_curricula mc join public.curriculum_authorities a on a.id=mc.authority_id where mc.curriculum_id=d.curriculum_id and mc.market_id=d.market_id and mc.authority_id=d.authority_id and a.market_id=mc.market_id and mc.active and a.active));
 if total<>cardinality(p_sources) then raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'; end if;
 if (p_mode='CURRICULUM_ALIGNED' and (not curricula or sponsor)) or (p_mode='SPONSOR_SOURCE' and (not sponsor or curricula)) or (p_mode='HYBRID' and (not sponsor or not curricula)) then raise exception 'QB_SOURCE_MODE_MISMATCH'; end if;
 return jsonb_build_object('scope',p_scope,'source_mode',p_mode,'market_ids',to_jsonb(p_markets),'source_document_ids',to_jsonb(p_sources),'provenance',docs);
end $$;
create function quizbox_market.resolve_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; c public.content_contexts; m public.markets;
begin
 select * into p from public.profiles where id=auth.uid() and lower(status::text)='active';
 if p.id is null then raise exception 'QB_CONTENT_AUTH_REQUIRED' using errcode='42501'; end if;
 if p.active_content_context_id is not null then
  select * into c from public.content_contexts where id=p.active_content_context_id and owner_user_id=p.id;
  if c.id is null then raise exception 'QB_CONTENT_CONTEXT_DENIED' using errcode='42501'; end if;
  return quizbox_market.validate_context(c.scope,c.source_mode,c.market_ids,c.source_document_ids)||jsonb_build_object('context_id',c.id);
 end if;
 if not quizbox_market.market_allowed(p.default_market_id) then raise exception 'QB_CONTENT_MARKET_REQUIRED' using errcode='42501'; end if;
 select * into m from public.markets where id=p.default_market_id;
 return jsonb_build_object('scope','LOCAL_MARKET','source_mode','CURRICULUM_ALIGNED','market_ids',jsonb_build_array(m.id),'country_id',m.country_id,'locale',m.locale,'timezone',m.timezone,'source_document_ids','[]'::jsonb);
end $$;
create function quizbox_market.curriculum_allowed(p_curriculum uuid,p_context jsonb default null) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=coalesce(p_context,quizbox_market.resolve_context());
 return exists(select 1 from public.market_curricula mc where mc.curriculum_id=p_curriculum and mc.active and c->'market_ids' @> jsonb_build_array(mc.market_id)
 and (jsonb_array_length(c->'source_document_ids')=0 or c->>'source_mode'='SPONSOR_SOURCE' or exists(select 1 from public.source_documents d where c->'source_document_ids' @> jsonb_build_array(d.id) and d.curriculum_id=mc.curriculum_id and d.source_kind='CURRICULUM')));
exception when sqlstate '42501' then return false;
end $$;
create function quizbox_market.node_allowed(p_node uuid,p_context jsonb default null) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.curriculum_nodes n where n.id=p_node and n.is_active and (quizbox_market.curriculum_allowed(n.curriculum_id,p_context)
 or exists(select 1 from public.harmonized_concept_mappings h where h.node_id=n.id and h.approved and coalesce(p_context,quizbox_market.resolve_context())->'source_document_ids' @> jsonb_build_array(h.source_document_id))));
$$;
create function quizbox_market.question_allowed(p_question uuid,p_context jsonb default null) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c jsonb; q public.questions;
begin
 c:=coalesce(p_context,quizbox_market.resolve_context()); select * into q from public.questions where id=p_question;
 if q.id is null then return false; end if;
 if cardinality(q.source_document_ids)>0 then
  if jsonb_array_length(c->'source_document_ids')=0 then
   return quizbox_market.curriculum_allowed(q.curriculum_id,c) and not exists(select 1 from unnest(q.source_document_ids) s left join public.source_documents d on d.id=s where d.id is null or d.validation_status<>'approved' or d.source_kind<>'CURRICULUM' or d.curriculum_id is distinct from q.curriculum_id or not quizbox_market.document_owned(d.id));
  end if;
  return c->'source_document_ids' @> to_jsonb(q.source_document_ids) and quizbox_market.node_allowed(q.curriculum_node_id,c);
 end if;
 return jsonb_array_length(c->'source_document_ids')=0 and exists(select 1 from public.legacy_content_attributions l where l.question_id=q.id and l.curriculum_id=q.curriculum_id) and quizbox_market.curriculum_allowed(q.curriculum_id,c);
exception when sqlstate '42501' then return false;
end $$;
create function quizbox_market.assert_question(p_question uuid) returns void language plpgsql stable security definer set search_path='' as $$
begin if not quizbox_market.question_allowed(p_question) then raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'; end if; end $$;
create function quizbox_market.assert_nodes(p_nodes uuid[]) returns void language plpgsql stable security definer set search_path='' as $$
begin if coalesce(cardinality(p_nodes),0) not between 1 and 100 or exists(select 1 from unnest(p_nodes) n where not coalesce(quizbox_market.node_allowed(n),false)) then raise exception 'QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT' using errcode='42501'; end if; end $$;
create function quizbox_market.scoped_filters(p_filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ids uuid[]; selected uuid;
begin
 if nullif(p_filters->>'curriculum','') is not null then selected:=(p_filters->>'curriculum')::uuid;
 else select array_agg(curriculum_id) into ids from public.market_curricula where quizbox_market.curriculum_allowed(curriculum_id); if cardinality(ids)=1 then selected:=ids[1]; end if; end if;
 if selected is null or not quizbox_market.curriculum_allowed(selected) then raise exception 'QB_EXPLICIT_CURRICULUM_REQUIRED' using errcode='42501'; end if;
 return coalesce(p_filters,'{}')||jsonb_build_object('curriculum',selected);
end $$;
create function quizbox_market.generation_context(p_spec jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb; sources uuid[]; n public.curriculum_nodes; bound public.content_contexts;
begin
 if nullif(p_spec->>'competitionId','') is not null then
  select cc.* into bound from public.competitions x join public.content_contexts cc on cc.id=x.content_context_id where x.id=(p_spec->>'competitionId')::uuid
  and (quizbox_market.is_super() or x.created_by=auth.uid() or exists(select 1 from public.sponsor_profiles s where s.id=x.sponsor_id and s.user_id=auth.uid()));
  if bound.id is null then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;
  c:=to_jsonb(bound);
  if p_spec->'sourceDocumentIds' is not null and not ((p_spec->'sourceDocumentIds') @> (c->'source_document_ids') and (c->'source_document_ids') @> (p_spec->'sourceDocumentIds')) then raise exception 'QB_COMPETITION_SOURCE_SET_MISMATCH' using errcode='42501'; end if;
 else c:=quizbox_market.resolve_context(); end if;
 select array_agg(v::uuid) into sources from jsonb_array_elements_text(coalesce(p_spec->'sourceDocumentIds',c->'source_document_ids')) v;
 c:=quizbox_market.validate_context(c->>'scope',c->>'source_mode',array(select v::uuid from jsonb_array_elements_text(c->'market_ids') v),coalesce(sources,'{}'));
 select * into n from public.curriculum_nodes where id=(p_spec->>'indicatorId')::uuid;
 if n.id is null or p_spec->>'curriculumId' is distinct from n.curriculum_id::text or not quizbox_market.node_allowed(n.id,c) then raise exception 'QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT' using errcode='42501'; end if;
 return p_spec||jsonb_build_object('content_context',c,'sourceDocumentIds',c->'source_document_ids','target_audience',jsonb_build_object('subject',n.subject_code,'source_grade',n.source_grade_code,'canonical_grade',n.canonical_grade_code,'education_level',n.education_level,'indicator',n.id,'curriculum',n.curriculum_id));
end $$;

create function public.qb_content_market_context() returns jsonb language sql stable security definer set search_path='' as $$ select quizbox_market.resolve_context(); $$;
create function public.qb_select_content_market(p_market uuid) returns void language plpgsql security definer set search_path='' as $$
begin if not quizbox_market.market_allowed(p_market) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if; update public.profiles set default_market_id=p_market,active_content_context_id=null where id=auth.uid(); end $$;
create function public.qb_create_content_context(p_scope text,p_source_mode text,p_markets uuid[],p_sources uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin perform quizbox_market.validate_context(p_scope,p_source_mode,p_markets,p_sources); insert into public.content_contexts(owner_user_id,scope,source_mode,market_ids,source_document_ids) values(auth.uid(),p_scope,p_source_mode,p_markets,p_sources) returning id into result; return result; end $$;
create function public.qb_activate_content_context(p_context uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.content_contexts;
begin select * into c from public.content_contexts where id=p_context and owner_user_id=auth.uid(); if c.id is null then raise exception 'QB_CONTENT_CONTEXT_DENIED' using errcode='42501'; end if; perform quizbox_market.validate_context(c.scope,c.source_mode,c.market_ids,c.source_document_ids); update public.profiles set active_content_context_id=c.id where id=auth.uid(); end $$;
create function public.qb_resolve_generation_sources(p_spec jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare spec jsonb; documents jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active' and upper(role::text) in ('OWNER','ADMIN','TEACHER','SPONSOR')) then raise exception 'QB_CONTENT_ACCESS_DENIED' using errcode='42501'; end if;
 spec:=quizbox_market.generation_context(p_spec);
 select jsonb_agg(jsonb_build_object('id',id,'title',title,'checksum',checksum,'kind',source_kind,'text',content_text)) into documents from public.source_documents where spec->'sourceDocumentIds' @> jsonb_build_array(id);
 if exists(select 1 from public.source_documents where spec->'sourceDocumentIds' @> jsonb_build_array(id) and nullif(trim(content_text),'') is null) then raise exception 'QB_SOURCE_TEXT_REQUIRED'; end if;
 return jsonb_build_object('spec',spec,'documents',documents);
end $$;
create function public.qb_list_content_markets() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'country_id',m.country_id,'locale',m.locale,'timezone',m.timezone) order by m.name),'[]') from public.markets m where quizbox_market.market_allowed(m.id);
$$;
create function public.qb_list_content_sources(p_curriculum uuid default null,p_scope text default null,p_markets uuid[] default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb; result jsonb;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then raise exception 'QB_CONTENT_AUTH_REQUIRED' using errcode='42501'; end if;
 if p_scope is null then c:=quizbox_market.resolve_context(); p_scope:=c->>'scope'; p_markets:=array(select v::uuid from jsonb_array_elements_text(c->'market_ids') v); end if;
 if p_markets is null or p_scope not in ('LOCAL_MARKET','MULTI_MARKET','GLOBAL') or (p_scope='LOCAL_MARKET' and cardinality(p_markets)<>1) or (p_scope='MULTI_MARKET' and cardinality(p_markets)<2) or (p_scope='GLOBAL' and cardinality(p_markets)<>0) or exists(select 1 from unnest(p_markets) m where not quizbox_market.market_allowed(m)) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'kind',d.source_kind,'market_id',d.market_id,'curriculum_id',d.curriculum_id,'checksum',d.checksum) order by d.title),'[]') into result
 from public.source_documents d where d.validation_status='approved' and d.rights_confirmed and quizbox_market.document_owned(d.id)
 and (p_scope='GLOBAL' and d.source_kind in ('SPONSOR_SOURCE','HARMONIZED_PACK') and (d.market_id is null or quizbox_market.market_allowed(d.market_id)) or p_scope<>'GLOBAL' and d.market_id=any(p_markets)) and (p_curriculum is null or d.curriculum_id=p_curriculum);
 return result;
end
$$;
create function public.qb_market_configure(p_entity text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; target uuid;
begin
 if not quizbox_market.is_super() then raise exception 'QB_MARKET_CONFIGURATION_DENIED' using errcode='42501'; end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'QB_INVALID_CONFIGURATION'; end if;
 if p_entity='curriculum_authorities' then
  insert into public.curriculum_authorities(id,market_id,code,name,active) values(coalesce((p_data->>'id')::uuid,gen_random_uuid()),(p_data->>'market_id')::uuid,p_data->>'code',p_data->>'name',coalesce((p_data->>'active')::boolean,true))
  on conflict(id) do update set market_id=excluded.market_id,code=excluded.code,name=excluded.name,active=excluded.active returning to_jsonb(curriculum_authorities.*) into result;
 elsif p_entity='market_curricula' then
  if not exists(select 1 from public.curricula where id=(p_data->>'curriculum_id')::uuid and market_id=(p_data->>'market_id')::uuid) or not exists(select 1 from public.curriculum_authorities where id=(p_data->>'authority_id')::uuid and market_id=(p_data->>'market_id')::uuid and active) then raise exception 'QB_CURRICULUM_AUTHORITY_MISMATCH'; end if;
  insert into public.market_curricula(curriculum_id,market_id,authority_id,active) values((p_data->>'curriculum_id')::uuid,(p_data->>'market_id')::uuid,(p_data->>'authority_id')::uuid,coalesce((p_data->>'active')::boolean,true))
  on conflict(curriculum_id) do update set market_id=excluded.market_id,authority_id=excluded.authority_id,active=excluded.active returning to_jsonb(market_curricula.*) into result;
 elsif p_entity='user_market_memberships' then
  insert into public.user_market_memberships(user_id,market_id,active) values((p_data->>'user_id')::uuid,(p_data->>'market_id')::uuid,coalesce((p_data->>'active')::boolean,true)) on conflict(user_id,market_id) do update set active=excluded.active returning to_jsonb(user_market_memberships.*) into result;
  if coalesce((p_data->>'make_default')::boolean,false) then update public.profiles set default_market_id=(p_data->>'market_id')::uuid,active_content_context_id=null where id=(p_data->>'user_id')::uuid; end if;
 elsif p_entity='source_documents' then
  target:=(p_data->>'id')::uuid;
  update public.source_documents set market_id=(p_data->>'market_id')::uuid,curriculum_id=(p_data->>'curriculum_id')::uuid,authority_id=(p_data->>'authority_id')::uuid,sponsor_id=(p_data->>'sponsor_id')::uuid,source_kind=p_data->>'source_kind',content_text=p_data->>'content_text',rights_confirmed=(p_data->>'rights_confirmed')::boolean,validation_status=p_data->>'validation_status',approved_by=case when p_data->>'validation_status'='approved' then auth.uid() else approved_by end where id=target returning to_jsonb(source_documents.*) into result;
  if result is null then raise exception 'QB_EXISTING_SOURCE_DOCUMENT_REQUIRED'; end if;
 else raise exception 'QB_INVALID_CONFIGURATION_ENTITY'; end if;
 return result;
end $$;

create function quizbox_market.competition_allowed(p_competition uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c public.content_contexts; x public.competitions;
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') then return false; end if;
 select * into x from public.competitions where id=p_competition;
 if x.id is null then return false; end if;
 if quizbox_market.is_super() or x.created_by=auth.uid() then return true; end if;
 select * into c from public.content_contexts where id=x.content_context_id;
 if c.id is null then return false; end if;
 return c.scope='GLOBAL' or exists(select 1 from unnest(c.market_ids) m where quizbox_market.market_allowed(m));
end $$;
create function public.qb_set_competition_content_context(p_competition uuid,p_context uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.content_contexts; x public.competitions;
begin
 select * into x from public.competitions where id=p_competition for update;
 if x.id is null or not (x.created_by=auth.uid() or quizbox_market.is_super() or exists(select 1 from public.sponsor_profiles s where s.id=x.sponsor_id and s.user_id=auth.uid())) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;
 if x.content_context_id is not null or exists(select 1 from public.attempts where assessment_id=x.assessment_id) then raise exception 'QB_COMPETITION_CONTEXT_LOCKED'; end if;
 select * into c from public.content_contexts where id=p_context and owner_user_id=auth.uid();
 if c.id is null then raise exception 'QB_CONTENT_CONTEXT_DENIED' using errcode='42501'; end if;
 perform quizbox_market.validate_context(c.scope,c.source_mode,c.market_ids,c.source_document_ids);
 update public.competitions set content_context_id=c.id where id=x.id;
end $$;
create function quizbox_market.assessment_context(p_assessment uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.content_contexts; result jsonb; contexts uuid[];
begin
 select array_agg(distinct x.content_context_id) filter(where x.content_context_id is not null and quizbox_market.competition_allowed(x.id)) into contexts from public.competitions x where x.assessment_id=p_assessment
 or exists(select 1 from public.competition_rounds r join public.competition_stages s on s.id=r.stage_id where s.competition_id=x.id and r.assessment_id=p_assessment);
 if contexts is null then
  if exists(select 1 from public.competitions x where x.assessment_id=p_assessment or exists(select 1 from public.competition_rounds r join public.competition_stages s on s.id=r.stage_id where s.competition_id=x.id and r.assessment_id=p_assessment)) then raise exception 'QB_COMPETITION_CONTEXT_DENIED' using errcode='42501'; end if;
  return quizbox_market.resolve_context();
 end if;
 if cardinality(contexts)<>1 then raise exception 'QB_AMBIGUOUS_COMPETITION_CONTEXT' using errcode='42501'; end if;
 select * into c from public.content_contexts where id=contexts[1];
 -- Participants receive only the explicitly bound approved question source set, not raw documents.
 if exists(select 1 from unnest(c.source_document_ids) s left join public.source_documents d on d.id=s where d.id is null or d.validation_status<>'approved' or not d.rights_confirmed) then raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'; end if;
 result:=to_jsonb(c); return result;
end $$;
create function quizbox_market.assessment_allowed(p_assessment uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin c:=quizbox_market.assessment_context(p_assessment);
 return exists(select 1 from public.assessment_questions where assessment_id=p_assessment) and not exists(select 1 from public.assessment_questions aq where aq.assessment_id=p_assessment and
 (not quizbox_market.question_allowed(aq.question_id,c) or
 (c->>'scope'='LOCAL_MARKET' and exists(select 1 from public.profiles where id=auth.uid() and upper(role::text)='STUDENT') and not exists(select 1 from public.student_profiles s join public.questions q on q.id=aq.question_id where s.user_id=auth.uid() and lower(s.status::text)='active' and coalesce(q.canonical_grade_code,case when q.grade::text='B10' then 'SHS1' else q.grade::text end)=case when s.grade::text='B10' then 'SHS1' else s.grade::text end))));
exception when sqlstate '42501' then return false; end $$;
create function quizbox_market.batch_allowed(p_batch uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.content_import_batches b where b.id=p_batch and
 (exists(select 1 from public.questions q where q.import_batch_id=b.id and quizbox_market.question_allowed(q.id))
 or (b.content_context is not null and (b.content_context->'market_ids') <@ (quizbox_market.resolve_context()->'market_ids') and b.imported_by=auth.uid())));
$$;
create function quizbox_market.class_allowed(p_class uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=quizbox_market.resolve_context();
 return exists(select 1 from public.classes x left join public.tenants t on t.id=x.tenant_id where x.id=p_class and (quizbox_market.curriculum_allowed(x.curriculum_id,c) or (x.curriculum_id is null and c->'market_ids' @> jsonb_build_array(t.market_id))));
exception when sqlstate '42501' then return false;
end $$;
create function quizbox_market.bank_allowed(p_bank uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin return exists(select 1 from public.question_banks b where b.id=p_bank and quizbox_market.resolve_context()->'market_ids' @> jsonb_build_array(b.market_id)); exception when sqlstate '42501' then return false; end $$;
create function quizbox_market.bank_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 if auth.uid() is null then return new; end if;
 c:=quizbox_market.resolve_context();
 if new.market_id is null and c->>'scope'='LOCAL_MARKET' then new.market_id:=(c->'market_ids'->>0)::uuid; end if;
 if not (c->'market_ids' @> jsonb_build_array(new.market_id)) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if; return new;
end $$;
create trigger market_bank_guard before insert or update on public.question_banks for each row execute function quizbox_market.bank_guard();
create function quizbox_market.membership_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin if auth.uid() is not null and not quizbox_market.class_allowed(new.class_id) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if; return new; end $$;
create trigger market_class_membership_guard before insert on public.class_memberships for each row execute function quizbox_market.membership_guard();
create function quizbox_market.competition_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.content_contexts;
begin
 if auth.uid() is null then return new; end if;
 if tg_op='UPDATE' and old.content_context_id is not null and new.content_context_id is distinct from old.content_context_id then raise exception 'QB_COMPETITION_CONTEXT_LOCKED'; end if;
 if tg_op='INSERT' or new.content_context_id is distinct from old.content_context_id then
  select * into c from public.content_contexts where id=new.content_context_id and owner_user_id=auth.uid();
  if c.id is null then raise exception 'QB_EXPLICIT_CONTENT_CONTEXT_REQUIRED' using errcode='42501'; end if;
  perform quizbox_market.validate_context(c.scope,c.source_mode,c.market_ids,c.source_document_ids);
 end if; return new;
end $$;
create trigger market_competition_guard before insert or update on public.competitions for each row execute function quizbox_market.competition_guard();
create function quizbox_market.team_allowed(p_team uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.competition_teams t where t.id=p_team and quizbox_market.competition_allowed(t.competition_id)); $$;

-- Block client forgery even through existing SECURITY DEFINER write RPCs.
create function quizbox_market.profile_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and not quizbox_market.is_super() and (new.default_market_id is distinct from old.default_market_id or new.active_content_context_id is distinct from old.active_content_context_id) then
  if new.id<>auth.uid() or (new.default_market_id is not null and not quizbox_market.market_allowed(new.default_market_id)) or (new.active_content_context_id is not null and not exists(select 1 from public.content_contexts where id=new.active_content_context_id and owner_user_id=new.id)) then raise exception 'QB_CONTENT_CONTEXT_DENIED' using errcode='42501'; end if;
 end if; return new;
end $$;
create trigger market_profile_guard before update on public.profiles for each row execute function quizbox_market.profile_guard();
create function quizbox_market.document_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.validation_status='approved' and new is distinct from old and not (new.validation_status='rejected' and (to_jsonb(new)-'validation_status')=(to_jsonb(old)-'validation_status')) then raise exception 'QB_APPROVED_SOURCE_IMMUTABLE'; end if;
 if auth.uid() is not null and not quizbox_market.is_super() and (new.validation_status='approved' or new.approved_by is not null) then raise exception 'QB_SOURCE_APPROVAL_DENIED' using errcode='42501'; end if;
 if new.validation_status='approved' and (new.approved_by is null or not new.rights_confirmed or nullif(new.checksum,'') is null or nullif(trim(new.content_text),'') is null) then raise exception 'QB_SOURCE_PROVENANCE_REQUIRED'; end if;
 if new.source_kind='CURRICULUM' and new.validation_status='approved' and not exists(select 1 from public.market_curricula mc where mc.curriculum_id=new.curriculum_id and mc.market_id=new.market_id and mc.authority_id=new.authority_id and mc.authority_id is not null) then raise exception 'QB_SOURCE_CURRICULUM_MISMATCH'; end if;
 if new.source_kind='SPONSOR_SOURCE' and new.sponsor_id is null then raise exception 'QB_SPONSOR_SOURCE_OWNER_REQUIRED'; end if;
 return new;
end $$;
create trigger market_document_guard before insert or update on public.source_documents for each row execute function quizbox_market.document_guard();
create function quizbox_market.batch_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null then new.generation_spec:=quizbox_market.generation_context(new.generation_spec); new.content_context:=new.generation_spec->'content_context'; end if; return new;
end $$;
create trigger market_generation_batch before insert on public.content_import_batches for each row execute function quizbox_market.batch_guard();
create function quizbox_market.snapshot_immutable() returns trigger language plpgsql set search_path='' as $$
begin if new.content_context is distinct from old.content_context then raise exception 'QB_CONTENT_CONTEXT_IMMUTABLE'; end if; return new; end $$;
create trigger immutable_batch_context before update on public.content_import_batches for each row execute function quizbox_market.snapshot_immutable();
create trigger immutable_attempt_context before update on public.attempts for each row execute function quizbox_market.snapshot_immutable();
create function quizbox_market.question_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare c jsonb;
begin
 if auth.uid() is null then return new; end if;
 if tg_op='UPDATE' then
  perform quizbox_market.assert_question(old.id);
  if new.curriculum_id is distinct from old.curriculum_id or new.curriculum_node_id is distinct from old.curriculum_node_id or new.source_document_ids is distinct from old.source_document_ids then raise exception 'QB_CONTENT_MAPPING_CHANGE_REQUIRES_REVIEW'; end if;
  return new;
 end if;
 select content_context into c from public.content_import_batches where id=new.import_batch_id;
 if c is null then c:=quizbox_market.resolve_context(); end if;
 if not coalesce(quizbox_market.node_allowed(new.curriculum_node_id,c),false) then raise exception 'QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT' using errcode='42501'; end if;
 if c->'source_document_ids' is null or jsonb_array_length(c->'source_document_ids')=0 then raise exception 'QB_EXPLICIT_APPROVED_SOURCES_REQUIRED'; end if;
 new.source_document_ids:=array(select v::uuid from jsonb_array_elements_text(c->'source_document_ids') v);
 return new;
end $$;
create trigger market_question_guard before insert or update on public.questions for each row execute function quizbox_market.question_guard();
create function quizbox_market.attempt_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin if auth.uid() is not null then if not quizbox_market.assessment_allowed(new.assessment_id) then raise exception 'QB_CONTENT_SOURCE_DENIED' using errcode='42501'; end if; new.content_context:=quizbox_market.assessment_context(new.assessment_id); end if; return new; end $$;
create trigger market_attempt_guard before insert on public.attempts for each row execute function quizbox_market.attempt_guard();
create function quizbox_market.snapshot_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin if auth.uid() is not null then perform quizbox_market.assert_question(new.question_id); end if; return new; end $$;
create trigger market_snapshot_guard before insert on public.assessment_questions for each row execute function quizbox_market.snapshot_guard();
create trigger immutable_market_context before update or delete on public.content_contexts for each row execute function quizbox_sme.immutable();
create trigger immutable_legacy_attribution before update or delete on public.legacy_content_attributions for each row execute function quizbox_sme.immutable();
create function quizbox_market.national_identity_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='market_curricula' then
  if not exists(select 1 from public.curricula c where c.id=new.curriculum_id and c.market_id=new.market_id) or (new.authority_id is not null and not exists(select 1 from public.curriculum_authorities a where a.id=new.authority_id and a.market_id=new.market_id)) then raise exception 'QB_CURRICULUM_AUTHORITY_MISMATCH'; end if;
 elsif tg_table_name='curricula' then
  if new.market_id is distinct from old.market_id and exists(select 1 from public.market_curricula where curriculum_id=old.id) then raise exception 'QB_NATIONAL_CURRICULUM_IDENTITY_IMMUTABLE'; end if;
 elsif new.market_id is distinct from old.market_id and exists(select 1 from public.market_curricula where authority_id=old.id) then raise exception 'QB_NATIONAL_AUTHORITY_IDENTITY_IMMUTABLE';
 end if; return new;
end $$;
create trigger market_curriculum_integrity before insert or update on public.market_curricula for each row execute function quizbox_market.national_identity_guard();
create trigger national_curriculum_integrity before update of market_id on public.curricula for each row execute function quizbox_market.national_identity_guard();
create trigger national_authority_integrity before update of market_id on public.curriculum_authorities for each row execute function quizbox_market.national_identity_guard();
create function quizbox_market.mapping_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and old.approved and new is distinct from old and not (not new.approved and (to_jsonb(new)-'approved')=(to_jsonb(old)-'approved')) then raise exception 'QB_APPROVED_MAPPING_IMMUTABLE'; end if;
 if not exists(select 1 from public.source_documents where id=new.source_document_id and source_kind in ('HARMONIZED_PACK','SPONSOR_SOURCE')) then raise exception 'QB_EXPLICIT_HARMONIZED_SOURCE_REQUIRED'; end if;
 if auth.uid() is not null and not quizbox_market.is_super() then raise exception 'QB_MAPPING_APPROVAL_DENIED' using errcode='42501'; end if;
 return new;
end $$;
create trigger harmonized_mapping_integrity before insert or update on public.harmonized_concept_mappings for each row execute function quizbox_market.mapping_guard();
create function quizbox_market.document_visible(p_document uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 if quizbox_market.is_super() then return true; end if;
 c:=quizbox_market.resolve_context();
 return quizbox_market.document_owned(p_document) and exists(select 1 from public.source_documents d where d.id=p_document and (c->'market_ids' @> jsonb_build_array(d.market_id) or c->'source_document_ids' @> jsonb_build_array(d.id)));
exception when sqlstate '42501' then return false;
end $$;

-- Existing role/tenant policies still apply: these restrictions are AND, not OR.
do $$ declare t text; begin
 foreach t in array array['curricula','curriculum_nodes','questions','source_documents','classes','class_memberships','assignments','question_banks','question_bank_items','learning_events','mastery_records'] loop execute format('alter table public.%I enable row level security',t); end loop;
end $$;
create policy market_curriculum_read on public.curricula as restrictive for select to authenticated using(quizbox_market.curriculum_allowed(id));
create policy market_node_read on public.curriculum_nodes as restrictive for select to authenticated using(quizbox_market.node_allowed(id));
create policy market_question_access on public.questions as restrictive for all to authenticated using(quizbox_market.question_allowed(id)) with check(quizbox_market.question_allowed(id));
create policy market_document_access on public.source_documents as restrictive for all to authenticated using(quizbox_market.document_visible(id)) with check(quizbox_market.is_super() or quizbox_market.market_allowed(market_id));
alter table public.competitions enable row level security;
create policy market_competition_read on public.competitions as restrictive for select to authenticated using(quizbox_market.competition_allowed(id));
create policy configured_competition_read on public.competitions for select to authenticated using(quizbox_market.competition_allowed(id));
create policy market_competition_team_read on public.competition_teams as restrictive for select to authenticated using(quizbox_market.competition_allowed(competition_id));
create policy market_competition_member_read on public.competition_team_members as restrictive for select to authenticated using(quizbox_market.team_allowed(team_id));
create policy market_class_read on public.classes as restrictive for select to authenticated using(quizbox_market.class_allowed(id));
create function quizbox_market.class_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin if auth.uid() is not null and not quizbox_market.curriculum_allowed(new.curriculum_id) then raise exception 'QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT' using errcode='42501'; end if; return new; end $$;
create trigger market_class_guard before insert or update of curriculum_id on public.classes for each row execute function quizbox_market.class_guard();
create policy market_assignment_read on public.assignments as restrictive for select to authenticated using(quizbox_market.class_allowed(class_id));
create policy market_class_membership_read on public.class_memberships as restrictive for select to authenticated using(quizbox_market.class_allowed(class_id));
create policy market_bank_read on public.question_banks as restrictive for select to authenticated using(quizbox_market.bank_allowed(id));
create policy market_bank_item_read on public.question_bank_items as restrictive for select to authenticated using(quizbox_market.question_allowed(question_id));
create policy market_learning_event_read on public.learning_events as restrictive for select to authenticated using(quizbox_market.node_allowed(curriculum_node_id));
create policy market_mastery_read on public.mastery_records as restrictive for select to authenticated using(quizbox_market.node_allowed(curriculum_node_id));

-- In-place guards preserve function OIDs, defaults, ACLs, budgets and original bodies.
-- Abort on missing or changed contracts rather than silently leaving a bypass.
do $$
declare f record; body text; definition text; gate text; name text;
begin
 foreach name in array array['qb_content_queue','qb_content_coverage','qb_content_batches','qb_content_detail','qb_content_review','qb_content_request_generation','qb_content_ingest','qb_publish_assignment','qb_start_attempt','qb_question_is_available','qb_can_access_learning_assessment','qb_sme_assign_review','qb_sme_review_detail','qb_sme_complete_review','qb_sme_publish_question','qb_register_competition_school','qb_create_competition_team','qb_can_manage_class','qb_is_class_member','qb_admin_content_health','qb_competition_leaderboard','qb_competition_funding_summary','qb_add_team_member','qb_verify_team_member','qb_attach_competition_sponsor','qb_record_competition_result','qb_finalize_competition_leaderboard'] loop
  if not exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname=name) then raise exception 'QB_MARKET_RPC_MISSING: %',name; end if;
 end loop;
 for f in select p.*,l.lanname,n.nspname from pg_proc p join pg_language l on l.oid=p.prolang join pg_namespace n on n.oid=p.pronamespace where
  (n.nspname='public' and p.proname in ('qb_content_queue','qb_content_coverage','qb_content_batches','qb_content_detail','qb_content_review','qb_content_request_generation','qb_content_ingest','qb_publish_assignment','qb_start_attempt','qb_question_is_available','qb_can_access_learning_assessment','qb_sme_assign_review','qb_sme_review_detail','qb_sme_complete_review','qb_sme_publish_question','qb_register_competition_school','qb_create_competition_team','qb_can_manage_class','qb_is_class_member','qb_admin_content_health','qb_competition_leaderboard','qb_competition_funding_summary','qb_add_team_member','qb_verify_team_member','qb_attach_competition_sponsor','qb_record_competition_result','qb_finalize_competition_leaderboard'))
  or (n.nspname='quizbox_private' and p.proname in ('core_qb_content_ingest','core_qb_content_request_generation','core_qb_content_review')) loop
  body:=f.prosrc; definition:=pg_get_functiondef(f.oid);
  if f.proname in ('qb_question_is_available','qb_can_access_learning_assessment','qb_can_manage_class','qb_is_class_member') and f.lanname='sql' then
   gate:=case when f.proname='qb_question_is_available' then 'quizbox_market.question_allowed(q.id)' when f.proname in ('qb_can_manage_class','qb_is_class_member') then 'quizbox_market.class_allowed(p_class_id)' else 'quizbox_market.assessment_allowed(p_assessment_id)' end;
   body:='select '||gate||' and coalesce(('||regexp_replace(trim(body),';\s*$','')||'),false);';
  elsif f.proname in ('qb_competition_leaderboard','qb_competition_funding_summary') and f.lanname='sql' then
   gate:=case when f.proname='qb_competition_leaderboard' then 'cr' else 'cs' end;
   if position('where '||gate||'.competition_id = p_competition_id' in body)=0 then raise exception 'QB_MARKET_COMPETITION_QUERY_CHANGED'; end if;
   body:=replace(body,'where '||gate||'.competition_id = p_competition_id','where quizbox_market.competition_allowed(p_competition_id) and '||gate||'.competition_id = p_competition_id');
  elsif f.proname='qb_publish_assignment' and f.lanname='sql' then continue; -- legacy delegates canonical guarded overload
  elsif f.lanname='plpgsql' then
   gate:=case
    when f.proname='qb_admin_content_health' then 'perform quizbox_market.resolve_context();'
    when f.proname='qb_content_batches' then 'perform quizbox_market.resolve_context();'
    when f.proname in ('qb_register_competition_school','qb_create_competition_team','qb_attach_competition_sponsor','qb_record_competition_result','qb_finalize_competition_leaderboard') then 'if not quizbox_market.competition_allowed(p_competition_id) then raise exception ''QB_COMPETITION_CONTEXT_DENIED'' using errcode=''42501''; end if;'
    when f.proname='qb_add_team_member' then 'if not quizbox_market.team_allowed(p_team_id) then raise exception ''QB_COMPETITION_CONTEXT_DENIED'' using errcode=''42501''; end if;'
    when f.proname='qb_verify_team_member' then 'if not exists(select 1 from public.competition_team_members m where m.id=p_team_member_id and quizbox_market.team_allowed(m.team_id)) then raise exception ''QB_COMPETITION_CONTEXT_DENIED'' using errcode=''42501''; end if;'
    when f.proname in ('qb_content_queue','qb_content_coverage') then 'p_filters:=quizbox_market.scoped_filters(p_filters);'
    when f.proname in ('qb_content_request_generation','core_qb_content_request_generation','qb_content_ingest','core_qb_content_ingest') then 'p_spec:=quizbox_market.generation_context(p_spec);'
    when f.proname in ('qb_content_detail','qb_content_review','core_qb_content_review') then 'perform quizbox_market.assert_question(p_id);'
    when f.proname='qb_publish_assignment' then 'perform quizbox_market.assert_nodes(p_curriculum_node_ids); if not exists(select 1 from public.classes c where c.id=p_class_id and quizbox_market.curriculum_allowed(c.curriculum_id) and not exists(select 1 from public.curriculum_nodes n where n.id=any(p_curriculum_node_ids) and n.curriculum_id<>c.curriculum_id)) then raise exception ''QB_CURRICULUM_OUTSIDE_CONTENT_CONTEXT'' using errcode=''42501''; end if;'
    when f.proname='qb_start_attempt' then 'if not quizbox_market.assessment_allowed(p_assessment_id) then raise exception ''QB_CONTENT_SOURCE_DENIED'' using errcode=''42501''; end if;'
    when f.proname in ('qb_sme_assign_review','qb_sme_publish_question') then 'perform quizbox_market.assert_question(p_question);'
    else 'if not exists(select 1 from public.sme_review_assignments w where w.id=p_assignment and quizbox_market.question_allowed(w.question_id)) then raise exception ''QB_CONTENT_SOURCE_DENIED'' using errcode=''42501''; end if;'
   end;
   if body !~* '(^|[\n\r])[ \t]*begin\M' then raise exception 'QB_MARKET_RPC_BODY_CHANGED: %',f.proname; end if;
   body:=regexp_replace(body,'(^|[\n\r])[ \t]*begin\M',E'\\1begin '||gate,'i');
   if f.proname='qb_content_queue' then
    if position('where' in body)=0 or position('select q.* from public.questions q' in body)=0 then raise exception 'QB_MARKET_QUEUE_CONTRACT_CHANGED'; end if;
    body:=replace(body,'select q.* from public.questions q','select q.* from (select * from public.questions scoped_q where quizbox_market.question_allowed(scoped_q.id)) q');
   elsif f.proname='qb_content_coverage' then
    if position('select * from public.curriculum_nodes where is_active' in body)=0 or position('select * from public.questions where' in body)=0 then raise exception 'QB_MARKET_COVERAGE_CONTRACT_CHANGED'; end if;
    body:=replace(body,'select * from public.curriculum_nodes where is_active','select * from public.curriculum_nodes where is_active and quizbox_market.curriculum_allowed(curriculum_id)');
    body:=replace(body,'select * from public.questions where','select * from public.questions where quizbox_market.question_allowed(id) and');
    body:=replace(body,'from public.questions where source_type in','from public.questions where quizbox_market.question_allowed(id) and source_type in');
   elsif f.proname='qb_content_batches' then
    if position('from public.content_import_batches' in body)=0 then raise exception 'QB_MARKET_BATCH_CONTRACT_CHANGED'; end if;
    body:=replace(body,'from public.content_import_batches b','from (select * from public.content_import_batches scoped_b where quizbox_market.batch_allowed(scoped_b.id)) b');
    body:=replace(body,'from public.content_import_batches)','from (select * from public.content_import_batches scoped_b where quizbox_market.batch_allowed(scoped_b.id)) scoped_batches)');
   elsif f.proname='qb_admin_content_health' then
    if position('from public.questions;' in body)=0 then raise exception 'QB_MARKET_HEALTH_CONTRACT_CHANGED'; end if;
    body:=replace(body,'from public.questions;','from public.questions where quizbox_market.question_allowed(id);');
    body:=replace(body,'from public.question_media qm','from public.question_media qm where quizbox_market.question_allowed(qm.question_id)');
    body:=replace(body,'from public.question_banks qb','from (select * from public.question_banks scoped_bank where quizbox_market.bank_allowed(scoped_bank.id)) qb');
    body:=replace(body,E'from public.question_banks\r\n',E'from public.question_banks where quizbox_market.bank_allowed(id)\r\n');
    body:=replace(body,E'from public.question_banks\n',E'from public.question_banks where quizbox_market.bank_allowed(id)\n');
   end if;
  else raise exception 'QB_MARKET_RPC_LANGUAGE_CHANGED: %',f.proname;
  end if;
  if position(f.prosrc in definition)=0 then raise exception 'QB_MARKET_RPC_DEFINITION_CHANGED'; end if;
  execute replace(definition,f.prosrc,body);
 end loop;
end $$;

-- Reviewer domain predicates remain authoritative and now also require membership.
do $$ declare f record; definition text; begin
 select p.* into f from pg_proc p where p.oid='quizbox_sme.domain_matches(uuid,uuid,uuid,uuid,boolean,boolean)'::regprocedure;
 definition:=pg_get_functiondef(f.oid);
 execute replace(definition,f.prosrc,'select quizbox_market.market_allowed(p_market,p_reviewer) and coalesce(('||regexp_replace(trim(f.prosrc),';\s*$','')||'),false);');
end $$;
create policy market_sme_work_read on public.sme_review_assignments as restrictive for select to authenticated using(quizbox_market.is_super() or (quizbox_market.market_allowed(market_id) and quizbox_market.question_allowed(question_id) and quizbox_sme.domain_matches(domain_assignment_id,question_id,auth.uid(),market_id,review_kind='senior',false)));

do $$ declare t text; begin
 foreach t in array array['curriculum_authorities','market_curricula','user_market_memberships','content_contexts','harmonized_concept_mappings','legacy_content_attributions','market_attribution_issues'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  if exists(select 1 from pg_roles where rolname='service_role') then execute format('grant all on public.%I to service_role',t); end if;
 end loop;
end $$;
create policy authorities_market_read on public.curriculum_authorities for select to authenticated using(quizbox_market.market_allowed(market_id));
create policy market_curricula_read on public.market_curricula for select to authenticated using(quizbox_market.is_super() or quizbox_market.curriculum_allowed(curriculum_id));
create policy user_markets_read on public.user_market_memberships for select to authenticated using(user_id=auth.uid() or quizbox_market.is_super());
create policy owned_context_read on public.content_contexts for select to authenticated using(owner_user_id=auth.uid() or quizbox_market.is_super());
create policy concept_mapping_read on public.harmonized_concept_mappings for select to authenticated using(quizbox_market.node_allowed(node_id));
create policy legacy_attribution_read on public.legacy_content_attributions for select to authenticated using(quizbox_market.is_super());
create policy attribution_issue_read on public.market_attribution_issues for select to authenticated using(quizbox_market.is_super());
create index market_curricula_market_idx on public.market_curricula(market_id);
create index source_document_market_idx on public.source_documents(market_id,curriculum_id,validation_status);
create index user_markets_market_idx on public.user_market_memberships(market_id);
create index content_context_owner_idx on public.content_contexts(owner_user_id);
create index competition_content_context_idx on public.competitions(content_context_id);
grant usage on schema quizbox_market to authenticated;
revoke execute on all functions in schema quizbox_market from public,anon,authenticated;
grant execute on function quizbox_market.is_super(),quizbox_market.market_allowed(uuid,uuid),quizbox_market.document_owned(uuid),quizbox_market.document_visible(uuid),quizbox_market.curriculum_allowed(uuid,jsonb),quizbox_market.node_allowed(uuid,jsonb),quizbox_market.question_allowed(uuid,jsonb),quizbox_market.competition_allowed(uuid),quizbox_market.class_allowed(uuid),quizbox_market.bank_allowed(uuid),quizbox_market.team_allowed(uuid) to authenticated;
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('qb_content_market_context','qb_select_content_market','qb_create_content_context','qb_activate_content_context','qb_resolve_generation_sources','qb_set_competition_content_context','qb_list_content_markets','qb_list_content_sources','qb_market_configure') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
commit;
