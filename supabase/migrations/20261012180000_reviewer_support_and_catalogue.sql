-- Reviewer support and the curriculum pool for admin forms (2026-10-12).
--   1. New capability 'sme_support': a super admin can let a support person onboard reviewers and grant reviewer domains
--      (sme_profiles and sme_domain_assignments only; markets, currencies, compensation and capabilities stay super-admin).
--   2. qb_curriculum_catalogue(): the levels, grades and subjects that exist in the active curricula, per market, so admin forms offer
--      them as dropdowns instead of free text.
-- Replaces two functions and two read policies; adds one function. No table or data changes. Rollback: supabase/rollback/support_and_catalogue.sql.
begin;

alter table public.user_capabilities drop constraint if exists user_capabilities_capability_check;
alter table public.user_capabilities add constraint user_capabilities_capability_check check (capability in (
 'super_admin','content_admin','sme_reviewer','senior_sme_reviewer','competition_admin','sponsor_admin','finance_admin',
 'platform_admin','content_manager','competition_manager','support_agent','school_admin','school_owner','sponsor_user','parent_guardian','senior_reviewer',
 'sme_support'));

create or replace function public.qb_sme_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('super_admin',quizbox_sme.has_capability('super_admin'),'finance_admin',quizbox_sme.has_capability('finance_admin'),
 'content_admin',quizbox_sme.has_capability('content_admin'),'sme_support',quizbox_sme.has_capability('sme_support'),
 'reviewer',exists(select 1 from public.sme_profiles where user_id=auth.uid() and active and reviewer_status='verified'));
$$;

create or replace function public.qb_sme_configure(p_entity text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare key text; columns text; values_sql text; updates text; partial_updates text; result jsonb; payload jsonb:=p_data; table_id regclass;
begin
 if not quizbox_sme.has_capability('super_admin') then
  -- A reviewer-support person (capability sme_support, granted by a super admin) manages reviewer profiles and their domains only:
  -- never currencies, countries, markets, compensation or capabilities.
  if not (quizbox_sme.has_capability('sme_support') and p_entity in ('sme_profiles','sme_domain_assignments')) then raise exception 'QB_SME_CONFIGURATION_DENIED' using errcode='42501'; end if;
 end if;
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

-- Reviewer-support people can read the two tables they manage.
drop policy if exists sme_read on public.sme_profiles;
create policy sme_read on public.sme_profiles for select to authenticated using (
  quizbox_sme.has_capability('super_admin') or user_id=auth.uid() or quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('finance_admin')
  or quizbox_sme.has_capability('sme_support'));
drop policy if exists sme_read on public.sme_domain_assignments;
create policy sme_read on public.sme_domain_assignments for select to authenticated using (
  quizbox_sme.has_capability('super_admin') or reviewer_id=auth.uid() or quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('finance_admin')
  or quizbox_sme.has_capability('sme_support'));

-- The curriculum pool: every level, grade and subject that exists in an active curriculum of a market. Admin forms use it for cascading dropdowns.
create or replace function public.qb_curriculum_catalogue() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not (quizbox_sme.has_capability('super_admin') or quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('sme_support')) then
    raise exception 'QB_CATALOGUE_ACCESS_DENIED' using errcode='42501';
  end if;
  return jsonb_build_object(
    'markets', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name) from public.markets m where m.active), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('market_id', x.market_id, 'level', x.level, 'grade', x.grade, 'subject', x.subject) order by x.level, x.grade, x.subject)
      from (select distinct mc.market_id, n.education_level as level, coalesce(n.canonical_grade_code, n.grade_code) as grade, n.subject_code as subject
              from public.curriculum_nodes n
              join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
             where n.is_active and n.node_type = 'subject' and n.subject_code is not null and n.education_level is not null
               and coalesce(n.canonical_grade_code, n.grade_code) is not null) x), '[]'::jsonb));
end $$;
revoke all on function public.qb_curriculum_catalogue() from public, anon;
grant execute on function public.qb_curriculum_catalogue() to authenticated;

commit;
