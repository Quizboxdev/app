-- Lifecycle tools for teacher-managed learners under 13 (docs/security/UNDER_13_DESIGN.md, "known limits" 2, 3 and 5).
--   qb_managed_overview()            owner: every school and class with active, ended, erased and due-for-erasure counts, plus the automatic-erase switch
--   qb_managed_reassign(from, to, move_classes)   owner: a teacher leaves; their managed learners (and optionally their classes) move to another teacher, by email
--   qb_managed_set_auto_erase(on)    owner: switch the scheduled 12-month erasure on or off (OFF by default until counsel has confirmed the retention rule)
--   qb_managed_erasure_due(limit)    service role: the learners the scheduled job may erase now (empty unless the switch is on)
--   qb_managed_erasure_queue()       replaced: honours the retention months setting instead of a fixed 12
-- Settings (platform_settings, global): safety.managed_auto_erase (false), safety.managed_retention_months (12, allowed 6 to 36).
-- Additive and idempotent. Rollback: supabase/rollback/managed_learner_lifecycle.sql.
begin;

insert into public.platform_settings(key, scope_type, value, description)
select 'safety.managed_auto_erase', 'global', 'false'::jsonb, 'When true, a scheduled job erases ended managed learner accounts after the retention period. Switch on only after counsel confirms the rule.'
 where not exists (select 1 from public.platform_settings where key = 'safety.managed_auto_erase' and scope_type = 'global');
insert into public.platform_settings(key, scope_type, value, description)
select 'safety.managed_retention_months', 'global', '12'::jsonb, 'Months an ended managed learner account is kept before its personal data is erased (6 to 36).'
 where not exists (select 1 from public.platform_settings where key = 'safety.managed_retention_months' and scope_type = 'global');

create or replace function public.qb_managed_retention_months() returns integer language sql stable security definer set search_path = '' as $fn$
  select greatest(6, least(36, coalesce((select (s.value #>> '{}')::integer from public.platform_settings s where s.key = 'safety.managed_retention_months' and s.scope_type = 'global' limit 1), 12)));
$fn$;
revoke all on function public.qb_managed_retention_months() from public, anon, authenticated;

create or replace function public.qb_managed_auto_erase_on() returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select (s.value #>> '{}')::boolean from public.platform_settings s where s.key = 'safety.managed_auto_erase' and s.scope_type = 'global' limit 1), false);
$fn$;
revoke all on function public.qb_managed_auto_erase_on() from public, anon, authenticated;

create or replace function public.qb_managed_erasure_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', sp.user_id, 'first_name', p.full_name, 'username', split_part(p.email, '@', 1), 'ended_at', sp.archived_at) order by sp.archived_at)
    from public.student_profiles sp join public.profiles p on p.id = sp.user_id
   where sp.managed_by is not null and sp.is_minor and sp.erased_at is null and sp.archived_at is not null and sp.archived_at < now() - make_interval(months => public.qb_managed_retention_months())), '[]'::jsonb);
end $fn$;

create or replace function public.qb_managed_erasure_due(p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not public.qb_managed_auto_erase_on() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', t.user_id, 'ended_at', t.archived_at, 'months', public.qb_managed_retention_months())) from (
    select sp.user_id, sp.archived_at from public.student_profiles sp
     where sp.managed_by is not null and sp.is_minor and sp.erased_at is null and sp.archived_at is not null and sp.archived_at < now() - make_interval(months => public.qb_managed_retention_months())
     order by sp.archived_at limit least(greatest(coalesce(p_limit, 25), 1), 100)) t), '[]'::jsonb);
end $fn$;
revoke all on function public.qb_managed_erasure_due(integer) from public, anon, authenticated;
grant execute on function public.qb_managed_erasure_due(integer) to service_role;

create or replace function public.qb_managed_set_auto_erase(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'INVALID_VALUE' using errcode = '22023'; end if;
  update public.platform_settings set value = to_jsonb(p_enabled), updated_by = auth.uid(), updated_at = now() where key = 'safety.managed_auto_erase' and scope_type = 'global';
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), 'QB_MANAGED_AUTO_ERASE_SET', 'platform_settings', null, 'pass', jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('auto_erase', p_enabled);
end $fn$;

create or replace function public.qb_managed_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object('auto_erase', public.qb_managed_auto_erase_on(), 'retention_months', public.qb_managed_retention_months(),
    'classes', coalesce((select jsonb_agg(row_to_json(t) order by t.school, t.class_name) from (
      select coalesce(c.school_name, 'No school') as school, c.id as class_id, c.class_name, tp.full_name as teacher_name, tp.email as teacher_email,
             count(*) filter (where m.archived_at is null) as active,
             count(*) filter (where m.archived_at is not null and m.erased_at is null) as ended,
             count(*) filter (where m.erased_at is not null) as erased,
             count(*) filter (where m.archived_at is not null and m.erased_at is null and m.archived_at < now() - make_interval(months => public.qb_managed_retention_months())) as due
        from public.classes c
        join lateral (select sp.archived_at, sp.erased_at from public.class_memberships cm join public.student_profiles sp on sp.user_id = cm.student_user_id
                       where cm.class_id = c.id and sp.managed_by is not null and sp.is_minor) m on true
        left join public.profiles tp on tp.id = c.teacher_user_id
       group by c.id, c.school_name, c.class_name, tp.full_name, tp.email) t), '[]'::jsonb));
end $fn$;

create or replace function public.qb_managed_reassign(p_from_email text, p_to_email text, p_move_classes boolean default true) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare v_from uuid; v_to uuid; moved_learners integer; moved_classes integer := 0;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  select id into v_from from public.profiles where lower(email) = lower(btrim(coalesce(p_from_email, ''))) and lower(role::text) = 'teacher';
  select id into v_to from public.profiles where lower(email) = lower(btrim(coalesce(p_to_email, ''))) and lower(role::text) = 'teacher' and lower(status::text) = 'active';
  if v_from is null or v_to is null then raise exception 'TEACHER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_from = v_to then raise exception 'SAME_TEACHER' using errcode = '22023'; end if;
  update public.student_profiles set managed_by = v_to where managed_by = v_from and is_minor;
  get diagnostics moved_learners = row_count;
  if coalesce(p_move_classes, true) then
    update public.classes set teacher_user_id = v_to where teacher_user_id = v_from;
    get diagnostics moved_classes = row_count;
  end if;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
  values (auth.uid(), 'QB_MANAGED_REASSIGNED', 'profiles', v_from, 'pass', jsonb_build_object('to', v_to, 'learners', moved_learners, 'classes', moved_classes));
  return jsonb_build_object('learners', moved_learners, 'classes', moved_classes);
end $fn$;

