begin;

create schema if not exists quizbox_sme;
revoke all on schema quizbox_sme from public, anon, authenticated;

create table public.currencies (
 code text primary key check (code ~ '^[A-Z]{3}$'), name text not null check (length(trim(name))>0),
 symbol text not null, decimal_places integer not null check (decimal_places between 0 and 6), active boolean not null default true
);
create table public.countries (
 id uuid primary key default gen_random_uuid(), iso2_code text not null unique check (iso2_code ~ '^[A-Z]{2}$'),
 iso3_code text not null unique check (iso3_code ~ '^[A-Z]{3}$'), name text not null check (length(trim(name))>0),
 default_currency_code text not null references public.currencies(code), timezone text not null, locale text not null,
 active boolean not null default true
);
create table public.markets (
 id uuid primary key default gen_random_uuid(), country_id uuid not null references public.countries(id),
 name text not null check (length(trim(name))>0), default_currency_code text not null references public.currencies(code),
 timezone text not null, locale text not null, active boolean not null default true,
 configuration jsonb not null default '{}' check (jsonb_typeof(configuration)='object'), unique(country_id,name)
);
alter table public.curricula add column market_id uuid references public.markets(id);
alter table public.tenants add column market_id uuid references public.markets(id);

-- Compatibility data only. Shared services never branch on these values.
insert into public.currencies values('GHS','Ghana cedi',U&'GH\00A2',2,true);
insert into public.countries(iso2_code,iso3_code,name,default_currency_code,timezone,locale)
 values('GH','GHA','Ghana','GHS','Africa/Accra','en-GH');
insert into public.markets(country_id,name,default_currency_code,timezone,locale)
 select id,'Ghana','GHS',timezone,locale from public.countries where iso2_code='GH';
update public.curricula set market_id=(select id from public.markets where name='Ghana') where lower(country) in ('ghana','gh','gha');
update public.tenants set market_id=(select id from public.markets where name='Ghana') where lower(country) in ('ghana','gh','gha');

create table public.user_capabilities (
 user_id uuid not null references public.profiles(id), capability text not null check (capability in
 ('super_admin','content_admin','sme_reviewer','senior_sme_reviewer','competition_admin','sponsor_admin','finance_admin')),
 active boolean not null default true, granted_by uuid references public.profiles(id), created_at timestamptz not null default now(),
 primary key(user_id,capability)
);
create table public.sme_profiles (
 user_id uuid primary key references public.profiles(id), reviewer_status text not null default 'pending' check (reviewer_status in ('pending','verified','suspended')),
 country_id uuid references public.countries(id), preferred_currency_code text references public.currencies(code), reviewer_tier text not null,
 qualification_summary text not null default '', years_experience integer not null default 0 check (years_experience>=0), bio text not null default '',
 payment_status text not null default 'pending' check (payment_status in ('pending','verified','held')),
 active boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.sme_domain_assignments (
 id uuid primary key default gen_random_uuid(), reviewer_id uuid not null references public.sme_profiles(user_id),
 subject_code text not null check (length(trim(subject_code))>0), curriculum_id uuid references public.curricula(id), market_id uuid references public.markets(id),
 education_level text, grade_codes text[] not null default '{}', specialization text not null default '',
 can_review boolean not null default false, can_approve boolean not null default false, can_senior_review boolean not null default false,
 active boolean not null default true, created_at timestamptz not null default now(),
 check (not can_approve or can_review), check (not can_senior_review or can_review)
);
create table public.compensation_policies (
 id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name))>0), market_id uuid references public.markets(id),
 sponsor_id uuid references public.sponsor_profiles(id), tenant_id uuid references public.tenants(id), reviewer_tier text,
 subject_code text, education_level text, active boolean not null default true
);
create table public.compensation_policy_versions (
 id uuid primary key default gen_random_uuid(), policy_id uuid not null references public.compensation_policies(id),
 currency_code text not null references public.currencies(code), effective_from timestamptz not null, effective_to timestamptz,
 base_review_fee numeric(20,6) not null check (base_review_fee>=0), approve_fee numeric(20,6) not null check (approve_fee>=0),
 reject_fee numeric(20,6) not null check (reject_fee>=0), revision_fee numeric(20,6) not null check (revision_fee>=0),
 senior_review_fee numeric(20,6) not null check (senior_review_fee>=0), complexity_multiplier numeric(10,6) not null default 1 check (complexity_multiplier>0),
 quality_bonus_amount numeric(20,6) not null default 0 check (quality_bonus_amount>=0), minimum_payout_threshold numeric(20,6) check (minimum_payout_threshold>=0),
 tax_or_withholding jsonb not null default '{}' check (jsonb_typeof(tax_or_withholding)='object'), funded_by text not null check (length(trim(funded_by))>0),
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(policy_id,effective_from), check (effective_to is null or effective_to>effective_from)
 ,check (coalesce((tax_or_withholding->>'percentage')::numeric,0) between 0 and 100)
);
create table public.sme_review_assignments (
 id uuid primary key default gen_random_uuid(), question_id uuid not null references public.questions(id), question_version integer not null,
 reviewer_id uuid not null references public.sme_profiles(user_id), domain_assignment_id uuid not null references public.sme_domain_assignments(id),
 market_id uuid references public.markets(id), sponsor_id uuid references public.sponsor_profiles(id), tenant_id uuid references public.tenants(id),
 compensation_policy_version_id uuid references public.compensation_policy_versions(id),
 review_kind text not null default 'primary' check (review_kind in ('primary','senior')),
 prior_review_event_id uuid, assigned_at timestamptz not null default now(), review_started_at timestamptz, review_completed_at timestamptz,
 assigned_by uuid not null references public.profiles(id), unique(question_id,question_version,reviewer_id,review_kind)
);
create unique index sme_one_open_review on public.sme_review_assignments(question_id,review_kind) where review_completed_at is null;
create table public.sme_review_events (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null unique references public.sme_review_assignments(id),
 question_id uuid not null references public.questions(id), question_version_id uuid references public.question_versions(id),
 reviewer_id uuid not null references public.sme_profiles(user_id), assigned_at timestamptz not null, review_started_at timestamptz not null,
 review_completed_at timestamptz not null, decision text not null check (decision in ('approve','reject','revision')),
 review_notes text not null check (length(trim(review_notes)) between 3 and 1000), review_duration_seconds integer not null check (review_duration_seconds>=0),
 revision_count integer not null, senior_reviewer_id uuid references public.sme_profiles(user_id), final_status text not null,
 qa_reversal boolean not null default false, dispute boolean not null default false, created_at timestamptz not null default now()
);
alter table public.sme_review_assignments add foreign key(prior_review_event_id) references public.sme_review_events(id);
create table public.sme_payout_batches (
 id uuid primary key default gen_random_uuid(), market_id uuid references public.markets(id), currency_code text not null references public.currencies(code),
 period_start timestamptz not null, period_end timestamptz not null, status text not null default 'draft' check (status in ('draft','approved','paid')),
 created_by uuid not null references public.profiles(id), approved_by uuid references public.profiles(id), paid_at timestamptz,
 created_at timestamptz not null default now(), check(period_end>period_start)
);
create table public.reviewer_earnings (
 id uuid primary key default gen_random_uuid(), reviewer_id uuid not null references public.sme_profiles(user_id), review_event_id uuid not null unique references public.sme_review_events(id),
 compensation_policy_version_id uuid not null references public.compensation_policy_versions(id), earning_type text not null,
 quantity numeric(20,6) not null check(quantity>0), base_amount numeric(20,6) not null check(base_amount>=0), currency_code text not null references public.currencies(code),
 multiplier numeric(10,6) not null check(multiplier>0), bonus_amount numeric(20,6) not null check(bonus_amount>=0), deduction_amount numeric(20,6) not null check(deduction_amount>=0),
 final_amount numeric(20,6) not null check(final_amount>=0), status text not null default 'pending_qa' check(status='pending_qa'),
 earned_at timestamptz not null default now(), payable_at timestamptz, payout_batch_id uuid references public.sme_payout_batches(id)
);
-- Status changes are appended, never updates to the money or rate snapshots.
create table public.reviewer_earning_states (
 id bigint generated always as identity primary key, earning_id uuid not null references public.reviewer_earnings(id),
 status text not null check(status in ('pending_qa','payable','held','paid','reversed')), payout_batch_id uuid references public.sme_payout_batches(id),
 actor_id uuid not null references public.profiles(id), note text not null default '', created_at timestamptz not null default now()
);
create table public.sme_payout_items (
 payout_batch_id uuid not null references public.sme_payout_batches(id), reviewer_id uuid not null references public.sme_profiles(user_id),
 earning_id uuid not null unique references public.reviewer_earnings(id), amount numeric(20,6) not null check(amount>=0), currency_code text not null references public.currencies(code),
 status text not null default 'reserved' check(status in ('reserved','paid')), primary key(payout_batch_id,earning_id)
);
create index sme_domains_reviewer on public.sme_domain_assignments(reviewer_id);
create index sme_work_reviewer on public.sme_review_assignments(reviewer_id,assigned_at desc);
create index sme_events_question on public.sme_review_events(question_id,review_completed_at desc);
create index sme_earnings_reviewer on public.reviewer_earnings(reviewer_id,currency_code);
create index sme_states_earning on public.reviewer_earning_states(earning_id,id desc);

create function quizbox_sme.has_capability(p_cap text) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and lower(status::text)='active') and
 (exists(select 1 from public.profiles where id=auth.uid() and lower(role::text)='owner') or
 exists(select 1 from public.user_capabilities where user_id=auth.uid() and active and capability in ('super_admin',p_cap)));
$$;
create function quizbox_sme.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'QB_IMMUTABLE_HISTORY'; end $$;
create trigger immutable_policy_versions before update or delete on public.compensation_policy_versions for each row execute function quizbox_sme.immutable();
create trigger immutable_review_events before update or delete on public.sme_review_events for each row execute function quizbox_sme.immutable();
create trigger immutable_earnings before update or delete on public.reviewer_earnings for each row execute function quizbox_sme.immutable();
create trigger immutable_earning_states before update or delete on public.reviewer_earning_states for each row execute function quizbox_sme.immutable();

create function quizbox_sme.configuration_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name in ('countries','markets') then
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) or new.locale !~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$' then raise exception 'QB_INVALID_LOCALE_TIMEZONE'; end if;
 end if;
 if tg_table_name='sme_profiles' then new.updated_at:=now(); end if;
 return new;
end $$;
create trigger country_configuration before insert or update on public.countries for each row execute function quizbox_sme.configuration_guard();
create trigger market_configuration before insert or update on public.markets for each row execute function quizbox_sme.configuration_guard();
create trigger sme_profile_timestamp before update on public.sme_profiles for each row execute function quizbox_sme.configuration_guard();

create function quizbox_sme.domain_matches(p_domain uuid,p_question uuid,p_reviewer uuid,p_market uuid,p_senior boolean,p_approve boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.sme_domain_assignments d join public.sme_profiles s on s.user_id=d.reviewer_id
 join public.profiles u on u.id=s.user_id join public.questions q on q.id=p_question left join public.curriculum_nodes n on n.id=q.curriculum_node_id
 where d.id=p_domain and d.reviewer_id=p_reviewer and d.active and s.active and s.reviewer_status='verified' and lower(u.status::text)='active'
 and d.can_review and (not p_approve or d.can_approve) and (not p_senior or d.can_senior_review)
 and d.subject_code=q.subject_code and (d.curriculum_id is null or d.curriculum_id=q.curriculum_id)
 and (d.market_id is null or d.market_id=p_market) and (d.education_level is null or d.education_level=n.education_level)
 and (cardinality(d.grade_codes)=0 or coalesce(q.canonical_grade_code,q.grade::text)=any(d.grade_codes)));
$$;

create function quizbox_sme.resolve_policy(p_market uuid,p_tenant uuid,p_sponsor uuid,p_tier text,p_subject text,p_level text,p_at timestamptz)
returns uuid language plpgsql stable security definer set search_path='' as $$
declare result uuid; tied integer;
begin
 with latest as (
 select distinct on(p.id) v.id, (case when p.sponsor_id is not null or p.tenant_id is not null then 3 when p.market_id is not null then 2 else 1 end) as precedence,
 ((p.reviewer_tier is not null)::integer+(p.subject_code is not null)::integer+(p.education_level is not null)::integer+(p.market_id is not null)::integer+(p.sponsor_id is not null)::integer+(p.tenant_id is not null)::integer) as specificity
 from public.compensation_policies p join public.compensation_policy_versions v on v.policy_id=p.id join public.currencies c on c.code=v.currency_code
 where p.active and c.active and v.effective_from<=p_at and (v.effective_to is null or v.effective_to>p_at)
 and (p.market_id is null or p.market_id=p_market) and (p.tenant_id is null or p.tenant_id=p_tenant) and (p.sponsor_id is null or p.sponsor_id=p_sponsor)
 and (p.reviewer_tier is null or p.reviewer_tier=p_tier) and (p.subject_code is null or p.subject_code=p_subject) and (p.education_level is null or p.education_level=p_level)
 order by p.id,v.effective_from desc
 ), ranked as (select *,dense_rank() over(order by precedence desc,specificity desc) as rank from latest)
 select (array_agg(id))[1],count(*) into result,tied from ranked where rank=1;
 if tied>1 then raise exception 'QB_AMBIGUOUS_COMPENSATION_POLICY'; end if;
 return result;
end $$;

create view public.sme_earnings_current with (security_invoker=true) as
 select e.id,e.reviewer_id,e.review_event_id,e.compensation_policy_version_id,e.earning_type,e.quantity::text,e.base_amount::text,e.currency_code,
 e.multiplier::text,e.bonus_amount::text,e.deduction_amount::text,e.final_amount::text,e.status,e.earned_at,e.payable_at,e.payout_batch_id,
 coalesce(s.status,e.status) as current_status,s.payout_batch_id as current_payout_batch_id,s.created_at as state_changed_at
 from public.reviewer_earnings e left join lateral(select * from public.reviewer_earning_states where earning_id=e.id order by id desc limit 1) s on true;
create view public.sme_performance with (security_invoker=true) as
 select s.user_id as reviewer_id,
 (select count(*) from public.sme_review_assignments where reviewer_id=s.user_id) as assigned_count,
 (select count(*) from public.sme_review_assignments where reviewer_id=s.user_id and review_completed_at is null) as pending_count,
 (select count(*) from public.sme_review_events where reviewer_id=s.user_id) as reviewed_count,
 (select count(*) from public.sme_review_events where reviewer_id=s.user_id and decision='approve') as approved_count,
 (select count(*) from public.sme_review_events where reviewer_id=s.user_id and decision='reject') as rejected_count,
 (select count(*) from public.sme_review_events where reviewer_id=s.user_id and decision='revision') as revision_count,
 (select avg(review_duration_seconds) from public.sme_review_events where reviewer_id=s.user_id) as average_review_seconds,
 (select count(*) from public.sme_review_events e join public.sme_review_assignments a on a.id=e.assignment_id join public.sme_review_events prior on prior.id=a.prior_review_event_id where prior.reviewer_id=s.user_id and e.qa_reversal) as qa_reversal_count,
 (select count(*) from public.sme_review_events where reviewer_id=s.user_id and dispute) as dispute_count
 from public.sme_profiles s;
create view public.sme_financial_performance with (security_invoker=true) as
 select reviewer_id,currency_code,count(*) filter(where current_status='payable') as payable_review_count,
 coalesce(sum(final_amount::numeric) filter(where current_status<>'reversed'),0)::text as earnings_total,
 coalesce(sum(final_amount::numeric) filter(where current_status='payable'),0)::text as payable_amount,
 coalesce(sum(final_amount::numeric) filter(where current_status='paid'),0)::text as payout_total,
 coalesce(sum(final_amount::numeric) filter(where current_status not in ('paid','reversed')),0)::text as outstanding_amount
 from public.sme_earnings_current group by reviewer_id,currency_code;
create view public.sme_review_queue with (security_invoker=true) as
 select w.*,d.subject_code from public.sme_review_assignments w join public.sme_domain_assignments d on d.id=w.domain_assignment_id;
create view public.sme_payout_batch_summary with (security_invoker=true) as
 select b.*,(select coalesce(sum(i.amount),0)::text from public.sme_payout_items i where i.payout_batch_id=b.id) as total_amount,
 (select count(*) from public.sme_payout_items i where i.payout_batch_id=b.id) as earning_count
 from public.sme_payout_batches b;
create view public.sme_payout_item_details with (security_invoker=true) as
 select payout_batch_id,reviewer_id,earning_id,amount::text,currency_code,status from public.sme_payout_items;

create function public.qb_sme_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('super_admin',quizbox_sme.has_capability('super_admin'),'finance_admin',quizbox_sme.has_capability('finance_admin'),
 'content_admin',quizbox_sme.has_capability('content_admin'), 'reviewer',exists(select 1 from public.sme_profiles where user_id=auth.uid() and active and reviewer_status='verified'));
$$;

-- Configuration writes are restricted to this allowlisted RPC; clients have SELECT grants only.
create function public.qb_sme_configure(p_entity text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare key text; columns text; values_sql text; updates text; partial_updates text; result jsonb; payload jsonb:=p_data; table_id regclass;
begin
 if not quizbox_sme.has_capability('super_admin') then raise exception 'QB_SME_CONFIGURATION_DENIED' using errcode='42501'; end if;
 if p_entity not in ('currencies','countries','markets','sme_profiles','sme_domain_assignments','compensation_policies','compensation_policy_versions','user_capabilities') then raise exception 'QB_INVALID_ENTITY'; end if;
 if jsonb_typeof(payload)<>'object' or octet_length(payload::text)>20000 then raise exception 'QB_INVALID_CONFIG'; end if;
 key:=case when p_entity='currencies' then 'code' when p_entity='sme_profiles' then 'user_id' else 'id' end;
 if p_entity='user_capabilities' then
  insert into public.user_capabilities(user_id,capability,active,granted_by) values((payload->>'user_id')::uuid,payload->>'capability',coalesce((payload->>'active')::boolean,true),auth.uid())
  on conflict(user_id,capability) do update set active=excluded.active,granted_by=excluded.granted_by returning to_jsonb(user_capabilities.*) into result; return result;
 end if;
 if key='id' and coalesce(payload->>'id','')='' then payload:=payload||jsonb_build_object('id',gen_random_uuid()); end if;
 if p_entity='compensation_policy_versions' then payload:=payload||jsonb_build_object('created_by',auth.uid()); end if;
 if payload ? 'created_at' or payload ? 'updated_at' then raise exception 'QB_INVALID_CONFIG'; end if;
 table_id:=to_regclass('public.'||p_entity);
 if exists(select 1 from jsonb_object_keys(payload) k where not exists(select 1 from pg_catalog.pg_attribute a where a.attrelid=table_id and a.attname=k and a.attnum>0 and not a.attisdropped)) then raise exception 'QB_INVALID_CONFIG_FIELD'; end if;
 if p_entity<>'compensation_policy_versions' then
  execute format('select to_jsonb(t) from public.%I t where t.%I=(jsonb_populate_record(null::public.%I,$1)).%I for update',p_entity,key,p_entity,key) into result using payload;
  if result is not null then
   if p_entity='markets' and payload ? 'configuration' then payload:=payload||jsonb_build_object('configuration',coalesce(result->'configuration','{}'::jsonb)||(payload->'configuration')); end if;
   select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',k,p_entity,k),',') into partial_updates from jsonb_object_keys(payload) k where k<>key;
   if partial_updates is not null then
    execute format('update public.%I set %s where %I=(jsonb_populate_record(null::public.%I,$1)).%I returning to_jsonb(%I.*)',p_entity,partial_updates,key,p_entity,key,p_entity) into result using payload;
   end if;
   return result;
  end if;
 end if;
 select string_agg(format('%I',k),','),string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',p_entity,k),','),
 string_agg(format('%I=excluded.%I',k,k),',') filter(where k<>key) into columns,values_sql,updates from jsonb_object_keys(payload) k;
 execute format('insert into public.%I(%s) values(%s) %s returning to_jsonb(%I.*)',p_entity,columns,values_sql,
 case when p_entity='compensation_policy_versions' then '' else format('on conflict(%I) do update set %s',key,updates) end,p_entity) into result using payload;
 return result;
end $$;

create function public.qb_sme_assign_review(p_question uuid,p_reviewer uuid,p_domain uuid,p_kind text default 'primary',p_sponsor uuid default null,p_prior uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.questions; m uuid; level text; tier text; policy uuid; work public.sme_review_assignments;
begin
 if not quizbox_sme.has_capability('content_admin') then raise exception 'QB_SME_ASSIGNMENT_DENIED' using errcode='42501'; end if;
 select * into q from public.questions where id=p_question for update;
 if q.id is null or coalesce(q.source_type,'') like 'DEV_%' or q.validation_status not in ('review','needs_revision','approved','rejected') then raise exception 'QB_INVALID_REVIEW_QUESTION'; end if;
 if p_kind not in ('primary','senior') then raise exception 'QB_INVALID_REVIEW_KIND'; end if;
 select c.market_id,n.education_level into m,level from public.curriculum_nodes n join public.curricula c on c.id=n.curriculum_id where n.id=q.curriculum_node_id;
 if m is not null and not exists(select 1 from public.markets k join public.countries c on c.id=k.country_id join public.currencies u on u.code=k.default_currency_code where k.id=m and k.active and c.active and u.active) then raise exception 'QB_MARKET_INACTIVE'; end if;
 if not quizbox_sme.domain_matches(p_domain,q.id,p_reviewer,m,p_kind='senior',false) then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
 if p_kind='senior' and not exists(select 1 from public.sme_review_events e join public.sme_review_assignments a on a.id=e.assignment_id where e.id=p_prior and e.question_id=q.id and a.question_version=q.version and a.review_kind='primary' and e.reviewer_id<>p_reviewer) then raise exception 'QB_INDEPENDENT_SENIOR_REVIEW_REQUIRED'; end if;
 select reviewer_tier into tier from public.sme_profiles where user_id=p_reviewer;
 policy:=quizbox_sme.resolve_policy(m,q.tenant_id,p_sponsor,tier,q.subject_code,level,now());
 insert into public.sme_review_assignments(question_id,question_version,reviewer_id,domain_assignment_id,market_id,sponsor_id,tenant_id,compensation_policy_version_id,review_kind,prior_review_event_id,assigned_by)
 values(q.id,q.version,p_reviewer,p_domain,m,p_sponsor,q.tenant_id,policy,p_kind,p_prior,auth.uid()) returning * into work;
 return to_jsonb(work);
end $$;

create function public.qb_sme_review_detail(p_assignment uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.sme_review_assignments; q public.questions;
begin
 select * into w from public.sme_review_assignments where id=p_assignment for update;
 if w.id is null or (w.reviewer_id<>auth.uid() and not quizbox_sme.has_capability('content_admin')) then raise exception 'QB_REVIEW_ACCESS_DENIED' using errcode='42501'; end if;
 if not quizbox_sme.domain_matches(w.domain_assignment_id,w.question_id,w.reviewer_id,w.market_id,w.review_kind='senior',false) then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
 if w.reviewer_id=auth.uid() and w.review_started_at is null then update public.sme_review_assignments set review_started_at=now() where id=w.id returning * into w; end if;
 select * into q from public.questions where id=w.question_id;
 return jsonb_build_object('assignment',to_jsonb(w),'question',to_jsonb(q),'validation_errors',public.qb_content_validation_errors(to_jsonb(q)));
end $$;

create function public.qb_sme_complete_review(p_assignment uuid,p_decision text,p_note text,p_human_reviewed boolean,p_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.sme_review_assignments; q public.questions; event public.sme_review_events; v public.compensation_policy_versions; fee numeric; decimals integer; target text; withholding numeric;
begin
 select * into w from public.sme_review_assignments where id=p_assignment for update;
 if w.id is null or w.reviewer_id<>auth.uid() then raise exception 'QB_REVIEW_ACCESS_DENIED' using errcode='42501'; end if;
 if not quizbox_sme.domain_matches(w.domain_assignment_id,w.question_id,auth.uid(),w.market_id,w.review_kind='senior',p_decision='approve') then raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501'; end if;
 if w.review_completed_at is not null then select * into event from public.sme_review_events where assignment_id=w.id; return to_jsonb(event); end if;
 if p_decision not in ('approve','reject','revision') or p_human_reviewed is distinct from true or length(trim(p_note)) not between 3 and 1000 or w.review_started_at is null then raise exception 'QB_HUMAN_REVIEW_REQUIRED'; end if;
 select * into q from public.questions where id=w.question_id for update;
 if q.version<>w.question_version or q.version<>p_version then raise exception 'QB_CONTENT_CONFLICT'; end if;
 if w.review_kind='senior' and exists(select 1 from public.sme_review_assignments where question_id=q.id and review_kind='primary' and review_completed_at is null) then raise exception 'QB_PENDING_SME_REVIEW'; end if;
 if w.review_kind='primary' and q.validation_status not in ('review','needs_revision') then raise exception 'QB_CONTENT_CONFLICT'; end if;
 if p_decision='approve' and public.qb_content_validation_errors(to_jsonb(q))<>'[]'::jsonb then raise exception 'QB_CONTENT_VALIDATION_FAILED'; end if;
 target:=case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'needs_revision' end;
 -- Only this scoped RPC can change an assigned question's decision. Publication stays separate.
 perform set_config('quizbox.sme_assignment',w.id::text,true);
 update public.questions set validation_status=target,status='inactive',reviewed_by=case when p_decision='approve' then auth.uid() else null end,
 reviewed_at=case when p_decision='approve' then now() else null end,editorial_metadata=editorial_metadata||jsonb_build_object('human_reviewed',p_decision='approve','review_note',p_note) where id=q.id;
 insert into public.sme_review_events(assignment_id,question_id,question_version_id,reviewer_id,assigned_at,review_started_at,review_completed_at,decision,review_notes,review_duration_seconds,revision_count,senior_reviewer_id,final_status,qa_reversal)
 values(w.id,q.id,(select id from public.question_versions where question_id=q.id and version_no=q.version),auth.uid(),w.assigned_at,w.review_started_at,now(),p_decision,p_note,
 greatest(0,extract(epoch from now()-w.review_started_at)::integer),(select count(*) from public.sme_review_events where question_id=q.id and decision='revision'),
 case when w.review_kind='senior' then auth.uid() end,target,w.review_kind='senior' and exists(select 1 from public.sme_review_events where id=w.prior_review_event_id and decision<>p_decision)) returning * into event;
 update public.sme_review_assignments set review_completed_at=now() where id=w.id;
 if w.compensation_policy_version_id is not null then
  select * into v from public.compensation_policy_versions where id=w.compensation_policy_version_id;
  select decimal_places into decimals from public.currencies where code=v.currency_code;
  fee:=v.base_review_fee+case when w.review_kind='senior' then v.senior_review_fee when p_decision='approve' then v.approve_fee when p_decision='reject' then v.reject_fee else v.revision_fee end;
  withholding:=coalesce((v.tax_or_withholding->>'percentage')::numeric,0);
  if withholding not between 0 and 100 then raise exception 'QB_INVALID_WITHHOLDING'; end if;
  insert into public.reviewer_earnings(reviewer_id,review_event_id,compensation_policy_version_id,earning_type,quantity,base_amount,currency_code,multiplier,bonus_amount,deduction_amount,final_amount)
  values(auth.uid(),event.id,v.id,w.review_kind||'_'||p_decision,1,fee,v.currency_code,v.complexity_multiplier,v.quality_bonus_amount,
  round((fee*v.complexity_multiplier+v.quality_bonus_amount)*withholding/100,decimals),
  round(fee*v.complexity_multiplier+v.quality_bonus_amount,decimals)-round((fee*v.complexity_multiplier+v.quality_bonus_amount)*withholding/100,decimals));
 end if;
 perform set_config('quizbox.sme_assignment','',true);
 return to_jsonb(event);
end $$;

create function quizbox_sme.managed_review_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- Admin role alone never confers subject-review permission. Legacy history is untouched.
 if new.version=old.version and new.validation_status is distinct from old.validation_status and new.validation_status in ('approved','rejected','needs_revision')
 and not exists(select 1 from public.sme_domain_assignments d where d.reviewer_id=auth.uid()
  and quizbox_sme.domain_matches(d.id,old.id,auth.uid(),(select market_id from public.curricula where id=old.curriculum_id),false,new.validation_status='approved')) then
  raise exception 'QB_REVIEW_DOMAIN_DENIED' using errcode='42501';
 end if;
 if new.validation_status is distinct from old.validation_status and exists(select 1 from public.sme_review_assignments where question_id=old.id and review_completed_at is null)
 and not exists(select 1 from public.sme_review_assignments where id::text=current_setting('quizbox.sme_assignment',true) and question_id=old.id and reviewer_id=auth.uid()) then
  raise exception 'QB_ASSIGNED_REVIEW_REQUIRED' using errcode='42501';
 end if;
 if new.status::text='active' and old.status::text<>'active' and exists(select 1 from public.sme_review_assignments where question_id=old.id) then
  if not (quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('competition_admin')) then raise exception 'QB_SME_PUBLISH_DENIED' using errcode='42501'; end if;
  if exists(select 1 from public.sme_review_assignments where question_id=old.id and review_completed_at is null) then raise exception 'QB_PENDING_SME_REVIEW'; end if;
  if exists(select 1 from public.curricula c join public.markets m on m.id=c.market_id where c.id=new.curriculum_id and coalesce((m.configuration->>'require_senior_qa')::boolean,false))
  and not exists(select 1 from public.sme_review_assignments w join public.sme_review_events e on e.assignment_id=w.id where w.question_id=new.id and w.question_version=new.version and w.review_kind='senior' and e.decision='approve'
   and e.review_completed_at>=coalesce((select max(a.review_completed_at) from public.sme_review_assignments a where a.question_id=new.id and a.question_version=new.version and a.review_kind='primary'),'-infinity'::timestamptz)) then raise exception 'QB_SENIOR_QA_REQUIRED'; end if;
 end if;
 return new;
end $$;
create trigger zz_sme_managed_review_guard before update on public.questions for each row execute function quizbox_sme.managed_review_guard();

create function public.qb_sme_publish_question(p_question uuid,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.questions;
begin
 if not (quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('competition_admin')) then raise exception 'QB_SME_PUBLISH_DENIED' using errcode='42501'; end if;
 select * into q from public.questions where id=p_question for update;
 if q.id is null or q.version<>p_version or q.validation_status<>'approved' or q.reviewed_by is null or public.qb_content_validation_errors(to_jsonb(q))<>'[]'::jsonb
 or not exists(select 1 from public.sme_review_assignments where question_id=q.id and question_version=q.version and review_completed_at is not null) then raise exception 'QB_CONTENT_NOT_APPROVED'; end if;
 if exists(select 1 from public.sme_review_assignments where question_id=q.id and review_completed_at is null) then raise exception 'QB_PENDING_SME_REVIEW'; end if;
 update public.questions set status='active' where id=q.id;
 return jsonb_build_object('id',q.id,'version',q.version,'status','active');
end $$;

create function public.qb_sme_release_earning(p_earning uuid,p_status text,p_note text) returns void language plpgsql security definer set search_path='' as $$
declare current_state text;
begin
 if not quizbox_sme.has_capability('finance_admin') then raise exception 'QB_FINANCE_ACCESS_DENIED' using errcode='42501'; end if;
 perform 1 from public.reviewer_earnings where id=p_earning for update;
 if not found then raise exception 'QB_EARNING_NOT_FOUND'; end if;
 select current_status into current_state from public.sme_earnings_current where id=p_earning;
 if p_status not in ('payable','held','reversed') or current_state not in ('pending_qa','payable','held') or length(trim(p_note))<3 or exists(select 1 from public.sme_payout_items where earning_id=p_earning) then raise exception 'QB_INVALID_EARNING_TRANSITION'; end if;
 insert into public.reviewer_earning_states(earning_id,status,actor_id,note) values(p_earning,p_status,auth.uid(),p_note);
end $$;

create function public.qb_sme_create_payout(p_market uuid,p_currency text,p_start timestamptz,p_end timestamptz,p_earnings uuid[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.sme_payout_batches; eligible integer; amount numeric;
begin
 if not quizbox_sme.has_capability('finance_admin') then raise exception 'QB_FINANCE_ACCESS_DENIED' using errcode='42501'; end if;
 if cardinality(p_earnings) not between 1 and 1000 or p_start is null or p_end<=p_start then raise exception 'QB_INVALID_PAYOUT'; end if;
 perform 1 from public.reviewer_earnings where id=any(p_earnings) order by id for update;
 select count(*) into eligible from public.sme_earnings_current e join public.sme_review_events r on r.id=e.review_event_id join public.sme_review_assignments w on w.id=r.assignment_id join public.sme_profiles s on s.user_id=e.reviewer_id
 where e.id=any(p_earnings) and e.current_status='payable' and e.currency_code=p_currency and w.market_id is not distinct from p_market
 and e.earned_at>=p_start and e.earned_at<p_end and s.payment_status='verified' and s.active and not exists(select 1 from public.sme_payout_items where earning_id=e.id);
 if eligible<>cardinality(p_earnings) then raise exception 'QB_INELIGIBLE_EARNINGS'; end if;
 if exists(select 1 from public.reviewer_earnings e join public.compensation_policy_versions v on v.id=e.compensation_policy_version_id where e.id=any(p_earnings)
 group by e.reviewer_id having sum(e.final_amount)<max(coalesce(v.minimum_payout_threshold,0))) then raise exception 'QB_BELOW_PAYOUT_THRESHOLD'; end if;
 insert into public.sme_payout_batches(market_id,currency_code,period_start,period_end,created_by) values(p_market,p_currency,p_start,p_end,auth.uid()) returning * into batch;
 insert into public.sme_payout_items(payout_batch_id,reviewer_id,earning_id,amount,currency_code) select batch.id,reviewer_id,id,final_amount,currency_code from public.reviewer_earnings where id=any(p_earnings);
 insert into public.reviewer_earning_states(earning_id,status,payout_batch_id,actor_id,note) select unnest(p_earnings),'held',batch.id,auth.uid(),'Reserved for payout';
 select sum(i.amount) into amount from public.sme_payout_items i where i.payout_batch_id=batch.id;
 return to_jsonb(batch)||jsonb_build_object('total',amount);
end $$;
create function public.qb_sme_payout_action(p_batch uuid,p_action text) returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.sme_payout_batches;
begin
 if not quizbox_sme.has_capability('finance_admin') then raise exception 'QB_FINANCE_ACCESS_DENIED' using errcode='42501'; end if;
 select * into batch from public.sme_payout_batches where id=p_batch for update;
 if batch.id is null then raise exception 'QB_PAYOUT_NOT_FOUND'; end if;
 if p_action='approve' and batch.status='draft' then
  if batch.created_by=auth.uid() then raise exception 'QB_INDEPENDENT_PAYOUT_APPROVER_REQUIRED'; end if;
  update public.sme_payout_batches set status='approved',approved_by=auth.uid() where id=batch.id returning * into batch;
 elsif p_action='paid' and batch.status='approved' then
  update public.sme_payout_batches set status='paid',paid_at=now() where id=batch.id returning * into batch;
  update public.sme_payout_items set status='paid' where payout_batch_id=batch.id;
  insert into public.reviewer_earning_states(earning_id,status,payout_batch_id,actor_id,note) select earning_id,'paid',batch.id,auth.uid(),'Manually confirmed paid' from public.sme_payout_items where payout_batch_id=batch.id;
 elsif not ((p_action='approve' and batch.status='approved') or (p_action='paid' and batch.status='paid')) then raise exception 'QB_INVALID_PAYOUT_TRANSITION'; end if;
 return to_jsonb(batch);
end $$;

-- All tables fail closed. No authenticated client receives direct mutation grants.
do $$ declare t text; own text; begin
 foreach t in array array['currencies','countries','markets','user_capabilities','sme_profiles','sme_domain_assignments','compensation_policies','compensation_policy_versions','sme_review_assignments','sme_review_events','sme_payout_batches','reviewer_earnings','reviewer_earning_states','sme_payout_items'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  own:=case when t='sme_profiles' then 'user_id=auth.uid()' when t in ('sme_domain_assignments','sme_review_assignments','sme_review_events','reviewer_earnings','sme_payout_items') then 'reviewer_id=auth.uid()'
   when t='reviewer_earning_states' then 'exists(select 1 from public.reviewer_earnings e where e.id=earning_id and e.reviewer_id=auth.uid())'
   when t='user_capabilities' then 'user_id=auth.uid()' else 'false' end;
  if t in ('currencies','countries','markets') then own:='active'; end if;
  execute format('create policy sme_read on public.%I for select to authenticated using (quizbox_sme.has_capability(''super_admin'') or %s or %s)',t,own,
   case when t in ('sme_profiles','sme_domain_assignments','sme_review_assignments','sme_review_events') then 'quizbox_sme.has_capability(''content_admin'') or quizbox_sme.has_capability(''finance_admin'')'
    when t in ('reviewer_earnings','reviewer_earning_states','sme_payout_items','sme_payout_batches','compensation_policy_versions','compensation_policies') then 'quizbox_sme.has_capability(''finance_admin'')' else 'false' end);
 end loop;
end $$;
grant usage on schema quizbox_sme to authenticated;
revoke execute on all functions in schema quizbox_sme from public,anon,authenticated;
grant execute on function quizbox_sme.has_capability(text) to authenticated;
grant select on public.sme_earnings_current,public.sme_performance,public.sme_financial_performance,public.sme_review_queue,public.sme_payout_batch_summary,public.sme_payout_item_details to authenticated;
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'qb_sme_%' loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
commit;
