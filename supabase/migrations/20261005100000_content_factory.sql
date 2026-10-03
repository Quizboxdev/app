-- Content Factory and SME Workforce Scheduler.
-- Campaigns plan and batch curriculum generation; every generated question still enters through the governed
-- ingest core (market context, validation, review state, hash de-duplication) and is reviewed through the
-- existing SME assignment/review/compensation RPCs. No second generation or review engine is introduced.
begin;

create schema quizbox_factory;
revoke all on schema quizbox_factory from public,anon,authenticated;

create table quizbox_factory.campaigns (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 3 and 160),
 market_id uuid not null references public.markets(id),
 curriculum_id uuid not null references public.curricula(id),
 -- {source_document_ids, subject_codes, grade_codes, education_levels, node_ids, weighting}
 source_scope jsonb not null default '{}' check (jsonb_typeof(source_scope)='object'),
 question_types jsonb not null default '{"SINGLE_CHOICE":100}' check (jsonb_typeof(question_types)='object'),
 difficulty_mix jsonb not null default '{"easy":30,"medium":50,"hard":20}' check (jsonb_typeof(difficulty_mix)='object'),
 cognitive_mix jsonb not null default '{"Recall":20,"Understanding":30,"Application":35,"Higher-order":15}' check (jsonb_typeof(cognitive_mix)='object'),
 language text not null default 'English' check (length(trim(language)) between 2 and 40),
 target_question_count integer not null check (target_question_count between 1 and 1000000),
 batch_size integer not null default 25 check (batch_size between 1 and 100),
 provider text not null check (length(trim(provider)) between 1 and 80),
 model text not null check (length(trim(model)) between 1 and 120),
 review_policy jsonb not null default '{"senior_review":false}' check (jsonb_typeof(review_policy)='object'),
 priority integer not null default 100 check (priority between 1 and 1000),
 max_jobs_per_execution integer not null default 5 check (max_jobs_per_execution between 1 and 10),
 retry_limit integer not null default 2 check (retry_limit between 0 and 5),
 pause_failure_threshold integer not null default 3 check (pause_failure_threshold between 1 and 100),
 large_campaign_threshold integer not null default 1000 check (large_campaign_threshold between 1 and 1000000),
 generated_count integer not null default 0, accepted_count integer not null default 0, rejected_count integer not null default 0,
 review_pending_count integer not null default 0, duplicate_flagged_count integer not null default 0, consecutive_failures integer not null default 0,
 status text not null default 'DRAFT' check (status in ('DRAFT','READY','RUNNING','PAUSED','COMPLETED','FAILED','CANCELLED')),
 generation_paused boolean not null default false, assignment_paused boolean not null default false,
 confirmed_by uuid references public.profiles(id), confirmed_at timestamptz,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 started_at timestamptz, completed_at timestamptz, updated_at timestamptz not null default now()
);
create table quizbox_factory.allocations (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references quizbox_factory.campaigns(id),
 node_id uuid not null references public.curriculum_nodes(id),
 subject_code text not null, grade_code text, education_level text, strand_title text, indicator_code text, indicator_title text,
 difficulty text not null check (difficulty in ('easy','medium','hard')), cognitive_level text not null, answer_type text not null check (answer_type in ('SINGLE_CHOICE','TRUE_FALSE')),
 planned_count integer not null check (planned_count>=0), target_count integer not null check (target_count between 0 and 1000000),
 adjusted_by uuid references public.profiles(id), adjusted_at timestamptz,
 unique (campaign_id,node_id,difficulty,cognitive_level,answer_type)
);
create table quizbox_factory.jobs (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references quizbox_factory.campaigns(id), allocation_id uuid not null references quizbox_factory.allocations(id),
 sequence integer not null, market_id uuid not null references public.markets(id), curriculum_id uuid not null references public.curricula(id),
 node_id uuid not null references public.curriculum_nodes(id), subject_code text not null, grade_code text, education_level text,
 difficulty text not null, cognitive_level text not null, answer_type text not null, source_document_ids uuid[] not null,
 requested_count integer not null check (requested_count between 1 and 100), provider text not null, model text not null,
 status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
 retry_count integer not null default 0, claim_token uuid, claimed_by uuid references public.profiles(id), claimed_at timestamptz,
 import_batch_id uuid references public.content_import_batches(id), candidate_ids uuid[] not null default '{}',
 valid_count integer not null default 0, rejected_count integer not null default 0, duplicate_count integer not null default 0,
 -- Exact (normalized) duplicates of existing questions are not accepted into the review pool; the existing question is referenced, never modified.
 duplicates_skipped jsonb not null default '[]',
 error_code text, created_at timestamptz not null default now(), completed_at timestamptz, updated_at timestamptz not null default now(),
 unique (campaign_id,sequence)
);
create table quizbox_factory.campaign_questions (
 question_id uuid primary key references public.questions(id), campaign_id uuid not null references quizbox_factory.campaigns(id),
 job_id uuid references quizbox_factory.jobs(id), origin text not null check (origin in ('AI_GENERATED','HUMAN_AUTHOR','IMPORTED')),
 created_at timestamptz not null default now()
);
-- Append-only operational audit for campaigns, plans, policies and scheduler decisions.
create table quizbox_factory.events (
 id bigint generated always as identity primary key, campaign_id uuid references quizbox_factory.campaigns(id),
 actor_id uuid references public.profiles(id), action text not null, entity text not null, entity_id uuid, details jsonb not null default '{}',
 created_at timestamptz not null default now()
);
create table quizbox_factory.workload_policies (
 id uuid primary key default gen_random_uuid(),
 reviewer_id uuid not null references public.sme_profiles(user_id),
 market_id uuid references public.markets(id), subject_code text, grade_codes text[] not null default '{}', education_level text,
 review_kind text not null default 'primary' check (review_kind in ('primary','senior')),
 assignment_mode text not null check (assignment_mode in ('FIXED_DAILY','TOP_UP_QUEUE','CAMPAIGN_ALLOCATION')),
 daily_limit integer check (daily_limit between 0 and 10000), target_open_queue integer check (target_open_queue between 0 and 10000),
 max_open_queue integer not null check (max_open_queue between 0 and 10000),
 working_days integer[] not null default '{1,2,3,4,5}' check (working_days <@ '{1,2,3,4,5,6,7}'::integer[] and cardinality(working_days) between 1 and 7),
 campaign_id uuid references quizbox_factory.campaigns(id), campaign_priority integer not null default 100 check (campaign_priority between 1 and 1000),
 allocation_quota integer check (allocation_quota between 0 and 1000000),
 effective_from timestamptz not null default now(), effective_to timestamptz,
 active boolean not null default true, paused boolean not null default false, pause_reason text,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (effective_to is null or effective_to>effective_from),
 check (assignment_mode<>'FIXED_DAILY' or daily_limit is not null),
 check (assignment_mode<>'TOP_UP_QUEUE' or (target_open_queue is not null and target_open_queue<=max_open_queue)),
 check (assignment_mode<>'CAMPAIGN_ALLOCATION' or campaign_id is not null)
);
create table quizbox_factory.scheduler_runs (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.profiles(id), dry_run boolean not null,
 started_at timestamptz not null default now(), finished_at timestamptz, summary jsonb not null default '{}'
);
create table quizbox_factory.assignment_events (
 id bigint generated always as identity primary key, run_id uuid references quizbox_factory.scheduler_runs(id),
 assignment_id uuid not null references public.sme_review_assignments(id), question_id uuid not null references public.questions(id),
 reviewer_id uuid not null references public.sme_profiles(user_id), policy_id uuid references quizbox_factory.workload_policies(id),
 campaign_id uuid references quizbox_factory.campaigns(id), action text not null check (action in ('ASSIGNED','RELEASED','REASSIGNED')),
 actor_id uuid not null references public.profiles(id), details jsonb not null default '{}', created_at timestamptz not null default now()
);
-- Releasing outstanding work closes the assignment without a review event: nothing becomes payable.
alter table public.sme_review_assignments add column released_at timestamptz, add column released_by uuid references public.profiles(id), add column release_reason text;

create index factory_campaigns_market on quizbox_factory.campaigns(market_id);
create index factory_campaigns_curriculum on quizbox_factory.campaigns(curriculum_id);
create index factory_campaigns_created_by on quizbox_factory.campaigns(created_by);
create index factory_campaigns_confirmed_by on quizbox_factory.campaigns(confirmed_by);
create index factory_allocations_node on quizbox_factory.allocations(node_id);
create index factory_allocations_adjusted_by on quizbox_factory.allocations(adjusted_by);
create index factory_jobs_queue on quizbox_factory.jobs(campaign_id,status,sequence);
create index factory_jobs_allocation on quizbox_factory.jobs(allocation_id);
create index factory_jobs_market on quizbox_factory.jobs(market_id);
create index factory_jobs_curriculum on quizbox_factory.jobs(curriculum_id);
create index factory_jobs_node on quizbox_factory.jobs(node_id);
create index factory_jobs_batch on quizbox_factory.jobs(import_batch_id);
create index factory_jobs_claimed_by on quizbox_factory.jobs(claimed_by);
create index factory_questions_campaign on quizbox_factory.campaign_questions(campaign_id,created_at);
create index factory_questions_job on quizbox_factory.campaign_questions(job_id);
create index factory_events_campaign on quizbox_factory.events(campaign_id,id desc);
create index factory_events_actor on quizbox_factory.events(actor_id);
create index factory_policies_reviewer on quizbox_factory.workload_policies(reviewer_id);
create index factory_policies_market on quizbox_factory.workload_policies(market_id);
create index factory_policies_campaign on quizbox_factory.workload_policies(campaign_id);
create index factory_policies_created_by on quizbox_factory.workload_policies(created_by);
create index factory_runs_actor on quizbox_factory.scheduler_runs(actor_id);
create index factory_assign_events_run on quizbox_factory.assignment_events(run_id);
create index factory_assign_events_assignment on quizbox_factory.assignment_events(assignment_id);
create index factory_assign_events_question on quizbox_factory.assignment_events(question_id);
create index factory_assign_events_reviewer on quizbox_factory.assignment_events(reviewer_id,created_at desc);
create index factory_assign_events_policy on quizbox_factory.assignment_events(policy_id);
create index factory_assign_events_campaign on quizbox_factory.assignment_events(campaign_id);
create index factory_assign_events_actor on quizbox_factory.assignment_events(actor_id);
create index sme_assignments_released_by on public.sme_review_assignments(released_by);

create trigger immutable_factory_events before update or delete on quizbox_factory.events for each row execute function quizbox_sme.immutable();
create trigger immutable_factory_assignment_events before update or delete on quizbox_factory.assignment_events for each row execute function quizbox_sme.immutable();

create function quizbox_factory.can_manage() returns boolean language sql stable security definer set search_path='' as $$ select quizbox_sme.has_capability('content_admin'); $$;
create function quizbox_factory.log(p_campaign uuid,p_action text,p_entity text,p_entity_id uuid,p_details jsonb default '{}') returns void language sql security definer set search_path='' as $$
 insert into quizbox_factory.events(campaign_id,actor_id,action,entity,entity_id,details) values(p_campaign,auth.uid(),p_action,p_entity,p_entity_id,coalesce(p_details,'{}'));
$$;
create function quizbox_factory.budget(p_operation text,p_limit integer,p_seconds integer) returns void language plpgsql security definer set search_path='' as $$
begin if not quizbox_private.consume_budget(p_operation,p_limit,p_seconds) then raise exception 'QB_RATE_LIMITED'; end if; end $$;

-- Largest-remainder apportionment: integer shares that always sum to p_total.
create function quizbox_factory.apportion(p_total integer,p_weights jsonb) returns table(key text,n integer) language plpgsql immutable set search_path='' as $$
begin
 return query
 with w as (select e.key as k,greatest(e.value::numeric,0) as wt from jsonb_each_text(p_weights) e),
 total as (select coalesce(sum(wt),0) as s from w),
 base as (select w.k,case when t.s>0 then floor(p_total*w.wt/t.s)::integer else 0 end as b,case when t.s>0 then p_total*w.wt/t.s-floor(p_total*w.wt/t.s) else 0 end as frac from w,total t),
 ranked as (select base.k,base.b,row_number() over(order by base.frac desc,base.k) as rn from base)
 select r.k,r.b+case when r.rn<=p_total-(select coalesce(sum(b),0) from base) then 1 else 0 end from ranked r;
end $$;

-- A mix is {label: percentage}; percentages are 0-100 and total exactly 100.
create function quizbox_factory.valid_mix(p_mix jsonb,p_allowed text[] default null) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(p_mix)='object' and (select count(*) from jsonb_object_keys(p_mix)) between 1 and 12
 and not exists(select 1 from jsonb_each(p_mix) e where jsonb_typeof(e.value)<>'number' or (e.value)::text::numeric<0 or (e.value)::text::numeric>100 or length(trim(e.key)) not between 1 and 40 or position('|' in e.key)>0 or (p_allowed is not null and not e.key=any(p_allowed)))
 and (select sum((e.value)::text::numeric) from jsonb_each(p_mix) e)=100;
$$;

create function quizbox_factory.campaign_sources(c quizbox_factory.campaigns) returns uuid[] language sql stable set search_path='' as $$
 select coalesce(array(select v::uuid from jsonb_array_elements_text(coalesce(c.source_scope->'source_document_ids','[]')) v),'{}');
$$;

-- Country-aware resolution: market -> active curriculum (with authority) -> approved curriculum sources of that curriculum.
create function quizbox_factory.validate_campaign(c quizbox_factory.campaigns) returns void language plpgsql stable security definer set search_path='' as $$
declare sources uuid[]:=quizbox_factory.campaign_sources(c);
begin
 if not quizbox_market.market_allowed(c.market_id) then raise exception 'QB_CONTENT_MARKET_DENIED' using errcode='42501'; end if;
 if not exists(select 1 from public.market_curricula mc join public.curricula k on k.id=mc.curriculum_id join public.curriculum_authorities a on a.id=mc.authority_id
  where mc.curriculum_id=c.curriculum_id and mc.market_id=c.market_id and k.market_id=c.market_id and mc.active and a.active and a.market_id=c.market_id) then raise exception 'QB_FACTORY_CURRICULUM_NOT_ACTIVE'; end if;
 if cardinality(sources) not between 1 and 100 then raise exception 'QB_FACTORY_SOURCES_REQUIRED'; end if;
 perform quizbox_market.validate_context('LOCAL_MARKET','CURRICULUM_ALIGNED',array[c.market_id],sources);
 if exists(select 1 from public.source_documents d where d.id=any(sources) and d.curriculum_id is distinct from c.curriculum_id) then raise exception 'QB_FACTORY_SOURCE_CURRICULUM_MISMATCH'; end if;
 if not quizbox_factory.valid_mix(c.difficulty_mix,array['easy','medium','hard']) or not quizbox_factory.valid_mix(c.cognitive_mix) or not quizbox_factory.valid_mix(c.question_types,array['SINGLE_CHOICE','TRUE_FALSE']) then raise exception 'QB_FACTORY_INVALID_MIX'; end if;
end $$;

-- The ingest core and the question guard read the caller's active content context. The factory uses the existing
-- explicit-context mechanism (validated LOCAL_MARKET / CURRICULUM_ALIGNED context with approved sources) and restores
-- the caller's previous context afterwards.
create function quizbox_factory.actor_context(p_market uuid,p_sources uuid[]) returns uuid language plpgsql security definer set search_path='' as $$
declare ctx uuid;
begin
 perform quizbox_market.validate_context('LOCAL_MARKET','CURRICULUM_ALIGNED',array[p_market],p_sources);
 select id into ctx from public.content_contexts where owner_user_id=auth.uid() and scope='LOCAL_MARKET' and source_mode='CURRICULUM_ALIGNED' and market_ids=array[p_market] and source_document_ids=p_sources limit 1;
 if ctx is null then
  insert into public.content_contexts(owner_user_id,scope,source_mode,market_ids,source_document_ids) values(auth.uid(),'LOCAL_MARKET','CURRICULUM_ALIGNED',array[p_market],p_sources) returning id into ctx;
 end if;
 return ctx;
end $$;

create function quizbox_factory.refresh_counts(p_campaign uuid) returns void language sql security definer set search_path='' as $$
 update quizbox_factory.campaigns c set generated_count=s.g,accepted_count=s.a,rejected_count=s.r,review_pending_count=s.p,duplicate_flagged_count=s.d,updated_at=now()
 from (select count(*) g,count(*) filter(where q.validation_status='approved') a,count(*) filter(where q.validation_status='rejected') r,
  count(*) filter(where coalesce(q.validation_status,'review') in ('draft','generated','review','needs_revision')) p,count(*) filter(where q.duplicate_group_id is not null) d
  from quizbox_factory.campaign_questions cq join public.questions q on q.id=cq.question_id where cq.campaign_id=p_campaign) s where c.id=p_campaign;
$$;
create function quizbox_factory.after_review_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.sme_review_assignments where id=new.assignment_id and released_at is not null) then raise exception 'QB_ASSIGNMENT_RELEASED'; end if;
 perform quizbox_factory.refresh_counts(cq.campaign_id) from quizbox_factory.campaign_questions cq where cq.question_id=new.question_id;
 return new;
end $$;
create trigger factory_review_counts after insert on public.sme_review_events for each row execute function quizbox_factory.after_review_event();

-- Distribution plan: indicators in scope -> per-indicator share -> difficulty x cognitive x type cells.
create function quizbox_factory.plan(p_campaign uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c quizbox_factory.campaigns; ind record; cell record; cells jsonb:='{}'; weights jsonb:='{}'; total integer; indicators integer;
begin
 select * into c from quizbox_factory.campaigns where id=p_campaign for update;
 if c.status not in ('DRAFT','READY') then raise exception 'QB_FACTORY_CAMPAIGN_LOCKED'; end if;
 perform quizbox_factory.validate_campaign(c);
 delete from quizbox_factory.allocations where campaign_id=c.id;
 create temporary table if not exists factory_scope(node_id uuid primary key,weight numeric,strand text) on commit drop;
 truncate factory_scope;
 with recursive leaves as (
  select n.* from public.curriculum_nodes n where n.curriculum_id=c.curriculum_id and n.is_active and n.node_type in ('learning_indicator','learning_objective')
   and (jsonb_array_length(coalesce(c.source_scope->'subject_codes','[]'))=0 or c.source_scope->'subject_codes' ? n.subject_code)
   and (jsonb_array_length(coalesce(c.source_scope->'grade_codes','[]'))=0 or c.source_scope->'grade_codes' ? coalesce(n.canonical_grade_code,n.grade_code))
   and (jsonb_array_length(coalesce(c.source_scope->'education_levels','[]'))=0 or c.source_scope->'education_levels' ? n.education_level)),
 ancestry(leaf,node,depth) as (select l.id,l.id,0 from leaves l union all select a.leaf,p.parent_id,a.depth+1 from ancestry a join public.curriculum_nodes p on p.id=a.node where p.parent_id is not null and a.depth<12)
 insert into factory_scope(node_id,weight,strand)
 select l.id,
  case when c.source_scope->>'weighting'='coverage_gap' then 1.0/(1+(select count(*) from public.questions q where q.curriculum_node_id=l.id and coalesce(q.validation_status,'review') in ('approved','review','needs_revision','draft','generated') and coalesce(q.source_type,'') not like 'DEV_%')) else 1 end,
  (select s.title from ancestry a join public.curriculum_nodes s on s.id=a.node where a.leaf=l.id and s.node_type='strand' order by a.depth limit 1)
 from leaves l
 where (jsonb_array_length(coalesce(c.source_scope->'node_ids','[]'))=0 and jsonb_array_length(coalesce(c.source_scope->'node_codes','[]'))=0)
  or exists(select 1 from ancestry a join public.curriculum_nodes x on x.id=a.node where a.leaf=l.id and (c.source_scope->'node_ids' ? a.node::text or coalesce(c.source_scope->'node_codes','[]') ? x.code));
 select count(*) into indicators from factory_scope;
 if indicators=0 then raise exception 'QB_FACTORY_EMPTY_SCOPE'; end if;
 select jsonb_object_agg(node_id::text,weight) into weights from factory_scope;
 select jsonb_object_agg(dk||'|'||ck||'|'||tk,dv::numeric*cv::numeric*tv::numeric) into cells
  from jsonb_each_text(c.difficulty_mix) as d(dk,dv),jsonb_each_text(c.cognitive_mix) as g(ck,cv),jsonb_each_text(c.question_types) as t(tk,tv);
 for ind in select a.key::uuid as node_id,a.n,s.strand from quizbox_factory.apportion(c.target_question_count,weights) a join factory_scope s on s.node_id=a.key::uuid where a.n>0 loop
  for cell in select key,n from quizbox_factory.apportion(ind.n,cells) where n>0 loop
   insert into quizbox_factory.allocations(campaign_id,node_id,subject_code,grade_code,education_level,strand_title,indicator_code,indicator_title,difficulty,cognitive_level,answer_type,planned_count,target_count)
   select c.id,n.id,n.subject_code,coalesce(n.canonical_grade_code,n.grade_code),n.education_level,ind.strand,n.code,n.title,split_part(cell.key,'|',1),split_part(cell.key,'|',2),split_part(cell.key,'|',3),cell.n,cell.n
   from public.curriculum_nodes n where n.id=ind.node_id;
  end loop;
 end loop;
 select coalesce(sum(target_count),0) into total from quizbox_factory.allocations where campaign_id=c.id;
 update quizbox_factory.campaigns set status=case when total=c.target_question_count then 'READY' else 'DRAFT' end,updated_at=now() where id=c.id;
 perform quizbox_factory.log(c.id,'PLAN_GENERATED','campaign',c.id,jsonb_build_object('indicators',indicators,'allocated',total));
 return jsonb_build_object('indicators',indicators,'allocated',total,'target',c.target_question_count);
end $$;

create function quizbox_factory.estimate(c quizbox_factory.campaigns) returns jsonb language sql stable security definer set search_path='' as $$
 with plan as (select coalesce(sum(ceil(target_count::numeric/c.batch_size)),0)::integer jobs,coalesce(sum(target_count),0)::integer allocated,count(distinct node_id) indicators from quizbox_factory.allocations where campaign_id=c.id)
 select jsonb_build_object('target_questions',c.target_question_count,'allocated_questions',p.allocated,'indicators',p.indicators,
  'expected_jobs',case when p.allocated>0 then p.jobs else ceil(c.target_question_count::numeric/c.batch_size)::integer end,'batch_size',c.batch_size,
  'executions_needed',ceil(greatest(case when p.allocated>0 then p.jobs else ceil(c.target_question_count::numeric/c.batch_size) end,1)::numeric/c.max_jobs_per_execution)::integer,
  'provider',c.provider,'model',c.model,'provider_calls',case when p.allocated>0 then p.jobs else ceil(c.target_question_count::numeric/c.batch_size)::integer end,
  'estimated_tokens',case when (c.review_policy->>'tokens_per_question') ~ '^[0-9]{1,6}$' then c.target_question_count*(c.review_policy->>'tokens_per_question')::integer end,
  'currency_cost',null,'cost_note','Provider pricing is not configured; no currency estimate is shown.',
  'estimated_primary_reviews',c.target_question_count,'estimated_senior_reviews',case when coalesce((c.review_policy->>'senior_review')::boolean,false) then c.target_question_count else 0 end,
  'large_campaign',c.target_question_count>=c.large_campaign_threshold,'confirmation_required',c.target_question_count>=c.large_campaign_threshold)
 from plan p;
$$;

create function quizbox_factory.campaign_json(c quizbox_factory.campaigns) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('market',(select name from public.markets where id=c.market_id),'curriculum',(select code from public.curricula where id=c.curriculum_id),
  'jobs',(select jsonb_build_object('total',count(*),'queued',count(*) filter(where status='QUEUED'),'running',count(*) filter(where status='RUNNING'),'completed',count(*) filter(where status='COMPLETED'),'failed',count(*) filter(where status='FAILED'),'cancelled',count(*) filter(where status='CANCELLED')) from quizbox_factory.jobs where campaign_id=c.id),
  'allocated',(select coalesce(sum(target_count),0) from quizbox_factory.allocations where campaign_id=c.id));
$$;

-- Content-admin campaign operations. Runner-facing actions (claim/finish/fail) are called by the server route.
create function public.qb_content_factory(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare c quizbox_factory.campaigns; cid uuid:=nullif(p_data->>'campaign_id','')::uuid; result jsonb; j quizbox_factory.jobs; ctx jsonb; ingest jsonb; batch uuid; total integer; n integer; cand jsonb; spec jsonb; prev_context uuid;
begin
 if auth.uid() is null or not quizbox_factory.can_manage() then raise exception 'QB_FACTORY_ACCESS_DENIED' using errcode='42501'; end if;
 if jsonb_typeof(coalesce(p_data,'{}'))<>'object' or octet_length(coalesce(p_data,'{}')::text)>1200000 then raise exception 'QB_INVALID_FACTORY_INPUT'; end if;
 if cid is not null then
  select * into c from quizbox_factory.campaigns where id=cid;
  if c.id is null or not quizbox_market.market_allowed(c.market_id) then raise exception 'QB_FACTORY_CAMPAIGN_NOT_FOUND' using errcode='42501'; end if;
 end if;

 if p_action='options' then
  return jsonb_build_object(
   'markets',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name),'[]') from public.markets m where quizbox_market.market_allowed(m.id) and m.active),
   'curricula',(select coalesce(jsonb_agg(jsonb_build_object('id',k.id,'code',k.code,'market_id',mc.market_id,'authority',a.code) order by k.code),'[]') from public.market_curricula mc join public.curricula k on k.id=mc.curriculum_id join public.curriculum_authorities a on a.id=mc.authority_id where mc.active and a.active and k.market_id=mc.market_id and quizbox_market.market_allowed(mc.market_id)),
   'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'market_id',d.market_id,'curriculum_id',d.curriculum_id) order by d.title),'[]') from public.source_documents d where d.source_kind='CURRICULUM' and d.validation_status='approved' and d.rights_confirmed and d.approved_by is not null and d.market_id is not null and quizbox_market.market_allowed(d.market_id)),
   'scope',case when nullif(p_data->>'curriculum_id','') is null then '[]'::jsonb else (select coalesce(jsonb_agg(distinct jsonb_build_object('subject',n.subject_code,'grade',coalesce(n.canonical_grade_code,n.grade_code),'level',n.education_level)),'[]') from public.curriculum_nodes n where n.curriculum_id=(p_data->>'curriculum_id')::uuid and n.is_active and n.node_type in ('learning_indicator','learning_objective')) end);
 end if;

 if p_action='list' then
  return coalesce((select jsonb_agg(quizbox_factory.campaign_json(x) order by x.created_at desc) from quizbox_factory.campaigns x where quizbox_market.market_allowed(x.market_id)),'[]');
 end if;

 if p_action in ('create','update') then
  if p_action='update' and (c.id is null or c.status not in ('DRAFT','READY')) then raise exception 'QB_FACTORY_CAMPAIGN_LOCKED'; end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('campaign_id','name','market_id','curriculum_id','source_scope','question_types','difficulty_mix','cognitive_mix','language','target_question_count','batch_size','provider','model','review_policy','priority','max_jobs_per_execution','retry_limit','pause_failure_threshold','large_campaign_threshold')) then raise exception 'QB_INVALID_FACTORY_FIELD'; end if;
  if p_action='create' then
   insert into quizbox_factory.campaigns(name,market_id,curriculum_id,source_scope,question_types,difficulty_mix,cognitive_mix,language,target_question_count,batch_size,provider,model,review_policy,priority,max_jobs_per_execution,retry_limit,pause_failure_threshold,large_campaign_threshold,created_by)
   values(p_data->>'name',(p_data->>'market_id')::uuid,(p_data->>'curriculum_id')::uuid,coalesce(p_data->'source_scope','{}'),coalesce(p_data->'question_types','{"SINGLE_CHOICE":100}'),coalesce(p_data->'difficulty_mix','{"easy":30,"medium":50,"hard":20}'),
    coalesce(p_data->'cognitive_mix','{"Recall":20,"Understanding":30,"Application":35,"Higher-order":15}'),coalesce(p_data->>'language','English'),(p_data->>'target_question_count')::integer,coalesce((p_data->>'batch_size')::integer,25),
    p_data->>'provider',p_data->>'model',coalesce(p_data->'review_policy','{"senior_review":false}'),coalesce((p_data->>'priority')::integer,100),coalesce((p_data->>'max_jobs_per_execution')::integer,5),coalesce((p_data->>'retry_limit')::integer,2),
    coalesce((p_data->>'pause_failure_threshold')::integer,3),coalesce((p_data->>'large_campaign_threshold')::integer,1000),auth.uid()) returning * into c;
  else
   update quizbox_factory.campaigns set name=coalesce(p_data->>'name',name),source_scope=coalesce(p_data->'source_scope',source_scope),question_types=coalesce(p_data->'question_types',question_types),
    difficulty_mix=coalesce(p_data->'difficulty_mix',difficulty_mix),cognitive_mix=coalesce(p_data->'cognitive_mix',cognitive_mix),language=coalesce(p_data->>'language',language),
    target_question_count=coalesce((p_data->>'target_question_count')::integer,target_question_count),batch_size=coalesce((p_data->>'batch_size')::integer,batch_size),
    provider=coalesce(p_data->>'provider',provider),model=coalesce(p_data->>'model',model),review_policy=coalesce(p_data->'review_policy',review_policy),priority=coalesce((p_data->>'priority')::integer,priority),
    max_jobs_per_execution=coalesce((p_data->>'max_jobs_per_execution')::integer,max_jobs_per_execution),retry_limit=coalesce((p_data->>'retry_limit')::integer,retry_limit),
    pause_failure_threshold=coalesce((p_data->>'pause_failure_threshold')::integer,pause_failure_threshold),large_campaign_threshold=coalesce((p_data->>'large_campaign_threshold')::integer,large_campaign_threshold),
    status='DRAFT',updated_at=now() where id=c.id returning * into c;
   -- Market/curriculum are fixed at creation; changing country content requires a new campaign.
   if p_data ? 'market_id' and (p_data->>'market_id')::uuid<>c.market_id or p_data ? 'curriculum_id' and (p_data->>'curriculum_id')::uuid<>c.curriculum_id then raise exception 'QB_FACTORY_MARKET_IMMUTABLE'; end if;
   delete from quizbox_factory.allocations where campaign_id=c.id;
  end if;
  perform quizbox_factory.validate_campaign(c);
  perform quizbox_factory.log(c.id,upper(p_action),'campaign',c.id,jsonb_build_object('target',c.target_question_count,'batch_size',c.batch_size));
  return quizbox_factory.campaign_json(c);
 end if;
 if c.id is null then raise exception 'QB_FACTORY_CAMPAIGN_REQUIRED'; end if;

 if p_action='get' then
  return quizbox_factory.campaign_json(c)||jsonb_build_object('estimate',quizbox_factory.estimate(c),
   'plan',coalesce((select jsonb_agg(to_jsonb(a) order by a.subject_code,a.grade_code,a.indicator_code,a.difficulty,a.cognitive_level) from (select * from quizbox_factory.allocations where campaign_id=c.id order by subject_code,grade_code,indicator_code,difficulty,cognitive_level limit least(coalesce((p_data->>'limit')::integer,500),2000)) a),'[]'),
   'plan_rows',(select count(*) from quizbox_factory.allocations where campaign_id=c.id),
   'events',coalesce((select jsonb_agg(jsonb_build_object('at',e.created_at,'action',e.action,'details',e.details) order by e.id desc) from (select * from quizbox_factory.events where campaign_id=c.id order by id desc limit 20) e),'[]'));
 end if;
 if p_action='plan' then return quizbox_factory.plan(c.id); end if;
 if p_action='estimate' then return quizbox_factory.estimate(c); end if;
 if p_action='adjust' then
  if c.status not in ('DRAFT','READY') then raise exception 'QB_FACTORY_CAMPAIGN_LOCKED'; end if;
  if jsonb_typeof(p_data->'allocations')<>'array' or jsonb_array_length(p_data->'allocations') not between 1 and 2000 then raise exception 'QB_INVALID_FACTORY_INPUT'; end if;
  update quizbox_factory.allocations a set target_count=(x->>'target_count')::integer,adjusted_by=auth.uid(),adjusted_at=now()
   from jsonb_array_elements(p_data->'allocations') x where a.id=(x->>'id')::uuid and a.campaign_id=c.id and (x->>'target_count')::integer between 0 and 1000000;
  get diagnostics n=row_count;
  if n<>jsonb_array_length(p_data->'allocations') then raise exception 'QB_FACTORY_ALLOCATION_MISMATCH'; end if;
  select coalesce(sum(target_count),0) into total from quizbox_factory.allocations where campaign_id=c.id;
  if coalesce((p_data->>'sync_target')::boolean,false) and total>0 then update quizbox_factory.campaigns set target_question_count=total where id=c.id; c.target_question_count:=total; end if;
  update quizbox_factory.campaigns set status=case when total=c.target_question_count then 'READY' else 'DRAFT' end,updated_at=now() where id=c.id;
  perform quizbox_factory.log(c.id,'PLAN_ADJUSTED','campaign',c.id,jsonb_build_object('rows',n,'allocated',total,'target',c.target_question_count));
  return jsonb_build_object('allocated',total,'target',c.target_question_count,'ready',total=c.target_question_count);
 end if;

 if p_action='start' then
  if c.status<>'READY' then raise exception 'QB_FACTORY_PLAN_NOT_READY'; end if;
  perform quizbox_factory.validate_campaign(c);
  select coalesce(sum(target_count),0) into total from quizbox_factory.allocations where campaign_id=c.id;
  if total<>c.target_question_count then raise exception 'QB_FACTORY_PLAN_NOT_READY'; end if;
  -- Large campaigns need an explicit, typed confirmation of the campaign name.
  if c.target_question_count>=c.large_campaign_threshold and coalesce(p_data->>'confirm','')<>c.name then raise exception 'QB_FACTORY_CONFIRMATION_REQUIRED'; end if;
  if (select sum(ceil(target_count::numeric/c.batch_size)) from quizbox_factory.allocations where campaign_id=c.id)>20000 then raise exception 'QB_FACTORY_TOO_MANY_JOBS'; end if;
  insert into quizbox_factory.jobs(campaign_id,allocation_id,sequence,market_id,curriculum_id,node_id,subject_code,grade_code,education_level,difficulty,cognitive_level,answer_type,source_document_ids,requested_count,provider,model)
  select c.id,a.id,row_number() over(order by part,a.subject_code,a.grade_code,a.indicator_code,a.difficulty,a.cognitive_level,a.answer_type),c.market_id,c.curriculum_id,a.node_id,a.subject_code,a.grade_code,a.education_level,
   a.difficulty,a.cognitive_level,a.answer_type,quizbox_factory.campaign_sources(c),least(c.batch_size,a.target_count-(part-1)*c.batch_size),c.provider,c.model
  from quizbox_factory.allocations a cross join lateral generate_series(1,ceil(a.target_count::numeric/c.batch_size)::integer) part where a.campaign_id=c.id and a.target_count>0;
  get diagnostics n=row_count;
  update quizbox_factory.campaigns set status='RUNNING',started_at=now(),generation_paused=false,confirmed_by=case when c.target_question_count>=c.large_campaign_threshold then auth.uid() end,
   confirmed_at=case when c.target_question_count>=c.large_campaign_threshold then now() end,updated_at=now() where id=c.id;
  perform quizbox_factory.log(c.id,'STARTED','campaign',c.id,jsonb_build_object('jobs',n,'confirmed',c.target_question_count>=c.large_campaign_threshold));
  return jsonb_build_object('status','RUNNING','jobs',n);
 end if;
 if p_action in ('pause','resume','stop_assignment','resume_assignment','cancel') then
  if p_action='pause' and c.status<>'RUNNING' or p_action='resume' and c.status<>'PAUSED' or p_action='cancel' and c.status not in ('DRAFT','READY','RUNNING','PAUSED') then raise exception 'QB_FACTORY_INVALID_TRANSITION'; end if;
  if p_action='pause' then update quizbox_factory.campaigns set status='PAUSED',generation_paused=true,updated_at=now() where id=c.id;
  elsif p_action='resume' then update quizbox_factory.campaigns set status='RUNNING',generation_paused=false,consecutive_failures=0,updated_at=now() where id=c.id;
  elsif p_action='stop_assignment' then update quizbox_factory.campaigns set assignment_paused=true,updated_at=now() where id=c.id;
  elsif p_action='resume_assignment' then update quizbox_factory.campaigns set assignment_paused=false,updated_at=now() where id=c.id;
  else
   -- Cancelling stops remaining generation only; generated and reviewed questions are untouched.
   update quizbox_factory.jobs set status='CANCELLED',updated_at=now() where campaign_id=c.id and status='QUEUED'; get diagnostics n=row_count;
   update quizbox_factory.campaigns set status='CANCELLED',generation_paused=true,completed_at=now(),updated_at=now() where id=c.id;
  end if;
  perform quizbox_factory.log(c.id,upper(p_action),'campaign',c.id,jsonb_build_object('cancelled_jobs',case when p_action='cancel' then n end));
  select * into c from quizbox_factory.campaigns where id=c.id; return quizbox_factory.campaign_json(c);
 end if;

 if p_action='claim_jobs' then
  if c.status<>'RUNNING' or c.generation_paused then raise exception 'QB_FACTORY_NOT_RUNNING'; end if;
  perform quizbox_factory.budget('qb_factory_claim',60,3600);
  -- Generation runs inside the caller's content context, so it must be this campaign's single market.
  ctx:=quizbox_market.resolve_context();
  if ctx->>'scope'<>'LOCAL_MARKET' or ctx->>'source_mode'<>'CURRICULUM_ALIGNED' or ctx->'market_ids'<>jsonb_build_array(c.market_id) then raise exception 'QB_FACTORY_SWITCH_MARKET_CONTEXT' using errcode='42501'; end if;
  -- Recover abandoned claims (counts as a retry).
  update quizbox_factory.jobs set status=case when retry_count+1>c.retry_limit then 'FAILED' else 'QUEUED' end,retry_count=retry_count+1,claim_token=null,error_code='CLAIM_EXPIRED',updated_at=now()
   where campaign_id=c.id and status='RUNNING' and claimed_at<now()-interval '15 minutes';
  n:=least(coalesce((p_data->>'limit')::integer,c.max_jobs_per_execution),c.max_jobs_per_execution);
  with picked as (select id from quizbox_factory.jobs where campaign_id=c.id and status='QUEUED' order by sequence limit n for update skip locked)
  update quizbox_factory.jobs x set status='RUNNING',claim_token=gen_random_uuid(),claimed_by=auth.uid(),claimed_at=now(),updated_at=now() from picked where x.id=picked.id;
  return coalesce((select jsonb_agg(jsonb_build_object('job_id',x.id,'token',x.claim_token,'provider',x.provider,'model',x.model,
   'spec',jsonb_build_object('indicatorId',n2.id,'indicatorCode',n2.code,'indicatorTitle',n2.title,'curriculumId',n2.curriculum_id,'educationLevel',coalesce(n2.education_level,''),'grade',coalesce(n2.canonical_grade_code,n2.grade_code),
    'subject',n2.subject_code,'difficulty',x.difficulty,'cognitiveLevel',x.cognitive_level,'answerType',x.answer_type,'count',x.requested_count,'language',c.language,'marks',1,'expectedSeconds',60,
    'provenance',jsonb_build_object('source','AI_GENERATED','provider',x.provider,'model',x.model,'sourceVersion','campaign:'||c.id),'sourceDocumentIds',to_jsonb(x.source_document_ids)),
   'node',jsonb_build_object('id',n2.id,'curriculum_id',n2.curriculum_id,'parent_id',n2.parent_id,'node_type',n2.node_type,'code',n2.code,'title',n2.title,'grade_code',n2.grade_code,'source_grade_code',n2.source_grade_code,'canonical_grade_code',n2.canonical_grade_code,'subject_code',n2.subject_code,'education_level',n2.education_level,'is_active',n2.is_active),
   'existing',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'text',q.question_text)),'[]') from (select id,question_text from public.questions where curriculum_node_id=x.node_id and coalesce(status::text,'')<>'archived' order by created_at desc limit 200) q)) order by x.sequence)
   from quizbox_factory.jobs x join public.curriculum_nodes n2 on n2.id=x.node_id where x.campaign_id=c.id and x.status='RUNNING' and x.claimed_by=auth.uid() and x.claimed_at>now()-interval '1 minute'),'[]');
 end if;

 if p_action in ('finish_job','fail_job') then
  select * into j from quizbox_factory.jobs where id=(p_data->>'job_id')::uuid and campaign_id=c.id for update;
  if j.id is null or j.status<>'RUNNING' or j.claim_token is distinct from nullif(p_data->>'token','')::uuid or j.claimed_by<>auth.uid() then raise exception 'QB_FACTORY_JOB_CLAIM_INVALID' using errcode='42501'; end if;
  if p_action='fail_job' then
   update quizbox_factory.jobs set status=case when retry_count+1>c.retry_limit then 'FAILED' else 'QUEUED' end,retry_count=retry_count+1,claim_token=null,
    error_code=case when coalesce(p_data->>'error_code','') ~ '^[A-Z][A-Z0-9_]{2,80}$' then p_data->>'error_code' else 'GENERATION_FAILED' end,updated_at=now() where id=j.id returning * into j;
   update quizbox_factory.campaigns set consecutive_failures=consecutive_failures+1,updated_at=now() where id=c.id returning * into c;
   if c.consecutive_failures>=c.pause_failure_threshold and c.status='RUNNING' then
    update quizbox_factory.campaigns set status='PAUSED',generation_paused=true where id=c.id;
    perform quizbox_factory.log(c.id,'AUTO_PAUSED','campaign',c.id,jsonb_build_object('consecutive_failures',c.consecutive_failures));
   end if;
   perform quizbox_factory.log(c.id,'JOB_FAILED','job',j.id,jsonb_build_object('error_code',j.error_code,'retry_count',j.retry_count,'status',j.status));
  else
   if p_data->>'provider' is distinct from j.provider or p_data->>'model' is distinct from j.model then raise exception 'QB_FACTORY_PROVIDER_MISMATCH'; end if;
   cand:=p_data->'candidates';
   if jsonb_typeof(cand)<>'array' or jsonb_array_length(cand)<>j.requested_count then raise exception 'QB_FACTORY_INVALID_OUTPUT'; end if;
   if exists(select 1 from jsonb_array_elements(cand) r where jsonb_typeof(r)<>'object' or r->>'curriculum_node_id' is distinct from j.node_id::text) then raise exception 'QB_FACTORY_MAPPING_MISMATCH'; end if;
   -- Identity and provenance are assigned server-side, never by the provider.
   select jsonb_agg(r.value||jsonb_build_object('external_question_id','QBF-'||j.id||'-'||r.ordinality,'difficulty_label',j.difficulty,'cognitive_level',j.cognitive_level) order by r.ordinality) into cand from jsonb_array_elements(cand) with ordinality as r(value,ordinality);
   -- Exact normalized duplicates of existing questions are recorded and kept out of the review pool.
   select coalesce(jsonb_agg(jsonb_build_object('index',r.ordinality-1,'question_id',q.id)),'[]') into result from jsonb_array_elements(cand) with ordinality as r(value,ordinality)
    join lateral (select x.id from public.questions x where x.text_hash=encode(extensions.digest(public.qb_factory_normalize(r.value->>'question_text'),'sha256'),'hex') limit 1) q on true;
   select jsonb_agg(r.value order by r.ordinality) into cand from jsonb_array_elements(cand) with ordinality as r(value,ordinality)
    where not exists(select 1 from jsonb_array_elements(result) d where (d->>'index')::integer=r.ordinality-1);
   spec:=jsonb_build_object('indicatorId',j.node_id,'indicatorCode',(select code from public.curriculum_nodes where id=j.node_id),'curriculumId',j.curriculum_id,'count',j.requested_count,
    'provenance',jsonb_build_object('source','AI_GENERATED','provider',j.provider,'model',j.model,'sourceVersion','campaign:'||c.id),'sourceDocumentIds',to_jsonb(j.source_document_ids));
   select active_content_context_id into prev_context from public.profiles where id=auth.uid();
   begin
    update public.profiles set active_content_context_id=quizbox_factory.actor_context(c.market_id,j.source_document_ids) where id=auth.uid();
    if cand is not null then ingest:=quizbox_private.core_qb_content_ingest(spec,cand,'campaign-'||c.id||'/job-'||j.sequence,j.provider,j.model); end if;
   exception when others then
    if sqlerrm in ('QB_CONTENT_RATE_LIMIT','QB_RATE_LIMITED') then
     update quizbox_factory.jobs set status='QUEUED',claim_token=null,updated_at=now() where id=j.id;
     return jsonb_build_object('job_id',j.id,'status','QUEUED','requeued','QB_CONTENT_RATE_LIMIT');
    end if;
    raise;
   end;
   batch:=nullif(ingest->>'batch_id','')::uuid;
   insert into quizbox_factory.campaign_questions(question_id,campaign_id,job_id,origin)
    select s.imported_question_id,c.id,j.id,'AI_GENERATED' from public.question_import_staging s where s.import_batch_id=batch and s.imported_question_id is not null on conflict(question_id) do nothing;
   -- Flag (never delete) near-duplicates reported by the runner and answer/option-signature collisions.
   update public.questions q set duplicate_group_id='near-'||(x->>'question_id')
    from jsonb_array_elements(coalesce(p_data->'near_duplicates','[]')) x join public.question_import_staging s on s.import_batch_id=batch and s.row_number=(x->>'index')::integer+1
    where q.id=s.imported_question_id and q.duplicate_group_id is null and exists(select 1 from public.questions o where o.id=(x->>'question_id')::uuid);
   update public.questions q set duplicate_group_id='sig-'||left(coalesce(q.answer_hash,q.option_signature),24)
    where q.id in (select imported_question_id from public.question_import_staging where import_batch_id=batch) and q.duplicate_group_id is null
    and exists(select 1 from public.questions o where o.id<>q.id and (o.answer_hash=q.answer_hash or o.option_signature=q.option_signature));
   update public.profiles set active_content_context_id=prev_context where id=auth.uid();
   update quizbox_factory.jobs set status='COMPLETED',claim_token=null,import_batch_id=batch,completed_at=now(),updated_at=now(),
    candidate_ids=array(select imported_question_id from public.question_import_staging where import_batch_id=batch and imported_question_id is not null order by row_number),
    valid_count=(select count(*) from public.question_import_staging where import_batch_id=batch and imported_question_id is not null),
    rejected_count=(select count(*) from public.question_import_staging where import_batch_id=batch and imported_question_id is null),
    duplicate_count=(select count(*) from public.questions where id in (select imported_question_id from public.question_import_staging where import_batch_id=batch) and duplicate_group_id is not null),
    duplicates_skipped=result
   where id=j.id returning * into j;
   update quizbox_factory.campaigns set consecutive_failures=0 where id=c.id;
   perform quizbox_factory.refresh_counts(c.id);
  end if;
  -- Campaign completes when no generation work remains.
  if not exists(select 1 from quizbox_factory.jobs where campaign_id=c.id and status in ('QUEUED','RUNNING')) then
   update quizbox_factory.campaigns set status=case when exists(select 1 from quizbox_factory.jobs where campaign_id=c.id and status='COMPLETED') then 'COMPLETED' else 'FAILED' end,completed_at=now(),updated_at=now()
    where id=c.id and status in ('RUNNING','PAUSED');
  end if;
  return jsonb_build_object('job_id',j.id,'status',j.status,'valid',j.valid_count,'rejected',j.rejected_count,'duplicates',j.duplicate_count,'duplicates_skipped',jsonb_array_length(j.duplicates_skipped),'retry_count',j.retry_count);
 end if;

 if p_action='jobs' then
  return coalesce((select jsonb_agg(to_jsonb(x)-'claim_token' order by x.sequence) from (select * from quizbox_factory.jobs where campaign_id=c.id and (coalesce(p_data->>'status','')='' or status=p_data->>'status') order by sequence limit 200) x),'[]');
 end if;

 if p_action in ('operations','coverage') then
  perform quizbox_factory.refresh_counts(c.id);
  select * into c from quizbox_factory.campaigns where id=c.id;
  with cq as (select q.*,cq.campaign_id,n.education_level lvl,exists(select 1 from public.sme_review_assignments w where w.question_id=q.id and w.review_completed_at is null) under_review
   from quizbox_factory.campaign_questions cq join public.questions q on q.id=cq.question_id left join public.curriculum_nodes n on n.id=q.curriculum_node_id where cq.campaign_id=c.id),
  alloc as (select node_id,subject_code,grade_code,education_level,strand_title,indicator_code,indicator_title,sum(target_count) target from quizbox_factory.allocations where campaign_id=c.id group by 1,2,3,4,5,6,7),
  per_node as (select a.*,(select count(*) from cq where cq.curriculum_node_id=a.node_id) generated,(select count(*) from cq where cq.curriculum_node_id=a.node_id and cq.validation_status='approved') approved from alloc a)
  select jsonb_build_object(
   'campaign',quizbox_factory.campaign_json(c),
   'totals',jsonb_build_object('target',c.target_question_count,'generated',(select count(*) from cq),
    'generation_failed_jobs',(select count(*) from quizbox_factory.jobs where campaign_id=c.id and status='FAILED'),
    'generation_failed_questions',(select coalesce(sum(requested_count),0) from quizbox_factory.jobs where campaign_id=c.id and status='FAILED'),
    'awaiting_review',(select count(*) from cq where validation_status in ('review','needs_revision') and not under_review),
    'under_review',(select count(*) from cq where under_review),'approved',(select count(*) from cq where validation_status='approved'),
    'rejected',(select count(*) from cq where validation_status='rejected'),'duplicates_flagged',(select count(*) from cq where duplicate_group_id is not null),
    'duplicates_not_accepted',(select coalesce(sum(jsonb_array_length(duplicates_skipped)),0) from quizbox_factory.jobs where campaign_id=c.id),
    'published',(select count(*) from cq where validation_status='approved' and status::text='active'),
    'coverage_percent',(select case when count(*)=0 then 0 else round(100.0*count(*) filter(where approved>0)/count(*),1) end from per_node),
    'target_percent',round(100.0*(select count(*) from cq where validation_status='approved')/greatest(c.target_question_count,1),1)),
   'by_market',(select jsonb_agg(jsonb_build_object('market',(select name from public.markets where id=c.market_id),'generated',(select count(*) from cq),'approved',(select count(*) from cq where validation_status='approved')))),
   'by_subject',(select coalesce(jsonb_agg(jsonb_build_object('subject',s,'target',t,'generated',g,'approved',a) order by s),'[]') from (select subject_code s,sum(target) t,sum(generated) g,sum(approved) a from per_node group by 1) x),
   'by_level',(select coalesce(jsonb_agg(jsonb_build_object('level',l,'grade',gr,'target',t,'generated',g,'approved',a) order by gr),'[]') from (select education_level l,grade_code gr,sum(target) t,sum(generated) g,sum(approved) a from per_node group by 1,2) x),
   'indicators',(select coalesce(jsonb_agg(jsonb_build_object('subject',subject_code,'level',education_level,'grade',grade_code,'strand',strand_title,'indicator',indicator_code,'title',indicator_title,'target',target,'generated',generated,'approved',approved,'gap',greatest(target-approved,0)) order by (target-approved) desc,indicator_code),'[]')
     from (select * from per_node where p_action='coverage' or approved<target order by (target-approved) desc limit case when p_action='coverage' then 2000 else 25 end) x),
   'sources',(select coalesce(jsonb_agg(jsonb_build_object('source_id',s,'title',(select title from public.source_documents where id=s),'jobs',k,'completed_jobs',done)),'[]') from (select unnest(source_document_ids) s,count(*) k,count(*) filter(where status='COMPLETED') done from quizbox_factory.jobs where campaign_id=c.id group by 1) x)
  ) into result;
  return result;
 end if;

 raise exception 'QB_INVALID_FACTORY_ACTION';
end $$;

-- Structured import and manual authoring: rows enter review through the same governed ingest core; never published.
create function public.qb_content_factory_import(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m uuid:=(p_data->>'market_id')::uuid; k uuid:=(p_data->>'curriculum_id')::uuid; cid uuid:=nullif(p_data->>'campaign_id','')::uuid; origin text:=coalesce(p_data->>'origin','IMPORTED');
 prev_context uuid; sources uuid[]; v_rows jsonb; prepared jsonb:='[]'; r jsonb; node public.curriculum_nodes; errors jsonb:='[]'; idx integer:=0; chunk jsonb; ingest jsonb; inserted integer:=0; rejected integer:=0; i integer;
begin
 if auth.uid() is null or not quizbox_factory.can_manage() then raise exception 'QB_FACTORY_ACCESS_DENIED' using errcode='42501'; end if;
 if origin not in ('IMPORTED','HUMAN_AUTHOR') then raise exception 'QB_INVALID_PROVENANCE'; end if;
 v_rows:=p_data->'rows';
 if jsonb_typeof(v_rows)<>'array' or jsonb_array_length(v_rows) not between 1 and 500 or octet_length(v_rows::text)>1000000 then raise exception 'QB_INVALID_BATCH'; end if;
 perform quizbox_factory.budget('qb_factory_import',30,3600);
 sources:=array(select v::uuid from jsonb_array_elements_text(coalesce(p_data->'source_document_ids','[]')) v);
 if cardinality(sources) not between 1 and 100 then raise exception 'QB_FACTORY_SOURCES_REQUIRED'; end if;
 if not exists(select 1 from public.market_curricula mc where mc.curriculum_id=k and mc.market_id=m and mc.active) then raise exception 'QB_FACTORY_CURRICULUM_NOT_ACTIVE'; end if;
 perform quizbox_market.validate_context('LOCAL_MARKET','CURRICULUM_ALIGNED',array[m],sources);
 if exists(select 1 from public.source_documents d where d.id=any(sources) and d.curriculum_id is distinct from k) then raise exception 'QB_FACTORY_SOURCE_CURRICULUM_MISMATCH'; end if;
 if cid is not null and not exists(select 1 from quizbox_factory.campaigns where id=cid and market_id=m and curriculum_id=k) then raise exception 'QB_FACTORY_CAMPAIGN_MISMATCH'; end if;
 for r in select value from jsonb_array_elements(v_rows) loop
  idx:=idx+1;
  select * into node from public.curriculum_nodes n where n.curriculum_id=k and n.is_active and n.node_type in ('learning_indicator','learning_objective')
   and (n.id::text=r->>'curriculum_node_id' or (n.code=r->>'indicator_code' and n.subject_code=r->>'subject')) limit 1;
  if node.id is null then errors:=errors||jsonb_build_object('row',idx,'code','QB_IMPORT_UNKNOWN_INDICATOR'); continue; end if;
  if nullif(r->>'subject','') is not null and r->>'subject'<>node.subject_code or nullif(r->>'grade','') is not null and r->>'grade'<>coalesce(node.canonical_grade_code,node.grade_code) then errors:=errors||jsonb_build_object('row',idx,'code','QB_IMPORT_SUBJECT_GRADE_MISMATCH'); continue; end if;
  if length(trim(coalesce(r->>'source_reference',''))) not between 3 and 300 then errors:=errors||jsonb_build_object('row',idx,'code','QB_IMPORT_PROVENANCE_REQUIRED'); continue; end if;
  if coalesce(r->>'answer_type','SINGLE_CHOICE') not in ('SINGLE_CHOICE','TRUE_FALSE') or coalesce(r->>'correct_answer','') not in ('A','B','C','D') then errors:=errors||jsonb_build_object('row',idx,'code','QB_IMPORT_ANSWER_FORMAT'); continue; end if;
  prepared:=prepared||jsonb_build_object('external_question_id',case when origin='HUMAN_AUTHOR' then 'QBM-' else 'QBI-' end||gen_random_uuid(),'curriculum_node_id',node.id,
   'question_text',r->>'question_text','answer_type',coalesce(r->>'answer_type','SINGLE_CHOICE'),'option_a',r->>'option_a','option_b',r->>'option_b','option_c',coalesce(r->>'option_c',''),'option_d',coalesce(r->>'option_d',''),
   'correct_answer',r->>'correct_answer','answer_spec',case when r->>'answer_type'='TRUE_FALSE' then jsonb_build_object('boolean',r->>'correct_answer'='A') else '{}'::jsonb end,
   'explanation',r->>'explanation','difficulty_label',coalesce(r->>'difficulty','medium'),'cognitive_level',coalesce(r->>'cognitive_level','Understanding'),'marks',1,'estimated_time_seconds',60,
   'tags',jsonb_build_array('source:'||left(r->>'source_reference',120)));
 end loop;
 select active_content_context_id into prev_context from public.profiles where id=auth.uid();
 update public.profiles set active_content_context_id=quizbox_factory.actor_context(m,sources) where id=auth.uid();
 for i in 0..greatest(jsonb_array_length(prepared)-1,0)/100 loop
  select jsonb_agg(e.value order by e.ordinality) into chunk from jsonb_array_elements(prepared) with ordinality as e(value,ordinality) where e.ordinality>i*100 and e.ordinality<=(i+1)*100;
  exit when chunk is null;
  ingest:=quizbox_private.core_qb_content_ingest(jsonb_build_object('indicatorId',chunk->0->>'curriculum_node_id','indicatorCode',(select code from public.curriculum_nodes where id=(chunk->0->>'curriculum_node_id')::uuid),'curriculumId',k,
    'provenance',jsonb_build_object('source',origin,'author',auth.uid()),'sourceDocumentIds',to_jsonb(sources)),chunk,case when origin='HUMAN_AUTHOR' then 'manual-authoring' else left(coalesce(p_data->>'file_name','import.csv'),200) end,case when origin='HUMAN_AUTHOR' then 'human' else 'structured-import' end,null);
  inserted:=inserted+coalesce((ingest->>'valid')::integer,0); rejected:=rejected+coalesce((ingest->>'rejected')::integer,0);
  if cid is not null then insert into quizbox_factory.campaign_questions(question_id,campaign_id,origin) select q.id,cid,origin from public.questions q where q.import_batch_id=(ingest->>'batch_id')::uuid on conflict do nothing; perform quizbox_factory.refresh_counts(cid); end if;
 end loop;
 update public.profiles set active_content_context_id=prev_context where id=auth.uid();
 perform quizbox_factory.log(cid,case when origin='HUMAN_AUTHOR' then 'MANUAL_AUTHORED' else 'IMPORTED' end,'import',null,jsonb_build_object('rows',jsonb_array_length(v_rows),'inserted',inserted,'rejected',rejected+jsonb_array_length(errors)));
 return jsonb_build_object('inserted',inserted,'rejected',rejected,'row_errors',errors,'state','review','published',0);
end $$;

-- ===================== SME workforce: workload policies and the assignment scheduler =====================
-- Capacity is derived from live assignment state, so repeated runs are idempotent (a full queue yields zero).
create function quizbox_factory.policy_capacity(p quizbox_factory.workload_policies,p_at timestamptz default now()) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare tz text; day_start timestamptz; outstanding integer; assigned_today integer; used integer; cap integer; reason text;
begin
 if p.id is null then return null; end if;
 select m.timezone into tz from public.markets m where m.id=p.market_id; tz:=coalesce(tz,'UTC');
 day_start:=date_trunc('day',p_at at time zone tz) at time zone tz;
 select count(*) into outstanding from public.sme_review_assignments where reviewer_id=p.reviewer_id and review_kind=p.review_kind and review_completed_at is null;
 select count(*) into assigned_today from public.sme_review_assignments where reviewer_id=p.reviewer_id and review_kind=p.review_kind and assigned_at>=day_start;
 if not p.active or p.paused then reason:='PAUSED'; cap:=0;
 elsif p_at<p.effective_from or (p.effective_to is not null and p_at>=p.effective_to) then reason:='NOT_EFFECTIVE'; cap:=0;
 elsif not (extract(isodow from p_at at time zone tz)::integer=any(p.working_days)) then reason:='NOT_WORKING_DAY'; cap:=0;
 else
  cap:=p.max_open_queue-outstanding;
  if p.daily_limit is not null then cap:=least(cap,p.daily_limit-assigned_today); end if;
  if p.assignment_mode='TOP_UP_QUEUE' then cap:=least(cap,p.target_open_queue-outstanding);
  elsif p.assignment_mode='CAMPAIGN_ALLOCATION' then
   select count(*) into used from quizbox_factory.assignment_events e join public.sme_review_assignments w on w.id=e.assignment_id where e.policy_id=p.id and e.action='ASSIGNED' and w.released_at is null;
   cap:=least(cap,coalesce(p.allocation_quota,0)-used);
  end if;
  cap:=greatest(cap,0); reason:=case when cap=0 then 'AT_CAPACITY' end;
 end if;
 return jsonb_build_object('capacity',cap,'outstanding',outstanding,'assigned_today',assigned_today,'reason',reason,'timezone',tz,'day_start',day_start);
end $$;

create function quizbox_factory.run_scheduler(p_dry boolean,p_campaign uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare run uuid; p quizbox_factory.workload_policies; cap jsonb; k integer; assigned integer; total integer:=0; errors jsonb; item record; work jsonb; v_summary jsonb:='[]'; candidates integer;
begin
 perform pg_advisory_xact_lock(hashtext('quizbox_factory.scheduler'));
 insert into quizbox_factory.scheduler_runs(actor_id,dry_run) values(auth.uid(),p_dry) returning id into run;
 for p in select x.* from quizbox_factory.workload_policies x join public.sme_profiles s on s.user_id=x.reviewer_id join public.profiles u on u.id=s.user_id
  where x.active and s.active and s.reviewer_status='verified' and lower(u.status::text)='active' and (p_campaign is null or x.campaign_id is null or x.campaign_id=p_campaign)
  order by x.campaign_priority desc,x.review_kind,x.created_at loop
  cap:=quizbox_factory.policy_capacity(p); k:=(cap->>'capacity')::integer; assigned:=0; errors:='[]'; candidates:=0;
  if k>0 then
   for item in
    select q.id as qid,cq.campaign_id,dm.id as domain,pe.id as prior from quizbox_factory.campaign_questions cq
    join quizbox_factory.campaigns c on c.id=cq.campaign_id join public.questions q on q.id=cq.question_id left join public.curriculum_nodes n on n.id=q.curriculum_node_id
    left join lateral (select e.id,e.reviewer_id,e.decision from public.sme_review_events e join public.sme_review_assignments a on a.id=e.assignment_id
     where e.question_id=q.id and a.question_version=q.version and a.review_kind='primary' order by e.review_completed_at desc limit 1) pe on p.review_kind='senior'
    cross join lateral (select d.id from public.sme_domain_assignments d where d.reviewer_id=p.reviewer_id and quizbox_sme.domain_matches(d.id,q.id,p.reviewer_id,c.market_id,p.review_kind='senior',false) order by d.created_at limit 1) dm
    where c.status in ('RUNNING','PAUSED','COMPLETED','CANCELLED') and not c.assignment_paused and (p_campaign is null or c.id=p_campaign)
     and (p.campaign_id is null or c.id=p.campaign_id) and (p.market_id is null or c.market_id=p.market_id) and (p.subject_code is null or q.subject_code=p.subject_code)
     and (cardinality(p.grade_codes)=0 or coalesce(q.canonical_grade_code,q.grade::text)=any(p.grade_codes)) and (p.education_level is null or n.education_level=p.education_level)
     and q.status::text<>'archived'
     and ((p.review_kind='primary' and q.validation_status='review'
       and not exists(select 1 from public.sme_review_assignments w where w.question_id=q.id and w.review_kind='primary' and (w.review_completed_at is null or (w.question_version=q.version and w.released_at is null)))
       and not exists(select 1 from public.sme_review_assignments w where w.question_id=q.id and w.question_version=q.version and w.reviewer_id=p.reviewer_id and w.review_kind='primary'))
      or (p.review_kind='senior' and coalesce((c.review_policy->>'senior_review')::boolean,false) and q.validation_status='approved' and q.status::text<>'active'
       and pe.decision='approve' and pe.reviewer_id<>p.reviewer_id
       and not exists(select 1 from public.sme_review_assignments w where w.question_id=q.id and w.question_version=q.version and w.review_kind='senior' and w.released_at is null)))
    order by c.priority desc,cq.created_at,q.id limit k
   loop
    candidates:=candidates+1;
    if not p_dry then
     begin
      work:=public.qb_sme_assign_review(item.qid,p.reviewer_id,item.domain,p.review_kind,null,item.prior);
      insert into quizbox_factory.assignment_events(run_id,assignment_id,question_id,reviewer_id,policy_id,campaign_id,action,actor_id,details)
       values(run,(work->>'id')::uuid,item.qid,p.reviewer_id,p.id,item.campaign_id,'ASSIGNED',auth.uid(),jsonb_build_object('mode',p.assignment_mode,'kind',p.review_kind));
      assigned:=assigned+1;
     exception when others then
      errors:=errors||to_jsonb(case when sqlerrm ~ '^[A-Z][A-Z_0-9]{2,80}$' then sqlerrm else 'ASSIGNMENT_FAILED' end);
     end;
    end if;
   end loop;
  end if;
  total:=total+assigned;
  v_summary:=v_summary||jsonb_build_object('policy_id',p.id,'reviewer_id',p.reviewer_id,'reviewer',(select full_name from public.profiles where id=p.reviewer_id),'mode',p.assignment_mode,'kind',p.review_kind,
   'capacity',k,'outstanding_before',(cap->>'outstanding')::integer,'assigned_today_before',(cap->>'assigned_today')::integer,'eligible',candidates,'assigned',assigned,'reason',cap->>'reason',
   'errors',(select coalesce(jsonb_agg(distinct v),'[]') from jsonb_array_elements(errors) v));
 end loop;
 update quizbox_factory.scheduler_runs set finished_at=now(),summary=jsonb_build_object('assigned',total,'policies',v_summary) where id=run;
 return jsonb_build_object('run_id',run,'dry_run',p_dry,'assigned',total,'policies',v_summary);
end $$;

create function quizbox_factory.release_assignment(p_assignment uuid,p_reason text) returns uuid language plpgsql security definer set search_path='' as $$
declare w public.sme_review_assignments;
begin
 update public.sme_review_assignments set review_completed_at=now(),released_at=now(),released_by=auth.uid(),release_reason=left(p_reason,300)
  where id=p_assignment and review_completed_at is null returning * into w;
 if w.id is null then raise exception 'QB_ASSIGNMENT_NOT_OUTSTANDING'; end if;
 insert into quizbox_factory.assignment_events(assignment_id,question_id,reviewer_id,campaign_id,action,actor_id,details)
  values(w.id,w.question_id,w.reviewer_id,(select campaign_id from quizbox_factory.campaign_questions where question_id=w.question_id),'RELEASED',auth.uid(),jsonb_build_object('reason',left(p_reason,300)));
 return w.id;
end $$;

create function quizbox_factory.reviewer_metrics(p_reviewer uuid,p_since timestamptz) returns jsonb language sql stable security definer set search_path='' as $$
 with ev as (select * from public.sme_review_events e where e.reviewer_id=p_reviewer and e.review_completed_at>=p_since),
 rev as (select count(*) n from public.sme_review_events s join public.sme_review_assignments a on a.id=s.assignment_id join public.sme_review_events prior on prior.id=a.prior_review_event_id
  where prior.reviewer_id=p_reviewer and s.qa_reversal and s.review_completed_at>=p_since)
 select jsonb_build_object('completed',(select count(*) from ev),'approved',(select count(*) from ev where decision='approve'),'revisions',(select count(*) from ev where decision='revision'),
  'rejected',(select count(*) from ev where decision='reject'),'qa_reversals',(select n from rev),'disputes',(select count(*) from ev where dispute),
  'average_review_seconds',(select round(avg(review_duration_seconds)) from ev),
  'revision_rate',(select case when count(*)>0 then round(100.0*count(*) filter(where decision='revision')/count(*),1) else 0 end from ev),
  'qa_reversal_rate',(select case when count(*)>0 then round(100.0*(select n from rev)/count(*),1) else 0 end from ev));
$$;
create function quizbox_factory.reviewer_money(p_reviewer uuid,p_status text[],p_since timestamptz default '-infinity') returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(currency_code,amount),'{}') from (select currency_code,sum(final_amount::numeric)::text amount from public.sme_earnings_current
  where reviewer_id=p_reviewer and current_status=any(p_status) and earned_at>=p_since group by 1) x;
$$;

create function public.qb_sme_workforce(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare pol quizbox_factory.workload_policies; before jsonb; result jsonb; n integer; w public.sme_review_assignments; dom uuid; work jsonb; tz text; day_start timestamptz; month_start timestamptz; weights jsonb; total integer; cid uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if jsonb_typeof(coalesce(p_data,'{}'))<>'object' or octet_length(coalesce(p_data,'{}')::text)>50000 then raise exception 'QB_INVALID_WORKFORCE_INPUT'; end if;

 if p_action='my_dashboard' then
  if not exists(select 1 from public.sme_profiles where user_id=auth.uid()) then raise exception 'QB_SME_PROFILE_REQUIRED' using errcode='42501'; end if;
  select * into pol from quizbox_factory.workload_policies where reviewer_id=auth.uid() and active and review_kind='primary' order by paused,created_at desc limit 1;
  select m.timezone into tz from public.markets m where m.id=pol.market_id; tz:=coalesce(tz,'UTC');
  day_start:=date_trunc('day',now() at time zone tz) at time zone tz; month_start:=date_trunc('month',now() at time zone tz) at time zone tz;
  return jsonb_build_object(
   'policy',case when pol.id is null then null else jsonb_build_object('mode',pol.assignment_mode,'daily_limit',pol.daily_limit,'target_open_queue',pol.target_open_queue,'max_open_queue',pol.max_open_queue,'paused',pol.paused,'working_days',pol.working_days) end,
   'today',jsonb_build_object('assigned',(select count(*) from public.sme_review_assignments where reviewer_id=auth.uid() and assigned_at>=day_start and released_at is null),
    'remaining_capacity',case when pol.id is null then null else (quizbox_factory.policy_capacity(pol)->>'capacity')::integer end,
    'outstanding',(select count(*) from public.sme_review_assignments where reviewer_id=auth.uid() and review_completed_at is null),
    'completed',(select count(*) from public.sme_review_events where reviewer_id=auth.uid() and review_completed_at>=day_start),
    'earned',quizbox_factory.reviewer_money(auth.uid(),array['pending_qa','payable','held','paid'],day_start)),
   'month',quizbox_factory.reviewer_metrics(auth.uid(),month_start)||jsonb_build_object('payable',quizbox_factory.reviewer_money(auth.uid(),array['payable']),'paid',quizbox_factory.reviewer_money(auth.uid(),array['paid']),
    'pending_qa',quizbox_factory.reviewer_money(auth.uid(),array['pending_qa','held']),
    'compensation_unresolved',(select count(*) from public.sme_review_events e where e.reviewer_id=auth.uid() and not exists(select 1 from public.reviewer_earnings r where r.review_event_id=e.id))));
 end if;

 if not quizbox_factory.can_manage() then raise exception 'QB_WORKFORCE_ACCESS_DENIED' using errcode='42501'; end if;

 if p_action='reviewers' then
  return coalesce((select jsonb_agg(jsonb_build_object('reviewer_id',s.user_id,'name',u.full_name,'status',s.reviewer_status,'tier',s.reviewer_tier,
   'domains',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'subject',d.subject_code,'market',(select name from public.markets where id=d.market_id),'market_id',d.market_id,'grades',d.grade_codes,'level',d.education_level,'can_approve',d.can_approve,'can_senior_review',d.can_senior_review)),'[]') from public.sme_domain_assignments d where d.reviewer_id=s.user_id and d.active))
   order by u.full_name) from public.sme_profiles s join public.profiles u on u.id=s.user_id where s.active),'[]');
 end if;
 if p_action='policies' then
  return coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('reviewer',(select full_name from public.profiles where id=x.reviewer_id),'market',(select name from public.markets where id=x.market_id),'state',quizbox_factory.policy_capacity(x)) order by x.created_at)
   from quizbox_factory.workload_policies x where (nullif(p_data->>'reviewer_id','') is null or x.reviewer_id=(p_data->>'reviewer_id')::uuid)),'[]');
 end if;
 if p_action='save_policy' then
  if not quizbox_sme.has_capability('super_admin') then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('id','reviewer_id','market_id','subject_code','grade_codes','education_level','review_kind','assignment_mode','daily_limit','target_open_queue','max_open_queue','working_days','campaign_id','campaign_priority','effective_from','effective_to','active')) then raise exception 'QB_INVALID_WORKFORCE_FIELD'; end if;
  -- A workload policy can never widen authorization: it must sit inside an active reviewer domain.
  if not exists(select 1 from public.sme_domain_assignments d where d.reviewer_id=(p_data->>'reviewer_id')::uuid and d.active and d.can_review
   and (nullif(p_data->>'subject_code','') is null or d.subject_code=p_data->>'subject_code') and (d.market_id is null or (nullif(p_data->>'market_id','') is not null and d.market_id=(p_data->>'market_id')::uuid))
   and (coalesce(p_data->>'review_kind','primary')<>'senior' or d.can_senior_review)) then raise exception 'QB_POLICY_OUTSIDE_AUTHORIZATION'; end if;
  if nullif(p_data->>'id','') is not null then
   select * into pol from quizbox_factory.workload_policies where id=(p_data->>'id')::uuid for update; before:=to_jsonb(pol);
   if pol.id is null then raise exception 'QB_POLICY_NOT_FOUND'; end if;
   if pol.reviewer_id<>(p_data->>'reviewer_id')::uuid then raise exception 'QB_POLICY_REVIEWER_IMMUTABLE'; end if;
  end if;
  insert into quizbox_factory.workload_policies(id,reviewer_id,market_id,subject_code,grade_codes,education_level,review_kind,assignment_mode,daily_limit,target_open_queue,max_open_queue,working_days,campaign_id,campaign_priority,effective_from,effective_to,active,created_by)
  values(coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid()),(p_data->>'reviewer_id')::uuid,nullif(p_data->>'market_id','')::uuid,nullif(p_data->>'subject_code',''),
   coalesce(array(select jsonb_array_elements_text(coalesce(p_data->'grade_codes','[]'))),'{}'),nullif(p_data->>'education_level',''),coalesce(p_data->>'review_kind','primary'),p_data->>'assignment_mode',
   (p_data->>'daily_limit')::integer,(p_data->>'target_open_queue')::integer,(p_data->>'max_open_queue')::integer,
   case when jsonb_typeof(p_data->'working_days')='array' then array(select v::integer from jsonb_array_elements_text(p_data->'working_days') v) else '{1,2,3,4,5}'::integer[] end,
   nullif(p_data->>'campaign_id','')::uuid,coalesce((p_data->>'campaign_priority')::integer,100),coalesce((p_data->>'effective_from')::timestamptz,now()),(p_data->>'effective_to')::timestamptz,coalesce((p_data->>'active')::boolean,true),auth.uid())
  on conflict(id) do update set market_id=excluded.market_id,subject_code=excluded.subject_code,grade_codes=excluded.grade_codes,education_level=excluded.education_level,review_kind=excluded.review_kind,
   assignment_mode=excluded.assignment_mode,daily_limit=excluded.daily_limit,target_open_queue=excluded.target_open_queue,max_open_queue=excluded.max_open_queue,working_days=excluded.working_days,
   campaign_id=excluded.campaign_id,campaign_priority=excluded.campaign_priority,effective_from=excluded.effective_from,effective_to=excluded.effective_to,active=excluded.active,updated_at=now()
  returning * into pol;
  perform quizbox_factory.log(pol.campaign_id,case when before is null then 'POLICY_CREATED' else 'POLICY_UPDATED' end,'workload_policy',pol.id,jsonb_build_object('before',before,'after',to_jsonb(pol)));
  return to_jsonb(pol);
 end if;
 if p_action='set_limits' then
  select * into pol from quizbox_factory.workload_policies where id=(p_data->>'policy_id')::uuid for update; if pol.id is null then raise exception 'QB_POLICY_NOT_FOUND'; end if; before:=to_jsonb(pol);
  update quizbox_factory.workload_policies set daily_limit=case when p_data ? 'daily_limit' then (p_data->>'daily_limit')::integer else daily_limit end,
   target_open_queue=case when p_data ? 'target_open_queue' then (p_data->>'target_open_queue')::integer else target_open_queue end,
   max_open_queue=coalesce((p_data->>'max_open_queue')::integer,max_open_queue),updated_at=now() where id=pol.id returning * into pol;
  perform quizbox_factory.log(pol.campaign_id,'POLICY_LIMITS_CHANGED','workload_policy',pol.id,jsonb_build_object('before',before,'after',to_jsonb(pol)));
  return to_jsonb(pol);
 end if;
 if p_action='pause_reviewer' then
  update quizbox_factory.workload_policies set paused=coalesce((p_data->>'paused')::boolean,true),pause_reason=left(p_data->>'reason',300),updated_at=now() where reviewer_id=(p_data->>'reviewer_id')::uuid;
  get diagnostics n=row_count;
  perform quizbox_factory.log(null,case when coalesce((p_data->>'paused')::boolean,true) then 'REVIEWER_PAUSED' else 'REVIEWER_RESUMED' end,'reviewer',(p_data->>'reviewer_id')::uuid,jsonb_build_object('policies',n,'reason',left(p_data->>'reason',300)));
  return jsonb_build_object('policies',n);
 end if;
 if p_action='set_campaign_priority' then
  update quizbox_factory.campaigns set priority=(p_data->>'priority')::integer,updated_at=now() where id=(p_data->>'campaign_id')::uuid and quizbox_market.market_allowed(market_id) returning id into cid;
  if cid is null then raise exception 'QB_FACTORY_CAMPAIGN_NOT_FOUND'; end if;
  perform quizbox_factory.log(cid,'PRIORITY_CHANGED','campaign',cid,jsonb_build_object('priority',(p_data->>'priority')::integer));
  return jsonb_build_object('campaign_id',cid,'priority',(p_data->>'priority')::integer);
 end if;
 if p_action='allocate' then
  -- CAMPAIGN_ALLOCATION: split a total across the campaign's eligible policies by configured capacity.
  cid:=(p_data->>'campaign_id')::uuid; total:=(p_data->>'total')::integer;
  if total is null or total<0 or not exists(select 1 from quizbox_factory.campaigns where id=cid and quizbox_market.market_allowed(market_id)) then raise exception 'QB_INVALID_ALLOCATION'; end if;
  select jsonb_object_agg(x.id::text,coalesce(x.daily_limit,x.max_open_queue)) into weights from quizbox_factory.workload_policies x
   where x.campaign_id=cid and x.assignment_mode='CAMPAIGN_ALLOCATION' and x.active and not x.paused and (nullif(p_data->>'subject_code','') is null or x.subject_code=p_data->>'subject_code');
  if weights is null then raise exception 'QB_NO_ALLOCATION_POLICIES'; end if;
  update quizbox_factory.workload_policies x set allocation_quota=a.n,updated_at=now() from quizbox_factory.apportion(total,weights) a where x.id=a.key::uuid;
  select jsonb_object_agg(a.key,a.n) into result from quizbox_factory.apportion(total,weights) a;
  perform quizbox_factory.log(cid,'ALLOCATED','campaign',cid,jsonb_build_object('total',total,'shares',result));
  return result;
 end if;
 if p_action='run_scheduler' then
  perform quizbox_factory.budget('qb_sme_scheduler',120,3600);
  return quizbox_factory.run_scheduler(coalesce((p_data->>'dry_run')::boolean,false),nullif(p_data->>'campaign_id','')::uuid);
 end if;
 if p_action='reassign' then
  n:=0; result:='[]';
  for w in select * from public.sme_review_assignments where review_completed_at is null and (
    (jsonb_typeof(p_data->'assignment_ids')='array' and id::text in (select jsonb_array_elements_text(p_data->'assignment_ids')))
    or (nullif(p_data->>'reviewer_id','') is not null and coalesce((p_data->>'all_outstanding')::boolean,false) and reviewer_id=(p_data->>'reviewer_id')::uuid)) limit 500 loop
   perform quizbox_factory.release_assignment(w.id,coalesce(p_data->>'reason','Reassigned by admin'));
   n:=n+1;
   if nullif(p_data->>'to_reviewer_id','') is not null then
    dom:=null;
    select d.id into dom from public.sme_domain_assignments d where d.reviewer_id=(p_data->>'to_reviewer_id')::uuid and quizbox_sme.domain_matches(d.id,w.question_id,(p_data->>'to_reviewer_id')::uuid,w.market_id,w.review_kind='senior',false) limit 1;
    if dom is null then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
    work:=public.qb_sme_assign_review(w.question_id,(p_data->>'to_reviewer_id')::uuid,dom,w.review_kind,w.sponsor_id,w.prior_review_event_id);
    insert into quizbox_factory.assignment_events(assignment_id,question_id,reviewer_id,campaign_id,action,actor_id,details)
     values((work->>'id')::uuid,w.question_id,(p_data->>'to_reviewer_id')::uuid,(select campaign_id from quizbox_factory.campaign_questions where question_id=w.question_id),'REASSIGNED',auth.uid(),jsonb_build_object('from_assignment',w.id,'from_reviewer',w.reviewer_id));
    result:=result||jsonb_build_object('from',w.id,'to',work->>'id');
   end if;
  end loop;
  return jsonb_build_object('released',n,'reassigned',result);
 end if;
 if p_action='runs' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'at',r.started_at,'dry_run',r.dry_run,'actor',(select full_name from public.profiles where id=r.actor_id),'assigned',r.summary->'assigned') order by r.started_at desc) from (select * from quizbox_factory.scheduler_runs order by started_at desc limit 20) r),'[]');
 end if;
 if p_action='dashboard' then
  month_start:=date_trunc('month',now());
  return coalesce((select jsonb_agg(d.row_data order by d.row_data->>'reviewer') from (
   select jsonb_build_object('reviewer_id',s.user_id,'reviewer',u.full_name,'status',case when pol2.paused then 'paused' when pol2.id is null then 'no_policy' else 'active' end,
    'market',coalesce((select name from public.markets where id=pol2.market_id),(select string_agg(distinct coalesce(m.name,'All markets'),', ') from public.sme_domain_assignments d left join public.markets m on m.id=d.market_id where d.reviewer_id=s.user_id and d.active)),
    'subject',coalesce(pol2.subject_code,(select string_agg(distinct d.subject_code,', ') from public.sme_domain_assignments d where d.reviewer_id=s.user_id and d.active)),
    'policy_id',pol2.id,'mode',pol2.assignment_mode,'daily_limit',pol2.daily_limit,'target_queue',pol2.target_open_queue,'max_queue',pol2.max_open_queue,
    'assigned_today',(select count(*) from public.sme_review_assignments where reviewer_id=s.user_id and released_at is null and assigned_at>=coalesce((st.state->>'day_start')::timestamptz,date_trunc('day',now()))),
    'outstanding',(select count(*) from public.sme_review_assignments where reviewer_id=s.user_id and review_completed_at is null),
    'completed_today',(select count(*) from public.sme_review_events where reviewer_id=s.user_id and review_completed_at>=coalesce((st.state->>'day_start')::timestamptz,date_trunc('day',now()))),
    'month',quizbox_factory.reviewer_metrics(s.user_id,month_start),
    'compensation_unresolved',(select count(*) from public.sme_review_events e where e.reviewer_id=s.user_id and not exists(select 1 from public.reviewer_earnings r where r.review_event_id=e.id)),
    'payable',quizbox_factory.reviewer_money(s.user_id,array['payable']),'pending_qa',quizbox_factory.reviewer_money(s.user_id,array['pending_qa','held']),'paid',quizbox_factory.reviewer_money(s.user_id,array['paid'])) as row_data
   from public.sme_profiles s join public.profiles u on u.id=s.user_id
   left join lateral (select x.* from quizbox_factory.workload_policies x where x.reviewer_id=s.user_id and x.active and x.review_kind='primary' order by x.paused,x.created_at desc limit 1) pol2 on true
   left join lateral (select quizbox_factory.policy_capacity(pol2) as state) st on true
   where s.active and (nullif(p_data->>'reviewer_id','') is null or s.user_id=(p_data->>'reviewer_id')::uuid)
    and (nullif(p_data->>'market_id','') is null or exists(select 1 from public.sme_domain_assignments d where d.reviewer_id=s.user_id and d.active and d.market_id=(p_data->>'market_id')::uuid))
    and (nullif(p_data->>'subject','') is null or exists(select 1 from public.sme_domain_assignments d where d.reviewer_id=s.user_id and d.active and d.subject_code=p_data->>'subject'))
    and (nullif(p_data->>'campaign_id','') is null or exists(select 1 from quizbox_factory.assignment_events e where e.reviewer_id=s.user_id and e.campaign_id=(p_data->>'campaign_id')::uuid) or exists(select 1 from quizbox_factory.workload_policies x where x.reviewer_id=s.user_id and x.campaign_id=(p_data->>'campaign_id')::uuid))
    and (nullif(p_data->>'status','') is null or p_data->>'status'=case when pol2.paused then 'paused' when pol2.id is null then 'no_policy' else 'active' end)) d),'[]');
 end if;
 raise exception 'QB_INVALID_WORKFORCE_ACTION';
end $$;

revoke all on all functions in schema quizbox_factory from public,anon,authenticated;
revoke all on all tables in schema quizbox_factory from public,anon,authenticated;
revoke all on function public.qb_content_factory(text,jsonb),public.qb_content_factory_import(jsonb),public.qb_sme_workforce(text,jsonb) from public,anon;
grant execute on function public.qb_content_factory(text,jsonb),public.qb_content_factory_import(jsonb),public.qb_sme_workforce(text,jsonb) to authenticated;

commit;
