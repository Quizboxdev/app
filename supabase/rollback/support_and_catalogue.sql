-- Rolls back 20261012180000_reviewer_support_and_catalogue.sql: restores the two functions and the two read policies; drops the catalogue function.
-- The sme_support capability value stays valid in the constraint; any grants of it simply stop having an effect.
begin;
create or replace function public.qb_sme_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('super_admin',quizbox_sme.has_capability('super_admin'),'finance_admin',quizbox_sme.has_capability('finance_admin'),
 'content_admin',quizbox_sme.has_capability('content_admin'), 'reviewer',exists(select 1 from public.sme_profiles where user_id=auth.uid() and active and reviewer_status='verified'));
$$;
create or replace function public.qb_sme_configure(p_entity text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
drop policy if exists sme_read on public.sme_profiles;
create policy sme_read on public.sme_profiles for select to authenticated using (quizbox_sme.has_capability('super_admin') or user_id=auth.uid() or quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('finance_admin'));
drop policy if exists sme_read on public.sme_domain_assignments;
create policy sme_read on public.sme_domain_assignments for select to authenticated using (quizbox_sme.has_capability('super_admin') or reviewer_id=auth.uid() or quizbox_sme.has_capability('content_admin') or quizbox_sme.has_capability('finance_admin'));
drop function if exists public.qb_curriculum_catalogue();
commit;
