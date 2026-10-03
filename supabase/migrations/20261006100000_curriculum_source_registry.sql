-- Curriculum Source Registry: multi-country source packs with explicit target country, per-country ingestion jobs,
-- strict country isolation, and a governed fetch -> extract -> map -> review -> approve -> activate pipeline.
-- No country is hardcoded: countries, markets, authorities and curricula come from market configuration.
-- No questions are generated here. Activation goes through the existing source_documents approval guard.
begin;

create schema quizbox_sources;
revoke all on schema quizbox_sources from public,anon,authenticated;

-- Official hosts an authority publishes from; fetching is refused for any other host.
alter table public.curriculum_authorities add column official_domains text[] not null default '{}'
 check (array_to_string(official_domains,',') ~ '^([a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(,[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,})*)?$');

create table quizbox_sources.packages (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 3 and 200),
 package_type text not null check (package_type in ('COUNTRY_PACK','MULTI_COUNTRY_PACK','GLOBAL_SOURCE_PACK')),
 file_name text not null check (length(file_name) between 1 and 250),
 sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
 research_date date, notes jsonb not null default '[]', source_countries text[] not null default '{}', entry_count integer not null check (entry_count>=0),
 attachments jsonb not null default '[]',
 uploaded_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique (sha256)
);
create table quizbox_sources.ingestion_jobs (
 id uuid primary key default gen_random_uuid(),
 package_id uuid not null references quizbox_sources.packages(id),
 source_country_id uuid references public.countries(id),
 market_id uuid not null references public.markets(id),
 status text not null default 'CONFIRMED' check (status in ('CONFIRMED','COMPLETED','CANCELLED')),
 level_mapping jsonb not null default '{}', preview jsonb not null default '{}',
 imported_count integer not null default 0, skipped_count integer not null default 0,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique (package_id, market_id)
);
create table quizbox_sources.registry (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references quizbox_sources.ingestion_jobs(id),
 package_id uuid not null references quizbox_sources.packages(id),
 source_country_id uuid references public.countries(id),
 country_id uuid not null references public.countries(id),
 market_id uuid not null references public.markets(id),
 authority_id uuid not null references public.curriculum_authorities(id),
 curriculum_id uuid not null references public.curricula(id),
 education_level text not null check (length(trim(education_level)) between 1 and 120),
 subject_code text not null check (length(trim(subject_code)) between 1 and 120),
 title text not null check (length(trim(title)) between 1 and 300),
 canonical_url text not null check (canonical_url ~ '^https://[^/\s]+(/\S*)?$' and length(canonical_url)<=2000),
 source_type text not null check (source_type in ('OFFICIAL_PDF','OFFICIAL_INDEX','USER_SUPPLIED')),
 verification_status text not null check (verification_status in ('VERIFIED','INDEX_LISTED','UNCONFIRMED')),
 status text not null check (status in ('IMPORTED','FETCHED','EXTRACTED','MAPPED','NEEDS_REVIEW','APPROVED','ACTIVE','SUPERSEDED','REJECTED','DIRECT_PDF_PENDING')),
 version text, effective_date date, research_date date,
 sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'), byte_size integer, storage_path text, pages integer,
 source_document_id uuid references public.source_documents(id),
 fetch_attempts integer not null default 0, last_error text, claim_token uuid, claimed_by uuid references public.profiles(id), claimed_at timestamptz,
 reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_note text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 -- A shared index URL may legitimately carry several subjects; duplicates are the same URL, level and subject.
 unique (market_id, canonical_url, education_level, subject_code)
);
create table quizbox_sources.events (
 id bigint generated always as identity primary key, registry_id uuid references quizbox_sources.registry(id), package_id uuid references quizbox_sources.packages(id),
 job_id uuid references quizbox_sources.ingestion_jobs(id), actor_id uuid references public.profiles(id), action text not null, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create index sources_packages_uploaded_by on quizbox_sources.packages(uploaded_by);
create index sources_jobs_package on quizbox_sources.ingestion_jobs(package_id);
create index sources_jobs_market on quizbox_sources.ingestion_jobs(market_id);
create index sources_jobs_country on quizbox_sources.ingestion_jobs(source_country_id);
create index sources_jobs_created_by on quizbox_sources.ingestion_jobs(created_by);
create index sources_registry_filter on quizbox_sources.registry(market_id,status,curriculum_id,education_level,subject_code);
create index sources_registry_job on quizbox_sources.registry(job_id);
create index sources_registry_package on quizbox_sources.registry(package_id);
create index sources_registry_country on quizbox_sources.registry(country_id);
create index sources_registry_source_country on quizbox_sources.registry(source_country_id);
create index sources_registry_authority on quizbox_sources.registry(authority_id);
create index sources_registry_curriculum on quizbox_sources.registry(curriculum_id);
create index sources_registry_document on quizbox_sources.registry(source_document_id);
create index sources_registry_claimed_by on quizbox_sources.registry(claimed_by);
create index sources_registry_reviewed_by on quizbox_sources.registry(reviewed_by);
create index sources_events_registry on quizbox_sources.events(registry_id,id desc);
create index sources_events_package on quizbox_sources.events(package_id);
create index sources_events_job on quizbox_sources.events(job_id);
create index sources_events_actor on quizbox_sources.events(actor_id);
create trigger immutable_source_events before update or delete on quizbox_sources.events for each row execute function quizbox_sme.immutable();

-- Country isolation, enforced for every write regardless of caller: the registry row's market, country, authority,
-- curriculum and linked document must all belong together; the source's own country must equal the market's country
-- unless the package is an explicit GLOBAL_SOURCE_PACK.
create function quizbox_sources.registry_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 select package_type into kind from quizbox_sources.packages where id=new.package_id;
 if not exists(select 1 from public.markets m where m.id=new.market_id and m.country_id=new.country_id) then raise exception 'QB_SOURCE_MARKET_COUNTRY_MISMATCH'; end if;
 if kind<>'GLOBAL_SOURCE_PACK' and new.source_country_id is distinct from new.country_id then raise exception 'QB_SOURCE_COUNTRY_MISMATCH'; end if;
 if not exists(select 1 from public.market_curricula mc join public.curriculum_authorities a on a.id=mc.authority_id
  where mc.curriculum_id=new.curriculum_id and mc.market_id=new.market_id and mc.authority_id=new.authority_id and a.market_id=new.market_id) then raise exception 'QB_SOURCE_CURRICULUM_NOT_IN_MARKET'; end if;
 if new.source_document_id is not null and not exists(select 1 from public.source_documents d where d.id=new.source_document_id and d.market_id=new.market_id and d.curriculum_id=new.curriculum_id and d.authority_id=new.authority_id and d.source_kind='CURRICULUM') then raise exception 'QB_SOURCE_DOCUMENT_MARKET_MISMATCH'; end if;
 if tg_op='UPDATE' and (new.market_id<>old.market_id or new.country_id<>old.country_id or new.source_country_id is distinct from old.source_country_id or new.package_id<>old.package_id) then raise exception 'QB_SOURCE_ORIGIN_IMMUTABLE'; end if;
 new.updated_at:=now();
 return new;
end $$;
create trigger source_registry_guard before insert or update on quizbox_sources.registry for each row execute function quizbox_sources.registry_guard();

create function quizbox_sources.log(p_registry uuid,p_package uuid,p_job uuid,p_action text,p_details jsonb default '{}') returns void language sql security definer set search_path='' as $$
 insert into quizbox_sources.events(registry_id,package_id,job_id,actor_id,action,details) values(p_registry,p_package,p_job,auth.uid(),p_action,coalesce(p_details,'{}'));
$$;

-- Resolve a pack's country label (name, ISO2 or ISO3) to a configured country; never guesses.
create function quizbox_sources.country_of(p_label text) returns uuid language sql stable security definer set search_path='' as $$
 select id from public.countries where lower(name)=lower(trim(p_label)) or upper(iso2_code)=upper(trim(p_label)) or upper(iso3_code)=upper(trim(p_label)) limit 1;
$$;
create function quizbox_sources.classify(p_row jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'source_type',case when lower(coalesce(p_row->>'source_type','')) like '%index%' or lower(coalesce(p_row->>'source_type','')) like '%portal%' then 'OFFICIAL_INDEX'
   when lower(coalesce(p_row->>'source_type','')) like '%user%' then 'USER_SUPPLIED' else 'OFFICIAL_PDF' end,
  'verification_status',case when lower(coalesce(p_row->>'status','')) ~ '(not independently confirmed|unconfirmed|pending|not confirmed)' then 'UNCONFIRMED'
   when lower(coalesce(p_row->>'status','')) like '%verified%' then 'VERIFIED' else 'INDEX_LISTED' end);
$$;

-- Subject label -> the market's configured subject code (code or label, case-insensitive); falls back to the label.
create function quizbox_sources.subject_code(p_market uuid,p_label text) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select s->>'code' from public.markets m,jsonb_array_elements(coalesce(m.configuration->'subjects','[]')) s
  where m.id=p_market and (lower(s->>'code')=lower(trim(p_label)) or lower(s->>'label')=lower(trim(p_label))) limit 1),trim(p_label));
$$;

-- Validate a parsed package against the target market(s). Pure read: returns the preview and the resolved rows.
create function quizbox_sources.evaluate(p_package jsonb,p_target_market uuid,p_mapping jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare grp jsonb; country uuid; market uuid; kind text:=p_package->>'package_type'; out_groups jsonb:='[]'; rows_out jsonb; r jsonb; cls jsonb; lvl text; cur jsonb;
 dup integer; warnings jsonb; seen text[]; url text; target_country uuid;
begin
 if kind not in ('COUNTRY_PACK','MULTI_COUNTRY_PACK','GLOBAL_SOURCE_PACK') then raise exception 'QB_INVALID_PACKAGE_TYPE'; end if;
 if jsonb_typeof(p_package->'groups')<>'array' or jsonb_array_length(p_package->'groups')=0 then raise exception 'QB_PACKAGE_EMPTY'; end if;
 if kind='COUNTRY_PACK' and jsonb_array_length(p_package->'groups')<>1 then raise exception 'QB_COUNTRY_PACK_HAS_MULTIPLE_COUNTRIES'; end if;
 select country_id into target_country from public.markets where id=p_target_market;
 if p_target_market is not null and target_country is null then raise exception 'QB_TARGET_MARKET_NOT_FOUND'; end if;
 for grp in select value from jsonb_array_elements(p_package->'groups') loop
  country:=quizbox_sources.country_of(grp->>'country'); market:=null; warnings:='[]'; rows_out:='[]'; dup:=0; seen:='{}';
  if kind='GLOBAL_SOURCE_PACK' then market:=p_target_market;
  elsif country is null then warnings:=warnings||'"COUNTRY_NOT_CONFIGURED"';
  elsif p_target_market is not null then
   if country<>target_country then
    -- A specific target country only ingests its own group; any other country is reported, never imported.
    if kind='COUNTRY_PACK' then raise exception 'QB_SOURCE_COUNTRY_MISMATCH'; end if;
    warnings:=warnings||'"NOT_TARGET_COUNTRY"';
   else market:=p_target_market; end if;
  else
   select m.id into market from public.markets m where m.country_id=country and m.status<>'SUSPENDED' order by (m.status='ACTIVE') desc,m.name limit 1;
   if market is null then warnings:=warnings||'"NO_MARKET_FOR_COUNTRY"'; end if;
  end if;
  if market is not null and not quizbox_market.market_allowed(market) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if;
  for r in select value from jsonb_array_elements(coalesce(grp->'rows','[]')) loop
   cls:=quizbox_sources.classify(r); lvl:=trim(coalesce(r->>'level','')); url:=trim(coalesce(r->>'url',''));
   cur:=case when market is null then null else (select to_jsonb(x) from (select k.id curriculum_id,k.code curriculum,a.id authority_id,a.code authority,a.official_domains
     from public.market_curricula mc join public.curricula k on k.id=mc.curriculum_id join public.curriculum_authorities a on a.id=mc.authority_id
     where mc.market_id=market and mc.active and a.active and a.market_id=market and k.id::text=coalesce(p_mapping->(market::text)->>lvl,'')) x) end;
   rows_out:=rows_out||jsonb_build_array(jsonb_build_object('level',lvl,'subject',trim(coalesce(r->>'subject','')),'subject_code',case when market is null then null else quizbox_sources.subject_code(market,coalesce(r->>'subject','')) end,
    'title',trim(coalesce(r->>'title','')),'url',url,'version',nullif(trim(coalesce(r->>'version','')),''),'effective_date',nullif(trim(coalesce(r->>'effective_date','')),''),
    'curriculum_id',cur->>'curriculum_id','curriculum',cur->>'curriculum','authority_id',cur->>'authority_id','authority',cur->>'authority')||cls
    ||jsonb_build_object('issue',case when url !~ '^https://[^/\s]+(/\S*)?$' then 'INVALID_URL' when trim(coalesce(r->>'title',''))='' or trim(coalesce(r->>'subject',''))='' or lvl='' then 'INCOMPLETE_METADATA'
      when (url||'|'||lvl||'|'||lower(trim(coalesce(r->>'subject',''))))=any(seen) then 'DUPLICATE_IN_PACKAGE'
      when market is not null and exists(select 1 from quizbox_sources.registry g where g.market_id=market and g.canonical_url=url and g.education_level=lvl and g.subject_code=quizbox_sources.subject_code(market,coalesce(r->>'subject',''))) then 'ALREADY_REGISTERED'
      when market is not null and cur is null then 'CURRICULUM_NOT_MAPPED'
      when cur is not null and cls->>'source_type'<>'OFFICIAL_INDEX' and jsonb_array_length(cur->'official_domains')>0 and not exists(select 1 from jsonb_array_elements_text(cur->'official_domains') d where lower(substring(url from '^https://([^/:]+)'))=d or lower(substring(url from '^https://([^/:]+)')) like '%.'||d)
       then 'HOST_NOT_OFFICIAL' end));
   if (url||'|'||lvl||'|'||lower(trim(coalesce(r->>'subject',''))))=any(seen) then dup:=dup+1; end if; seen:=seen||(url||'|'||lvl||'|'||lower(trim(coalesce(r->>'subject',''))));
  end loop;
  out_groups:=out_groups||jsonb_build_object('country',grp->>'country','country_id',country,'market_id',market,'market',(select name from public.markets where id=market),'warnings',warnings,
   'levels',(select coalesce(jsonb_agg(distinct x->>'level'),'[]') from jsonb_array_elements(rows_out) x),
   'curricula',case when market is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('id',k.id,'code',k.code,'authority',a.code)),'[]') from public.market_curricula mc join public.curricula k on k.id=mc.curriculum_id join public.curriculum_authorities a on a.id=mc.authority_id where mc.market_id=market and mc.active and a.active) end,
   'summary',(select jsonb_agg(jsonb_build_object('authority',s.authority,'curriculum',s.curriculum,'level',s.level,'subject',s.subject,'sources',s.n,'verified_pdfs',s.pdfs,'index_only',s.idx,'pending',s.pend,'duplicates',s.dups,'warnings',s.warns) order by s.level,s.subject) from (
     select x->>'authority' authority,x->>'curriculum' curriculum,x->>'level' level,coalesce(x->>'subject_code',x->>'subject') subject,count(*) n,
      count(*) filter(where x->>'source_type'='OFFICIAL_PDF' and x->>'verification_status'='VERIFIED' and x->>'issue' is null) pdfs,
      count(*) filter(where x->>'source_type'='OFFICIAL_INDEX') idx,count(*) filter(where x->>'verification_status'='UNCONFIRMED') pend,
      count(*) filter(where x->>'issue' in ('DUPLICATE_IN_PACKAGE','ALREADY_REGISTERED')) dups,
      coalesce(jsonb_agg(distinct x->>'issue') filter(where x->>'issue' is not null and x->>'issue' not in ('DUPLICATE_IN_PACKAGE','ALREADY_REGISTERED')),'[]') warns
     from jsonb_array_elements(rows_out) x group by 1,2,3,4) s),
   'totals',(select jsonb_build_object('sources',count(*),'importable',count(*) filter(where x->>'issue' is null),'verified_pdfs',count(*) filter(where x->>'source_type'='OFFICIAL_PDF' and x->>'verification_status'='VERIFIED' and x->>'issue' is null),
     'index_only',count(*) filter(where x->>'source_type'='OFFICIAL_INDEX'),'pending',count(*) filter(where x->>'verification_status'='UNCONFIRMED'),'duplicates',count(*) filter(where x->>'issue' in ('DUPLICATE_IN_PACKAGE','ALREADY_REGISTERED')),
     'warnings',count(*) filter(where x->>'issue' is not null and x->>'issue' not in ('DUPLICATE_IN_PACKAGE','ALREADY_REGISTERED'))) from jsonb_array_elements(rows_out) x),
   'rows',rows_out);
 end loop;
 return jsonb_build_object('package_type',kind,'groups',out_groups);
end $$;

create function quizbox_sources.registry_json(g quizbox_sources.registry) returns jsonb language sql stable security definer set search_path='' as $$
 select (to_jsonb(g)-'claim_token')||jsonb_build_object('market',(select name from public.markets where id=g.market_id),'country',(select name from public.countries where id=g.country_id),
  'source_country',(select name from public.countries where id=g.source_country_id),'authority',(select code from public.curriculum_authorities where id=g.authority_id),
  'curriculum',(select code from public.curricula where id=g.curriculum_id),'package',(select name from quizbox_sources.packages where id=g.package_id));
$$;

-- Super Admin source registry operations. Packages are parsed client-side into
-- {name, package_type, file_name, sha256, research_date, notes, attachments, groups:[{country, rows:[...]}]};
-- every rule (country isolation, curriculum/authority resolution, official hosts, duplicates) is enforced here.
create function public.qb_curriculum_sources(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare super boolean:=quizbox_market.is_super(); result jsonb; ev jsonb; grp jsonb; r jsonb; pkg quizbox_sources.packages; job quizbox_sources.ingestion_jobs; g quizbox_sources.registry;
 doc uuid; n integer; skipped integer; prev quizbox_sources.registry; host text;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if jsonb_typeof(coalesce(p_data,'{}'))<>'object' or octet_length(coalesce(p_data,'{}')::text)>4000000 then raise exception 'QB_INVALID_SOURCE_INPUT'; end if;
 if p_action='list' or p_action='summary' then
  if not (super or quizbox_sme.has_capability('content_admin')) then raise exception 'QB_SOURCE_REGISTRY_DENIED' using errcode='42501'; end if;
 elsif not super then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;

 if p_action='options' then
  return coalesce((select jsonb_agg(jsonb_build_object('market_id',m.id,'market',m.name,'status',m.status,'is_test',m.is_test,'country_id',c.id,'country',c.name,'iso2',c.iso2_code,
   'curricula',(select coalesce(jsonb_agg(jsonb_build_object('id',k.id,'code',k.code,'authority_id',a.id,'authority',a.code,'official_domains',a.official_domains,'active',mc.active) order by k.code),'[]')
     from public.market_curricula mc join public.curricula k on k.id=mc.curriculum_id join public.curriculum_authorities a on a.id=mc.authority_id where mc.market_id=m.id and a.market_id=m.id))
   order by c.name,m.name) from public.markets m join public.countries c on c.id=m.country_id where quizbox_market.market_allowed(m.id)),'[]');
 end if;

 if p_action='readiness' then
  if not quizbox_market.market_allowed((p_data->>'market_id')::uuid) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if;
  return quizbox_market.market_readiness((p_data->>'market_id')::uuid);
 end if;

 if p_action='set_domains' then
  update public.curriculum_authorities set official_domains=array(select distinct lower(trim(d)) from jsonb_array_elements_text(coalesce(p_data->'domains','[]')) d where trim(d)<>'')
   where id=(p_data->>'authority_id')::uuid and quizbox_market.market_allowed(market_id) returning jsonb_build_object('authority_id',id,'official_domains',official_domains) into result;
  if result is null then raise exception 'QB_AUTHORITY_NOT_FOUND'; end if;
  perform quizbox_sources.log(null,null,null,'AUTHORITY_DOMAINS_SET',result); return result;
 end if;

 if p_action in ('preview','import') then
  if jsonb_typeof(p_data->'package')<>'object' or (select coalesce(sum(jsonb_array_length(coalesce(x->'rows','[]'))),0) from jsonb_array_elements(coalesce(p_data#>'{package,groups}','[]')) x)>5000 then raise exception 'QB_INVALID_PACKAGE'; end if;
  ev:=quizbox_sources.evaluate(p_data->'package',nullif(p_data->>'target_market_id','')::uuid,coalesce(p_data->'mapping','{}'));
  if p_action='preview' then return ev; end if;
  if coalesce((p_data->>'confirm')::boolean,false) is not true then raise exception 'QB_IMPORT_CONFIRMATION_REQUIRED'; end if;
  if (p_data#>>'{package,sha256}') !~ '^[0-9a-f]{64}$' then raise exception 'QB_INVALID_PACKAGE'; end if;
  select * into pkg from quizbox_sources.packages where sha256=p_data#>>'{package,sha256}';
  if pkg.id is null then
   insert into quizbox_sources.packages(name,package_type,file_name,sha256,research_date,notes,source_countries,entry_count,attachments,uploaded_by)
   values(p_data#>>'{package,name}',ev->>'package_type',p_data#>>'{package,file_name}',p_data#>>'{package,sha256}',nullif(p_data#>>'{package,research_date}','')::date,
    coalesce(p_data#>'{package,notes}','[]'),array(select g2->>'country' from jsonb_array_elements(ev->'groups') g2),
    (select coalesce(sum(jsonb_array_length(g2->'rows')),0) from jsonb_array_elements(ev->'groups') g2),coalesce(p_data#>'{package,attachments}','[]'),auth.uid()) returning * into pkg;
   perform quizbox_sources.log(null,pkg.id,null,'PACKAGE_REGISTERED',jsonb_build_object('type',pkg.package_type,'countries',pkg.source_countries,'entries',pkg.entry_count));
  end if;
  result:='[]';
  -- One ingestion job per country/market; groups are never flattened into one corpus.
  for grp in select value from jsonb_array_elements(ev->'groups') loop
   if grp->>'market_id' is null then result:=result||jsonb_build_object('country',grp->>'country','status','NOT_IMPORTED','warnings',grp->'warnings'); continue; end if;
   if exists(select 1 from quizbox_sources.ingestion_jobs where package_id=pkg.id and market_id=(grp->>'market_id')::uuid) then raise exception 'QB_PACKAGE_ALREADY_IMPORTED_FOR_MARKET'; end if;
   insert into quizbox_sources.ingestion_jobs(package_id,source_country_id,market_id,level_mapping,preview,created_by)
   values(pkg.id,(grp->>'country_id')::uuid,(grp->>'market_id')::uuid,coalesce(p_data->'mapping'->(grp->>'market_id'),'{}'),grp-'rows',auth.uid()) returning * into job;
   n:=0; skipped:=0;
   for r in select value from jsonb_array_elements(grp->'rows') loop
    if r->>'issue' is not null then skipped:=skipped+1; continue; end if;
    insert into quizbox_sources.registry(job_id,package_id,source_country_id,country_id,market_id,authority_id,curriculum_id,education_level,subject_code,title,canonical_url,source_type,verification_status,status,version,effective_date,research_date)
    values(job.id,pkg.id,case when pkg.package_type='GLOBAL_SOURCE_PACK' then (grp->>'country_id')::uuid else (grp->>'country_id')::uuid end,(select country_id from public.markets where id=job.market_id),job.market_id,
     (r->>'authority_id')::uuid,(r->>'curriculum_id')::uuid,r->>'level',r->>'subject_code',r->>'title',r->>'url',r->>'source_type',r->>'verification_status',
     case when r->>'verification_status'='UNCONFIRMED' then 'DIRECT_PDF_PENDING' else 'IMPORTED' end,r->>'version',
     case when (r->>'effective_date') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'effective_date')::date end,pkg.research_date) returning * into g;
    perform quizbox_sources.log(g.id,pkg.id,job.id,g.status,jsonb_build_object('url',g.canonical_url));
    n:=n+1;
   end loop;
   update quizbox_sources.ingestion_jobs set imported_count=n,skipped_count=skipped where id=job.id;
   result:=result||jsonb_build_object('country',grp->>'country','market',grp->>'market','job_id',job.id,'status','IMPORTED','imported',n,'skipped',skipped);
  end loop;
  return jsonb_build_object('package_id',pkg.id,'jobs',result);
 end if;

 if p_action='list' then
  return jsonb_build_object(
   'rows',coalesce((select jsonb_agg(quizbox_sources.registry_json(x) order by x.market_id,x.education_level,x.subject_code,x.title) from (select * from quizbox_sources.registry g2 where quizbox_market.market_allowed(g2.market_id)
     and (nullif(p_data->>'country_id','') is null or g2.country_id=(p_data->>'country_id')::uuid) and (nullif(p_data->>'market_id','') is null or g2.market_id=(p_data->>'market_id')::uuid)
     and (nullif(p_data->>'authority_id','') is null or g2.authority_id=(p_data->>'authority_id')::uuid) and (nullif(p_data->>'curriculum_id','') is null or g2.curriculum_id=(p_data->>'curriculum_id')::uuid)
     and (nullif(p_data->>'level','') is null or g2.education_level=p_data->>'level') and (nullif(p_data->>'subject','') is null or g2.subject_code=p_data->>'subject')
     and (nullif(p_data->>'status','') is null or g2.status=p_data->>'status') order by g2.education_level,g2.subject_code limit 1000) x),'[]'),
   'by_status',coalesce((select jsonb_object_agg(status,n2) from (select status,count(*) n2 from quizbox_sources.registry g2 where quizbox_market.market_allowed(g2.market_id) and (nullif(p_data->>'market_id','') is null or g2.market_id=(p_data->>'market_id')::uuid) group by 1) x),'{}'),
   'packages',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'type',k.package_type,'file',k.file_name,'countries',k.source_countries,'entries',k.entry_count,'created_at',k.created_at,
     'jobs',(select coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'market',(select name from public.markets where id=j.market_id),'imported',j.imported_count,'skipped',j.skipped_count)),'[]') from quizbox_sources.ingestion_jobs j where j.package_id=k.id and quizbox_market.market_allowed(j.market_id)))
     order by k.created_at desc) from quizbox_sources.packages k where exists(select 1 from quizbox_sources.ingestion_jobs j where j.package_id=k.id and quizbox_market.market_allowed(j.market_id))),'[]'));
 end if;

 if p_action='claim_fetch' then
  n:=least(greatest(coalesce((p_data->>'limit')::integer,3),1),5);
  update quizbox_sources.registry set last_error='AUTHORITY_DOMAINS_NOT_CONFIGURED' where status='IMPORTED' and source_type='OFFICIAL_PDF'
   and (nullif(p_data->>'market_id','') is null or market_id=(p_data->>'market_id')::uuid) and quizbox_market.market_allowed(market_id)
   and exists(select 1 from public.curriculum_authorities a where a.id=authority_id and cardinality(a.official_domains)=0);
  with picked as (select g2.id from quizbox_sources.registry g2 join public.curriculum_authorities a on a.id=g2.authority_id
   where g2.status='IMPORTED' and g2.source_type='OFFICIAL_PDF' and g2.verification_status='VERIFIED' and g2.fetch_attempts<3 and cardinality(a.official_domains)>0
    and (g2.claimed_at is null or g2.claimed_at<now()-interval '10 minutes') and quizbox_market.market_allowed(g2.market_id)
    and (nullif(p_data->>'market_id','') is null or g2.market_id=(p_data->>'market_id')::uuid) and (nullif(p_data->>'job_id','') is null or g2.job_id=(p_data->>'job_id')::uuid)
   order by g2.created_at,g2.id limit n for update of g2 skip locked)
  update quizbox_sources.registry x set claim_token=gen_random_uuid(),claimed_by=auth.uid(),claimed_at=now() from picked where x.id=picked.id;
  return coalesce((select jsonb_agg(jsonb_build_object('id',g2.id,'token',g2.claim_token,'url',g2.canonical_url,'title',g2.title,'market_id',g2.market_id,
   'official_domains',(select official_domains from public.curriculum_authorities where id=g2.authority_id)))
   from quizbox_sources.registry g2 where g2.claimed_by=auth.uid() and g2.claimed_at>now()-interval '1 minute' and g2.status='IMPORTED' and g2.claim_token is not null),'[]');
 end if;

 if p_action in ('finish_fetch','fail_fetch') then
  select * into g from quizbox_sources.registry where id=(p_data->>'id')::uuid for update;
  if g.id is null or g.claim_token is distinct from nullif(p_data->>'token','')::uuid or g.claimed_by<>auth.uid() or g.status<>'IMPORTED' then raise exception 'QB_SOURCE_CLAIM_INVALID' using errcode='42501'; end if;
  if p_action='fail_fetch' then
   update quizbox_sources.registry set fetch_attempts=fetch_attempts+1,claim_token=null,claimed_at=null,
    last_error=case when coalesce(p_data->>'error_code','') ~ '^[A-Z][A-Z0-9_]{2,60}$' then p_data->>'error_code' else 'FETCH_FAILED' end,
    status=case when p_data->>'error_code' in ('NOT_A_PDF','PDF_NOT_FOUND') then 'DIRECT_PDF_PENDING' else status end where id=g.id returning * into g;
   perform quizbox_sources.log(g.id,g.package_id,g.job_id,'FETCH_FAILED',jsonb_build_object('error',g.last_error,'attempts',g.fetch_attempts));
   return quizbox_sources.registry_json(g);
  end if;
  if (p_data->>'sha256') !~ '^[0-9a-f]{64}$' or length(coalesce(p_data->>'text',''))<200 or length(p_data->>'text')>3000000 or coalesce(p_data->>'storage_path','') !~ ('^'||g.market_id||'/[0-9a-f-]{36}\.pdf$') then raise exception 'QB_SOURCE_FETCH_RESULT_INVALID'; end if;
  insert into public.source_documents(title,document_type,mime_type,checksum,ownership_type,rights_confirmed,status,metadata,storage_bucket,storage_path,market_id,curriculum_id,authority_id,source_kind,validation_status,uploaded_by,content_text)
  values(left(g.title,300),'curriculum','application/pdf',p_data->>'sha256','official_publication',false,'READY',
   jsonb_build_object('registry_id',g.id,'canonical_url',g.canonical_url,'education_level',g.education_level,'subject',g.subject_code,'package_id',g.package_id,'pages',(p_data->>'pages')::integer),
   'curriculum-sources',p_data->>'storage_path',g.market_id,g.curriculum_id,g.authority_id,'CURRICULUM','review',auth.uid(),p_data->>'text') returning id into doc;
  update quizbox_sources.registry set sha256=p_data->>'sha256',byte_size=(p_data->>'bytes')::integer,pages=(p_data->>'pages')::integer,storage_path=p_data->>'storage_path',
   source_document_id=doc,status='NEEDS_REVIEW',claim_token=null,claimed_at=null,last_error=null,fetch_attempts=fetch_attempts+1 where id=g.id returning * into g;
  perform quizbox_sources.log(g.id,g.package_id,g.job_id,'FETCHED',jsonb_build_object('sha256',g.sha256,'bytes',g.byte_size));
  perform quizbox_sources.log(g.id,g.package_id,g.job_id,'EXTRACTED',jsonb_build_object('pages',g.pages,'characters',length(p_data->>'text')));
  perform quizbox_sources.log(g.id,g.package_id,g.job_id,'MAPPED',jsonb_build_object('source_document_id',doc,'curriculum_id',g.curriculum_id,'level',g.education_level,'subject',g.subject_code));
  perform quizbox_sources.log(g.id,g.package_id,g.job_id,'NEEDS_REVIEW','{}');
  return quizbox_sources.registry_json(g);
 end if;

 select * into g from quizbox_sources.registry where id=(p_data->>'id')::uuid for update;
 if g.id is null or not quizbox_market.market_allowed(g.market_id) then raise exception 'QB_SOURCE_NOT_FOUND'; end if;

 if p_action='review' then
  if g.status<>'NEEDS_REVIEW' then raise exception 'QB_SOURCE_INVALID_TRANSITION'; end if;
  if length(trim(coalesce(p_data->>'note','')))<3 then raise exception 'QB_REVIEW_NOTE_REQUIRED'; end if;
  if p_data->>'decision'='approve' then
   -- Rights to use the official publication are attested by the reviewing Super Admin, never assumed by the importer.
   if coalesce((p_data->>'rights_confirmed')::boolean,false) is not true then raise exception 'QB_SOURCE_RIGHTS_ATTESTATION_REQUIRED'; end if;
   update public.source_documents set rights_confirmed=true where id=g.source_document_id;
   update quizbox_sources.registry set status='APPROVED',reviewed_by=auth.uid(),reviewed_at=now(),review_note=left(p_data->>'note',1000) where id=g.id returning * into g;
  elsif p_data->>'decision'='reject' then
   update public.source_documents set validation_status='rejected' where id=g.source_document_id;
   update quizbox_sources.registry set status='REJECTED',reviewed_by=auth.uid(),reviewed_at=now(),review_note=left(p_data->>'note',1000) where id=g.id returning * into g;
  else raise exception 'QB_INVALID_REVIEW_DECISION'; end if;
  perform quizbox_sources.log(g.id,g.package_id,g.job_id,g.status,jsonb_build_object('note',g.review_note));
  return quizbox_sources.registry_json(g);
 end if;

 if p_action='activate' then
  if g.status<>'APPROVED' or g.source_document_id is null then raise exception 'QB_SOURCE_INVALID_TRANSITION'; end if;
  -- A newer approved source for the same market/curriculum/level/subject supersedes the previous active one.
  for prev in select * from quizbox_sources.registry where market_id=g.market_id and curriculum_id=g.curriculum_id and education_level=g.education_level and subject_code=g.subject_code and status='ACTIVE' and id<>g.id for update loop
   update public.source_documents set validation_status='rejected' where id=prev.source_document_id and validation_status='approved';
   update quizbox_sources.registry set status='SUPERSEDED' where id=prev.id;
   perform quizbox_sources.log(prev.id,prev.package_id,prev.job_id,'SUPERSEDED',jsonb_build_object('by',g.id));
  end loop;
  update public.source_documents set validation_status='approved',approved_by=auth.uid() where id=g.source_document_id;
  update quizbox_sources.registry set status='ACTIVE' where id=g.id returning * into g;
  perform quizbox_sources.log(g.id,g.package_id,g.job_id,'ACTIVE','{}');
  return quizbox_sources.registry_json(g);
 end if;

 if p_action='set_direct_url' then
  if g.status<>'DIRECT_PDF_PENDING' then raise exception 'QB_SOURCE_INVALID_TRANSITION'; end if;
  host:=lower(substring(coalesce(p_data->>'url','') from '^https://([^/:]+)/\S+$'));
  if host is null or not exists(select 1 from public.curriculum_authorities a,unnest(a.official_domains) d where a.id=g.authority_id and (host=d or host like '%.'||d)) then raise exception 'QB_SOURCE_HOST_NOT_OFFICIAL'; end if;
  if length(trim(coalesce(p_data->>'note','')))<3 then raise exception 'QB_REVIEW_NOTE_REQUIRED'; end if;
  update quizbox_sources.registry set canonical_url=p_data->>'url',verification_status='VERIFIED',status='IMPORTED',fetch_attempts=0,last_error=null,review_note=left(p_data->>'note',1000) where id=g.id returning * into g;
  perform quizbox_sources.log(g.id,g.package_id,g.job_id,'DIRECT_URL_CONFIRMED',jsonb_build_object('url',g.canonical_url,'note',g.review_note));
  return quizbox_sources.registry_json(g);
 end if;
 raise exception 'QB_INVALID_SOURCE_ACTION';
end $$;

-- Content Factory source picker: approved curriculum sources of exactly one market and curriculum, with their
-- registry level/subject. Sources of any other market are never returned.
create function public.qb_content_factory_sources(p_market uuid,p_curriculum uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not quizbox_factory.can_manage() then raise exception 'QB_FACTORY_ACCESS_DENIED' using errcode='42501'; end if;
 if not quizbox_market.market_allowed(p_market) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'market_id',d.market_id,'curriculum_id',d.curriculum_id,'level',g.education_level,'subject',g.subject_code,'registry_status',g.status) order by g.education_level nulls last,g.subject_code nulls last,d.title)
  from public.source_documents d left join quizbox_sources.registry g on g.source_document_id=d.id
  where d.market_id=p_market and d.curriculum_id=p_curriculum and d.source_kind='CURRICULUM' and d.validation_status='approved' and d.approved_by is not null and d.rights_confirmed
   and (g.id is null or g.status='ACTIVE')),'[]');
end $$;

-- Campaign validation additionally refuses registry sources that are not ACTIVE or whose subject is outside the campaign.
create or replace function quizbox_factory.validate_campaign(c quizbox_factory.campaigns) returns void language plpgsql stable security definer set search_path='' as $$
declare sources uuid[]:=quizbox_factory.campaign_sources(c);
begin
 if not quizbox_market.market_allowed(c.market_id) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if;
 if not exists(select 1 from public.market_curricula mc join public.curricula k on k.id=mc.curriculum_id join public.curriculum_authorities a on a.id=mc.authority_id
  where mc.curriculum_id=c.curriculum_id and mc.market_id=c.market_id and k.market_id=c.market_id and mc.active and a.active and a.market_id=c.market_id) then raise exception 'QB_FACTORY_CURRICULUM_NOT_ACTIVE'; end if;
 if cardinality(sources) not between 1 and 100 then raise exception 'QB_FACTORY_SOURCES_REQUIRED'; end if;
 perform quizbox_market.validate_context('LOCAL_MARKET','CURRICULUM_ALIGNED',array[c.market_id],sources);
 if exists(select 1 from public.source_documents d where d.id=any(sources) and d.curriculum_id is distinct from c.curriculum_id) then raise exception 'QB_FACTORY_SOURCE_CURRICULUM_MISMATCH'; end if;
 if exists(select 1 from quizbox_sources.registry g where g.source_document_id=any(sources) and g.status<>'ACTIVE') then raise exception 'QB_FACTORY_SOURCE_NOT_ACTIVE'; end if;
 if jsonb_array_length(coalesce(c.source_scope->'subject_codes','[]'))>0 and exists(select 1 from quizbox_sources.registry g where g.source_document_id=any(sources) and not (c.source_scope->'subject_codes' ? g.subject_code)) then raise exception 'QB_FACTORY_SOURCE_SUBJECT_MISMATCH'; end if;
 if not quizbox_factory.valid_mix(c.difficulty_mix,array['easy','medium','hard']) or not quizbox_factory.valid_mix(c.cognitive_mix) or not quizbox_factory.valid_mix(c.question_types,array['SINGLE_CHOICE','TRUE_FALSE']) then raise exception 'QB_FACTORY_INVALID_MIX'; end if;
end $$;

-- Readiness: every active curriculum needs at least one approved (active) curriculum source; sources are summarised.
create or replace function quizbox_market.market_readiness(p_market uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.markets; b jsonb:='[]'; cfg jsonb; sources jsonb;
begin
 select * into m from public.markets where id=p_market; if m.id is null then raise exception 'MARKET_NOT_FOUND'; end if; cfg:=m.configuration;
 if not exists(select 1 from public.countries c where c.id=m.country_id and c.active) then b:=b||'"COUNTRY_NOT_CONFIGURED"'; end if;
 if not exists(select 1 from public.currencies c where c.code=m.default_currency_code and c.active) then b:=b||'"CURRENCY_NOT_CONFIGURED"'; end if;
 if nullif(m.timezone,'') is null or nullif(m.locale,'') is null then b:=b||'"LOCALE_OR_TIMEZONE_MISSING"'; end if;
 if not exists(select 1 from public.curriculum_authorities a where a.market_id=m.id and a.active) then b:=b||'"CURRICULUM_AUTHORITY_MISSING"'; end if;
 if not exists(select 1 from public.market_curricula mc join public.curricula c on c.id=mc.curriculum_id where mc.market_id=m.id and mc.active and mc.authority_id is not null
  and (c.effective_to is null or c.effective_to>=current_date)) then b:=b||'"ACTIVE_CURRICULUM_MISSING"'; end if;
 if coalesce(jsonb_array_length(cfg->'education_levels'),0)=0 then b:=b||'"EDUCATION_LEVELS_MISSING"'; end if;
 if coalesce(jsonb_array_length(cfg->'grades'),0)=0 then b:=b||'"GRADES_MISSING"'; end if;
 if coalesce(jsonb_array_length(cfg->'subjects'),0)=0 then b:=b||'"SUBJECTS_MISSING"'; end if;
 if not exists(select 1 from public.source_documents d where d.market_id=m.id and d.validation_status='approved' and d.rights_confirmed) then b:=b||'"APPROVED_SOURCE_MISSING"'; end if;
 if exists(select 1 from public.market_curricula mc where mc.market_id=m.id and mc.active and mc.authority_id is not null
  and not exists(select 1 from public.source_documents d where d.market_id=m.id and d.curriculum_id=mc.curriculum_id and d.source_kind='CURRICULUM' and d.validation_status='approved' and d.rights_confirmed)) then b:=b||'"CURRICULUM_SOURCE_MISSING"'; end if;
 if not exists(select 1 from public.user_market_memberships u join public.profiles p on p.id=u.user_id where u.market_id=m.id and u.active and lower(p.role::text) in ('admin','owner')) then b:=b||'"MARKET_ADMIN_MISSING"'; end if;
 select jsonb_build_object('active',(select count(*) from public.source_documents d where d.market_id=m.id and d.source_kind='CURRICULUM' and d.validation_status='approved' and d.rights_confirmed),
  'pending',(select count(*) from quizbox_sources.registry g where g.market_id=m.id and g.status in ('IMPORTED','FETCHED','EXTRACTED','MAPPED','NEEDS_REVIEW','APPROVED','DIRECT_PDF_PENDING')),
  'registered',(select count(*) from quizbox_sources.registry g where g.market_id=m.id),
  'by_curriculum',(select coalesce(jsonb_agg(jsonb_build_object('curriculum',k.code,'active',(select count(*) from public.source_documents d where d.market_id=m.id and d.curriculum_id=k.id and d.source_kind='CURRICULUM' and d.validation_status='approved' and d.rights_confirmed),
    'pending',(select count(*) from quizbox_sources.registry g where g.market_id=m.id and g.curriculum_id=k.id and g.status in ('IMPORTED','FETCHED','EXTRACTED','MAPPED','NEEDS_REVIEW','APPROVED','DIRECT_PDF_PENDING'))) order by k.code),'[]')
    from public.market_curricula mc join public.curricula k on k.id=mc.curriculum_id where mc.market_id=m.id and mc.active and mc.authority_id is not null)) into sources;
 return jsonb_build_object('market_id',m.id,'status',m.status,'ready',jsonb_array_length(b)=0,'blockers',b,'sources',sources,
  'sme_coverage',(select count(distinct d.reviewer_id) from public.sme_domain_assignments d join public.sme_profiles s on s.user_id=d.reviewer_id where d.active and s.active and s.reviewer_status='verified' and (d.market_id=m.id or d.market_id is null)));
end $$;

-- Private storage for fetched official curriculum files; only Super Admins can write or read them.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('curriculum-sources','curriculum-sources',false,52428800,array['application/pdf']) on conflict (id) do nothing;
create policy curriculum_sources_super_insert on storage.objects for insert to authenticated with check (bucket_id='curriculum-sources' and quizbox_market.is_super());
create policy curriculum_sources_super_read on storage.objects for select to authenticated using (bucket_id='curriculum-sources' and quizbox_market.is_super());

revoke all on all tables in schema quizbox_sources from public,anon,authenticated;
revoke all on all functions in schema quizbox_sources from public,anon,authenticated;
revoke all on function public.qb_curriculum_sources(text,jsonb),public.qb_content_factory_sources(uuid,uuid) from public,anon;
grant execute on function public.qb_curriculum_sources(text,jsonb),public.qb_content_factory_sources(uuid,uuid) to authenticated;

commit;
