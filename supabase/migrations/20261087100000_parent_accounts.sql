-- Parent accounts (Family workspace). A parent signs up with the parent role and is stored the way a
-- sponsor is: one profile role plus one profile-type row (parent_profiles, like sponsor_profiles).
-- Children stay linked through account_relationships with family_workspace_id, which is the table of
-- a parent's children. Closed while flags.family_workspace is off: onboarding refuses the parent role.
-- Replaces quizbox_core.held_roles and public.qb_complete_onboarding (copied from their latest definitions, parent branch added).
-- Rollback: supabase/rollback/parent_accounts.sql

alter type public.qb_role add value if not exists 'parent';

create table if not exists public.parent_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  full_name text,
  country text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.parent_profiles enable row level security;
drop policy if exists parent_profiles_read_own on public.parent_profiles;
create policy parent_profiles_read_own on public.parent_profiles for select to authenticated using (user_id = auth.uid());
revoke all on public.parent_profiles from anon, authenticated;
grant select on public.parent_profiles to authenticated;

create or replace function quizbox_core.held_roles(p_user uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct x order by x),'{}') from (
  select case lower(role::text) when 'student' then 'student' when 'teacher' then 'teacher' when 'admin' then 'platform_admin'
    when 'owner' then 'super_admin' when 'sponsor' then 'sponsor_user' when 'parent' then 'parent_guardian' when 'support' then 'support_agent' end x
   from public.profiles where id=p_user and lower(status::text)='active'
  union select case capability when 'sme_reviewer' then 'sme_reviewer' when 'senior_sme_reviewer' then 'senior_reviewer' when 'content_admin' then 'content_manager'
    when 'competition_admin' then 'competition_manager' when 'sponsor_admin' then 'sponsor_admin' else capability end
   from public.user_capabilities c where user_id=p_user and active and exists(select 1 from public.profiles where id=p_user and lower(status::text)='active')
  union select case m.role::text when 'student' then 'student' when 'teacher' then 'teacher' when 'admin' then 'school_admin' when 'owner' then 'school_owner' end
   from public.institution_memberships m where m.user_id=p_user and m.status::text='active'
  union select 'parent_guardian' from public.account_relationships where source_user_id=p_user and relationship_type='guardian' and status='active'
  union select 'sponsor_user' from public.account_relationships where source_user_id=p_user and relationship_type='sponsor' and status='active'
 ) s where x is not null;
$$;

create or replace function public.qb_complete_onboarding(p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users; me public.profiles; m public.markets; r text; levels jsonb; grades jsonb; g jsonb; sponsor uuid;
begin
 select * into u from auth.users where id=auth.uid(); if u.id is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if lower(u.email) like '%@quizbox.local' and not exists(select 1 from public.profiles where id=u.id) then raise exception 'QB_RESERVED_TEST_IDENTITY'; end if;
 select * into me from public.profiles where id=u.id;
 if me.onboarding_completed_at is not null then raise exception 'ONBOARDING_ALREADY_COMPLETE'; end if;
 select m2.* into m from public.markets m2 join public.countries c on c.id=m2.country_id where c.iso2_code=upper(p->>'country_code') and m2.status='ACTIVE' and c.active
  and (not m2.is_test or exists(select 1 from public.feature_flags f where f.feature_code='TEST_MARKETS_VISIBLE' and f.enabled)) order by m2.name limit 1;
 if m.id is null then raise exception 'QB_COUNTRY_NOT_AVAILABLE'; end if;
 r:=lower(coalesce(p->>'role','')); if r not in ('student','teacher','sponsor','parent') then raise exception 'QB_INVALID_ONBOARDING_ROLE'; end if;
 if r='parent' and not coalesce(quizbox_core.flag('flags.family_workspace'),false) then raise exception 'QB_FEATURE_DISABLED' using errcode='42501'; end if;
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
 elsif r='parent' then
  insert into public.parent_profiles(user_id,full_name,country,status)
  values(u.id,nullif(left(btrim(p->>'full_name'),150),''),(select name from public.countries where id=m.country_id),'ACTIVE')
  on conflict(user_id) do update set full_name=excluded.full_name,country=excluded.country,updated_at=now();
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
