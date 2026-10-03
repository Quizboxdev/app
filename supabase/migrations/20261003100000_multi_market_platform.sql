-- Multi-country platform: market lifecycle/readiness, country-first onboarding, primary vs active
-- market, market change requests, configurable grade policy, release-fixture gating, platform
-- dashboard. Extends existing market governance; no country literals in shared logic.
begin;

-- Market lifecycle. `active` stays the enforcement flag used by market_allowed and is derived from status.
alter table public.markets add column status text not null default 'DRAFT' check (status in ('DRAFT','CONFIGURING','READY','ACTIVE','SUSPENDED'));
alter table public.markets add column is_test boolean not null default false;
update public.markets set status=case when active then 'ACTIVE' else 'DRAFT' end;
create function quizbox_market.sync_market_active() returns trigger language plpgsql set search_path='' as $$
begin new.active:=new.status='ACTIVE'; return new; end $$;
create trigger market_status_active before insert or update of status,active on public.markets for each row execute function quizbox_market.sync_market_active();

alter table public.curricula add column effective_from date;
alter table public.curricula add column effective_to date;

-- Primary market is the user's home environment; default_market_id remains the active context.
alter table public.profiles add column primary_market_id uuid references public.markets(id);
alter table public.profiles add column onboarding_completed_at timestamptz;
update public.profiles set primary_market_id=default_market_id, onboarding_completed_at=coalesce(created_at,now());

alter table public.student_profiles alter column grade drop not null;
-- Market-defined grades live in grade_code; the legacy enum is optional outside its original market.
alter table public.class_memberships alter column grade drop not null;
alter table public.classes alter column grade drop not null;
alter table public.classes add column grade_code text;
update public.classes set grade_code=grade::text where grade is not null;
alter table public.assignments alter column grade drop not null;
alter table public.assignments add column grade_code text;
update public.assignments set grade_code=grade::text where grade is not null;
alter table public.student_profiles add column education_level text;
alter table public.student_profiles add column grade_code text;
alter table public.student_profiles add column subjects text[] not null default '{}';
update public.student_profiles set grade_code=grade::text where grade is not null;
alter table public.teacher_profiles add column subjects text[] not null default '{}';
alter table public.teacher_profiles add column grade_codes text[] not null default '{}';
alter table public.teacher_profiles add column education_levels text[] not null default '{}';
alter table public.sme_profiles add column requested_domains jsonb not null default '[]' check (jsonb_typeof(requested_domains)='array');

alter table public.assignments add column grade_override boolean not null default false;
alter table public.assignments add column grade_override_reason text;
alter table public.assignments add column grade_override_by uuid references public.profiles(id);

create table public.market_change_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 from_market_id uuid references public.markets(id), to_market_id uuid not null references public.markets(id),
 reason text not null check (length(btrim(reason)) between 3 and 500),
 status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED','CANCELLED')),
 decided_by uuid references public.profiles(id), decided_at timestamptz, decision_note text,
 created_at timestamptz not null default now()
);
create unique index market_change_one_pending on public.market_change_requests(user_id) where status='PENDING';
alter table public.market_change_requests enable row level security;
revoke all on public.market_change_requests from public,anon,authenticated;
grant select on public.market_change_requests to authenticated;
create policy market_change_read on public.market_change_requests for select to authenticated using (user_id=(select auth.uid()) or quizbox_market.is_super());

-- Market-defined grade code for a student (falls back to the legacy enum value).
create function quizbox_market.student_grade_code(p_user uuid) returns text language sql stable security definer set search_path='' as $$
 select case when g='B10' then 'SHS1' else g end from (select coalesce(nullif(s.grade_code,''),s.grade::text) g from public.student_profiles s where s.user_id=p_user and lower(s.status::text)='active' limit 1) x;
$$;

-- Grade policy. STRICT_GRADE unless the teacher deliberately overrode a published assignment the
-- student is targeted by, or the market explicitly configures OPEN_LEVEL for self-practice.
create function quizbox_market.grade_policy_applies(p_assessment uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not (
  exists(select 1 from public.assignments a join public.assignment_targets t on t.assignment_id=a.id
   where a.assessment_id=p_assessment and a.status='published' and a.grade_override
   and exists(select 1 from public.class_memberships m where m.id=t.membership_id and m.student_user_id=auth.uid()))
  or (not exists(select 1 from public.assignments a where a.assessment_id=p_assessment)
   and exists(select 1 from public.profiles p join public.markets m on m.id=p.default_market_id where p.id=auth.uid() and m.configuration#>>'{grade_policy,self_practice}'='OPEN_LEVEL')));
$$;

do $$ declare body text; begin
 body:=pg_get_functiondef('quizbox_competition.curriculum_assessment_allowed(uuid)'::regprocedure);
 if position('c->>''scope''=''LOCAL_MARKET'' and exists(select 1 from public.profiles where id=auth.uid() and upper(role::text)=''STUDENT'')' in body)=0
  or position('case when s.grade::text=''B10'' then ''SHS1'' else s.grade::text end' in body)=0 then raise exception 'GRADE_POLICY_CONTRACT_MISMATCH'; end if;
 body:=replace(body,'c->>''scope''=''LOCAL_MARKET'' and exists(select 1 from public.profiles where id=auth.uid() and upper(role::text)=''STUDENT'')',
  'c->>''scope''=''LOCAL_MARKET'' and quizbox_market.grade_policy_applies(p_assessment) and exists(select 1 from public.profiles where id=auth.uid() and upper(role::text)=''STUDENT'')');
 body:=replace(body,'case when s.grade::text=''B10'' then ''SHS1'' else s.grade::text end','quizbox_market.student_grade_code(s.user_id)');
 execute body;
end $$;

-- Release fixtures are only visible to the reserved acceptance identities.
do $$ declare body text; begin
 body:=pg_get_functiondef('quizbox_market.question_allowed(uuid,jsonb)'::regprocedure);
 if position('select * into q from public.questions where id=p_question;' in body)=0 then raise exception 'FIXTURE_GATE_CONTRACT_MISMATCH'; end if;
 body:=replace(body,'select * into q from public.questions where id=p_question;',
  'select * into q from public.questions where id=p_question;
 if q.source_type=''DEV_ACCEPTANCE_FIXTURE'' and not public.qb_is_acceptance_actor() then return false; end if;');
 execute body;
end $$;

-- Multi-market curriculum-aligned contexts need a selected curriculum source in every selected market.
do $$ declare body text; begin
 body:=pg_get_functiondef('quizbox_market.validate_context(text,text,uuid[],uuid[])'::regprocedure);
 if position(' return jsonb_build_object(''scope'',p_scope' in body)=0 then raise exception 'CONTEXT_CONTRACT_MISMATCH'; end if;
 body:=replace(body,' return jsonb_build_object(''scope'',p_scope',
  ' if p_mode in (''CURRICULUM_ALIGNED'',''HYBRID'') and p_scope<>''GLOBAL'' and exists(select 1 from unnest(p_markets) mk where not exists(select 1 from public.source_documents d where d.id=any(p_sources) and d.market_id=mk and d.source_kind=''CURRICULUM'')) then raise exception ''QB_MARKET_CURRICULUM_SOURCE_REQUIRED''; end if;
 return jsonb_build_object(''scope'',p_scope');
 execute body;
end $$;

-- Launch gate: exact blockers, no country-specific rules.
create function quizbox_market.market_readiness(p_market uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m public.markets; b jsonb:='[]'; cfg jsonb;
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
 if not exists(select 1 from public.user_market_memberships u join public.profiles p on p.id=u.user_id where u.market_id=m.id and u.active and lower(p.role::text) in ('admin','owner')) then b:=b||'"MARKET_ADMIN_MISSING"'; end if;
 return jsonb_build_object('market_id',m.id,'status',m.status,'ready',jsonb_array_length(b)=0,'blockers',b,
  'sme_coverage',(select count(distinct d.reviewer_id) from public.sme_domain_assignments d join public.sme_profiles s on s.user_id=d.reviewer_id where d.active and s.active and s.reviewer_status='verified' and (d.market_id=m.id or d.market_id is null)));
end $$;

-- Signup catalogue: countries with their availability. Test markets only when explicitly enabled.
create function public.qb_signup_markets() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('country_code',c.iso2_code,'country',c.name,'market_id',m.id,'market',m.name,'available',m.id is not null,
   'locale',coalesce(m.locale,c.locale),'education_levels',coalesce(m.configuration->'education_levels','[]'),'grades',coalesce(m.configuration->'grades','[]'),'subjects',coalesce(m.configuration->'subjects','[]'))
   order by c.name),'[]')
 from public.countries c left join lateral (select * from public.markets x where x.country_id=c.id and x.status='ACTIVE'
   and (not x.is_test or exists(select 1 from public.feature_flags f where f.feature_code='TEST_MARKETS_VISIBLE' and f.enabled)) order by x.name limit 1) m on true
 where c.active and (m.id is not null or not exists(select 1 from public.markets t where t.country_id=c.id and t.is_test));
$$;

-- Country-first onboarding for the signed-in user. Roles: student, teacher, sponsor; SME is an
-- approval-controlled application layered on a base role.
create function public.qb_complete_onboarding(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users; me public.profiles; m public.markets; r text; levels jsonb; grades jsonb; g jsonb; sponsor uuid;
begin
 select * into u from auth.users where id=auth.uid(); if u.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if lower(u.email) like '%@quizbox.local' and not exists(select 1 from public.profiles where id=u.id) then raise exception 'QB_RESERVED_TEST_IDENTITY'; end if;
 select * into me from public.profiles where id=u.id;
 if me.onboarding_completed_at is not null then raise exception 'ONBOARDING_ALREADY_COMPLETE'; end if;
 select m2.* into m from public.markets m2 join public.countries c on c.id=m2.country_id where c.iso2_code=upper(p->>'country_code') and m2.status='ACTIVE' and c.active
  and (not m2.is_test or exists(select 1 from public.feature_flags f where f.feature_code='TEST_MARKETS_VISIBLE' and f.enabled)) order by m2.name limit 1;
 if m.id is null then raise exception 'QB_COUNTRY_NOT_AVAILABLE'; end if;
 r:=lower(coalesce(p->>'role','')); if r not in ('student','teacher','sponsor') then raise exception 'QB_INVALID_ONBOARDING_ROLE'; end if;
 levels:=coalesce(m.configuration->'education_levels','[]'); grades:=coalesce(m.configuration->'grades','[]');
 insert into public.profiles(id,role,full_name,email,status,country,school_name,default_market_id,primary_market_id,onboarding_completed_at)
 values(u.id,r::public.qb_role,coalesce(nullif(left(btrim(p->>'full_name'),150),''),nullif(left(u.raw_user_meta_data->>'full_name',150),''),'QuizBox user'),u.email,'active',
  (select name from public.countries where id=m.country_id),nullif(left(btrim(p->>'school_name'),200),''),m.id,m.id,now())
 on conflict(id) do update set role=excluded.role,full_name=excluded.full_name,country=excluded.country,school_name=excluded.school_name,
  default_market_id=excluded.default_market_id,primary_market_id=excluded.primary_market_id,onboarding_completed_at=excluded.onboarding_completed_at;
 insert into public.user_market_memberships(user_id,market_id,active) values(u.id,m.id,true) on conflict(user_id,market_id) do update set active=true;
 if r='student' then
  select x into g from jsonb_array_elements(grades) x where x->>'code'=p->>'grade_code' limit 1;
  if g is null then raise exception 'QB_GRADE_REQUIRED'; end if;
  insert into public.student_profiles(user_id,grade,grade_code,education_level,subjects,school_name,country,status,institution_id)
  values(u.id,case when exists(select 1 from pg_enum where enumtypid='public.qb_grade'::regtype and enumlabel=g->>'code') then (g->>'code')::public.qb_grade end,
   g->>'code',coalesce(g->>'level',p->>'education_level'),coalesce(array(select jsonb_array_elements_text(p->'subjects')),'{}'),nullif(left(btrim(p->>'school_name'),200),''),
   (select name from public.countries where id=m.country_id),'active',nullif(p->>'institution_id','')::uuid);
 elsif r='teacher' then
  if nullif(btrim(p->>'school_name'),'') is null then raise exception 'QB_SCHOOL_REQUIRED'; end if;
  if exists(select 1 from jsonb_array_elements_text(coalesce(p->'grade_codes','[]')) x where not exists(select 1 from jsonb_array_elements(grades) y where y->>'code'=x)) then raise exception 'QB_INVALID_GRADE'; end if;
  insert into public.teacher_profiles(user_id,school_name,country,status,institution_id,subjects,grade_codes,education_levels)
  values(u.id,nullif(left(btrim(p->>'school_name'),200),''),(select name from public.countries where id=m.country_id),'active',nullif(p->>'institution_id','')::uuid,
   coalesce(array(select jsonb_array_elements_text(p->'subjects')),'{}'),coalesce(array(select jsonb_array_elements_text(p->'grade_codes')),'{}'),coalesce(array(select jsonb_array_elements_text(p->'education_levels')),'{}'));
 elsif r='sponsor' then
  if nullif(btrim(p->>'organization_name'),'') is null or nullif(btrim(p->>'contact_email'),'') is null then raise exception 'QB_SPONSOR_DETAILS_REQUIRED'; end if;
  insert into public.sponsor_profiles(user_id,organization_name,contact_name,country,status,sponsor_type,verification_status)
  values(u.id,left(btrim(p->>'organization_name'),200),left(btrim(coalesce(p->>'contact_name','')),150),(select name from public.countries where id=m.country_id),'ACTIVE','ORGANIZATION','PENDING') returning id into sponsor;
 end if;
 -- SME applications are recorded for Super Admin review; no review access is granted here.
 if coalesce((p->>'apply_sme')::boolean,false) then
  insert into public.sme_profiles(user_id,reviewer_status,country_id,reviewer_tier,qualification_summary,years_experience,payment_status,active,requested_domains)
  values(u.id,'pending',m.country_id,'applicant',left(coalesce(p->>'qualifications',''),2000),greatest(coalesce((p->>'years_experience')::integer,0),0),'pending',false,
   coalesce((select jsonb_agg(jsonb_build_object('subject_code',s,'market_id',m.id,'education_levels',coalesce(p->'education_levels','[]'))) from jsonb_array_elements_text(coalesce(p->'subjects','[]')) s),'[]'))
  on conflict(user_id) do nothing;
 end if;
 return jsonb_build_object('role',r,'market',m.name,'country_code',upper(p->>'country_code'),'sponsor_id',sponsor);
end $$;

-- Account view: primary vs active market, authorized markets, pending change request.
create function public.qb_my_account() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('role',p.role,'full_name',p.full_name,'email',p.email,'country',p.country,'school_name',p.school_name,'onboarded',p.onboarding_completed_at is not null,
  'primary_market',(select jsonb_build_object('id',m.id,'name',m.name,'locale',m.locale,'timezone',m.timezone,'currency',m.default_currency_code) from public.markets m where m.id=p.primary_market_id),
  'active_market',(select jsonb_build_object('id',m.id,'name',m.name) from public.markets m where m.id=p.default_market_id),
  'authorized_markets',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'primary',m.id=p.primary_market_id) order by m.name) from public.user_market_memberships u join public.markets m on m.id=u.market_id where u.user_id=p.id and u.active and m.active),'[]'),
  'student',(select jsonb_build_object('grade_code',coalesce(s.grade_code,s.grade::text),'education_level',s.education_level,'subjects',s.subjects) from public.student_profiles s where s.user_id=p.id limit 1),
  'teacher',(select jsonb_build_object('subjects',t.subjects,'grade_codes',t.grade_codes,'education_levels',t.education_levels) from public.teacher_profiles t where t.user_id=p.id limit 1),
  'pending_market_change',(select jsonb_build_object('id',r.id,'to_market',(select name from public.markets where id=r.to_market_id),'created_at',r.created_at) from public.market_change_requests r where r.user_id=p.id and r.status='PENDING'))
 from public.profiles p where p.id=auth.uid();
$$;

-- Changing the primary market changes the curriculum environment: request + Super Admin decision.
create function public.qb_request_market_change(p_to_market uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare me public.profiles; result public.market_change_requests;
begin
 select * into me from public.profiles where id=auth.uid() and lower(status::text)='active'; if me.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if not exists(select 1 from public.markets where id=p_to_market and status='ACTIVE') then raise exception 'QB_MARKET_NOT_AVAILABLE'; end if;
 if p_to_market=me.primary_market_id then raise exception 'QB_MARKET_UNCHANGED'; end if;
 insert into public.market_change_requests(user_id,from_market_id,to_market_id,reason) values(me.id,me.primary_market_id,p_to_market,left(btrim(p_reason),500)) returning * into result;
 return to_jsonb(result);
end $$;

-- Teacher cross-grade assignment requires an explicit override with reason, recorded in the audit log.
create function public.qb_set_assignment_grade_override(p_assignment uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.assignments;
begin
 select * into a from public.assignments where id=p_assignment and teacher_user_id=auth.uid() for update;
 if a.id is null then raise exception 'QB_ASSIGNMENT_ACCESS_DENIED' using errcode='42501'; end if;
 if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'QB_OVERRIDE_REASON_REQUIRED'; end if;
 update public.assignments set grade_override=true,grade_override_reason=btrim(p_reason),grade_override_by=auth.uid() where id=a.id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_ASSIGNMENT_GRADE_OVERRIDE','assignments',a.id,'pass',jsonb_build_object('reason',btrim(p_reason)));
 return jsonb_build_object('assignment_id',a.id,'grade_override',true);
end $$;

-- Super Admin market operations.
create function public.qb_market_admin(p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.markets; c public.countries; rq public.market_change_requests; readiness jsonb; target text; allowed text[]; cur public.curricula; result jsonb;
begin
 if not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode='42501'; end if;
 if p_action='list' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'country',co.name,'country_code',co.iso2_code,'currency',x.default_currency_code,'timezone',x.timezone,'locale',x.locale,
    'status',x.status,'is_test',x.is_test,'configuration',x.configuration,'readiness',quizbox_market.market_readiness(x.id)) order by co.name,x.name) from public.markets x join public.countries co on co.id=x.country_id),'[]');
 elsif p_action='save_market' then
  if nullif(p_data->>'currency_code','') is null or not exists(select 1 from public.currencies where code=upper(p_data->>'currency_code')) then
   if nullif(p_data->>'currency_name','') is null then raise exception 'CURRENCY_REQUIRED'; end if;
   insert into public.currencies(code,name,symbol,decimal_places,active) values(upper(p_data->>'currency_code'),p_data->>'currency_name',coalesce(nullif(p_data->>'currency_symbol',''),upper(p_data->>'currency_code')),coalesce((p_data->>'decimal_places')::integer,2),true);
  end if;
  select * into c from public.countries where iso2_code=upper(p_data->>'country_code');
  if c.id is null then
   insert into public.countries(iso2_code,iso3_code,name,default_currency_code,timezone,locale) values(upper(p_data->>'country_code'),upper(p_data->>'country_iso3'),p_data->>'country_name',upper(p_data->>'currency_code'),p_data->>'timezone',p_data->>'locale') returning * into c;
  end if;
  if nullif(p_data->>'id','') is null then
   insert into public.markets(country_id,name,default_currency_code,timezone,locale,status,is_test,configuration)
   values(c.id,p_data->>'name',upper(p_data->>'currency_code'),p_data->>'timezone',p_data->>'locale','DRAFT',coalesce((p_data->>'is_test')::boolean,false),coalesce(p_data->'configuration','{}')) returning * into m;
  else
   update public.markets set name=p_data->>'name',default_currency_code=upper(p_data->>'currency_code'),timezone=p_data->>'timezone',locale=p_data->>'locale',
    is_test=coalesce((p_data->>'is_test')::boolean,is_test),configuration=coalesce(p_data->'configuration',configuration) where id=(p_data->>'id')::uuid returning * into m;
  end if;
  if m.id is null then raise exception 'MARKET_NOT_FOUND'; end if;
  return to_jsonb(m)||jsonb_build_object('readiness',quizbox_market.market_readiness(m.id));
 elsif p_action='set_status' then
  select * into m from public.markets where id=(p_data->>'market_id')::uuid for update; if m.id is null then raise exception 'MARKET_NOT_FOUND'; end if;
  target:=p_data->>'status';
  allowed:=case m.status when 'DRAFT' then array['CONFIGURING'] when 'CONFIGURING' then array['DRAFT','READY'] when 'READY' then array['CONFIGURING','ACTIVE']
   when 'ACTIVE' then array['SUSPENDED'] when 'SUSPENDED' then array['ACTIVE','CONFIGURING'] end;
  if not target=any(allowed) then raise exception 'INVALID_MARKET_TRANSITION'; end if;
  readiness:=quizbox_market.market_readiness(m.id);
  if target in ('READY','ACTIVE') and not (readiness->>'ready')::boolean then return jsonb_build_object('status',m.status,'changed',false,'blockers',readiness->'blockers'); end if;
  update public.markets set status=target where id=m.id;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_MARKET_STATUS','markets',m.id,'pass',jsonb_build_object('from',m.status,'to',target));
  return jsonb_build_object('status',target,'changed',true,'blockers','[]'::jsonb);
 elsif p_action='readiness' then
  return quizbox_market.market_readiness((p_data->>'market_id')::uuid);
 elsif p_action='save_curriculum' then
  -- New curricula are created inactive in their market; activation is a separate reviewed step.
  insert into public.curricula(id,code,name,country,version,status,market_id,effective_from,effective_to,source_name,source_hash)
  select gen_random_uuid(),p_data->>'code',p_data->>'name',co.name,p_data->>'version','ACTIVE',x.id,nullif(p_data->>'effective_from','')::date,nullif(p_data->>'effective_to','')::date,nullif(p_data->>'source_name',''),nullif(p_data->>'source_hash','')
  from public.markets x join public.countries co on co.id=x.country_id where x.id=(p_data->>'market_id')::uuid returning * into cur;
  if cur.id is null then raise exception 'MARKET_NOT_FOUND'; end if;
  insert into public.market_curricula(curriculum_id,market_id,authority_id,active) values(cur.id,cur.market_id,nullif(p_data->>'authority_id','')::uuid,false);
  return to_jsonb(cur);
 elsif p_action='change_requests' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'user',p.full_name,'role',p.role,'from',(select name from public.markets where id=r.from_market_id),'to',(select name from public.markets where id=r.to_market_id),'reason',r.reason,'status',r.status,'created_at',r.created_at) order by r.created_at desc)
   from public.market_change_requests r join public.profiles p on p.id=r.user_id where coalesce(p_data->>'status','PENDING')=r.status),'[]');
 elsif p_action='decide_change' then
  select * into rq from public.market_change_requests where id=(p_data->>'request_id')::uuid and status='PENDING' for update; if rq.id is null then raise exception 'REQUEST_NOT_PENDING'; end if;
  if p_data->>'decision' not in ('APPROVED','REJECTED') then raise exception 'INVALID_DECISION'; end if;
  update public.market_change_requests set status=p_data->>'decision',decided_by=auth.uid(),decided_at=now(),decision_note=left(p_data->>'note',500) where id=rq.id;
  if p_data->>'decision'='APPROVED' then
   insert into public.user_market_memberships(user_id,market_id,active) values(rq.user_id,rq.to_market_id,true) on conflict(user_id,market_id) do update set active=true;
   update public.profiles set primary_market_id=rq.to_market_id,default_market_id=rq.to_market_id,active_content_context_id=null where id=rq.user_id;
   -- The previous primary market membership is deactivated for single-market roles only.
   update public.user_market_memberships set active=false where user_id=rq.user_id and market_id=rq.from_market_id
    and exists(select 1 from public.profiles where id=rq.user_id and lower(role::text) in ('student','teacher'));
  end if;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,status,details) values(auth.uid(),'QB_MARKET_CHANGE_'||(p_data->>'decision'),'market_change_requests',rq.id,'pass','{}');
  return jsonb_build_object('request_id',rq.id,'status',p_data->>'decision');
 elsif p_action='dashboard' then
  return jsonb_build_object('active_markets',(select count(*) from public.markets where status='ACTIVE' and not is_test),
   'configured_markets',(select count(*) from public.markets where status in ('READY','ACTIVE')),
   'active_competitions',(select count(*) from public.competitions where status::text in ('PUBLISHED','ACTIVE','OPEN')),
   'attempts',(select count(*) from public.attempts),
   'unresolved_source_items',(select count(*) from public.market_attribution_issues),
   'unresolved_compensation',(select count(*) from quizbox_competition.review_events where policy_context_snapshot->>'compensation_status'='COMPENSATION_UNRESOLVED'),
   'pending_market_changes',(select count(*) from public.market_change_requests where status='PENDING'),
   'markets',coalesce((select jsonb_agg(jsonb_build_object('market',x.name,'status',x.status,'is_test',x.is_test,
     'users',(select count(*) from public.profiles p where p.primary_market_id=x.id),
     'students',(select count(*) from public.profiles p where p.primary_market_id=x.id and lower(p.role::text)='student'),
     'teachers',(select count(*) from public.profiles p where p.primary_market_id=x.id and lower(p.role::text)='teacher'),
     'sponsors',(select count(*) from public.profiles p where p.primary_market_id=x.id and lower(p.role::text)='sponsor'),
     'smes',(select count(distinct d.reviewer_id) from public.sme_domain_assignments d where d.market_id=x.id and d.active),
     'questions',(select count(*) from public.legacy_content_attributions l where l.market_id=x.id),
     'approved_questions',(select count(*) from public.legacy_content_attributions l join public.questions q on q.id=l.question_id where l.market_id=x.id and q.validation_status='approved' and q.status::text='active'),
     'ready',(quizbox_market.market_readiness(x.id)->>'ready')::boolean) order by x.name) from public.markets x),'[]'));
 end if;
 raise exception 'INVALID_MARKET_ACTION';
end $$;

revoke all on function quizbox_market.sync_market_active(),quizbox_market.student_grade_code(uuid),quizbox_market.grade_policy_applies(uuid),quizbox_market.market_readiness(uuid) from public,anon,authenticated;
grant execute on function quizbox_market.student_grade_code(uuid),quizbox_market.grade_policy_applies(uuid) to authenticated;
revoke all on function public.qb_signup_markets(),public.qb_complete_onboarding(jsonb),public.qb_my_account(),public.qb_request_market_change(uuid,text),public.qb_set_assignment_grade_override(uuid,text),public.qb_market_admin(text,jsonb) from public,anon;
grant execute on function public.qb_signup_markets() to anon,authenticated;
grant execute on function public.qb_complete_onboarding(jsonb),public.qb_my_account(),public.qb_request_market_change(uuid,text),public.qb_set_assignment_grade_override(uuid,text),public.qb_market_admin(text,jsonb) to authenticated;
commit;
