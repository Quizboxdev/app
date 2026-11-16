create or replace function public.qb_family_open(p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w public.family_workspaces; r text;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select lower(role::text) into r from public.profiles where id = uid;
  if r is null or r = 'student' then raise exception 'QB_FAMILY_NOT_ADULT' using errcode = '42501'; end if;
  select * into w from public.family_workspaces where owner_user_id = uid;
  if w.id is null then
    insert into public.family_workspaces(owner_user_id, name) values (uid, coalesce(nullif(btrim(p_name), ''), 'My family')) returning * into w;
    perform quizbox_core.audit('family.workspace_open', 'family_workspaces', w.id, '{}'::jsonb);
  end if;
  return jsonb_build_object('id', w.id, 'name', w.name);
end $fn$;

create or replace function public.qb_family_children() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', r.target_user_id, 'relationship_id', r.id, 'relationship_type', r.relationship_type, 'status', r.status,
      'permissions', r.permissions, 'full_name', p.full_name, 'grade_code', sp.grade_code, 'school_name', sp.school_name) order by p.full_name)
    from public.account_relationships r join public.family_workspaces w on w.id = r.family_workspace_id and w.owner_user_id = uid
    join public.profiles p on p.id = r.target_user_id left join public.student_profiles sp on sp.user_id = r.target_user_id
    where r.source_user_id = uid and r.status in ('active', 'pending_verification', 'requested')), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_child_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not quizbox_core.family_can(uid, p_student, 'view_progress') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  return (select jsonb_build_object('student_id', p.id, 'full_name', p.full_name, 'grade_code', sp.grade_code, 'school_name', sp.school_name)
            from public.profiles p left join public.student_profiles sp on sp.user_id = p.id where p.id = p_student);
end $fn$;

create or replace function public.qb_family_revoke(p_student uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  update public.account_relationships set status = 'revoked', updated_at = now()
   where source_user_id = uid and target_user_id = p_student and family_workspace_id is not null and status <> 'revoked';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  perform quizbox_core.audit('family.child_unlink', 'account_relationships', null, jsonb_build_object('student', p_student));
  return jsonb_build_object('revoked', n);
end $fn$;

create or replace function public.qb_family_attach_child(p_parent uuid, p_student uuid, p_type text default 'parent') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare w public.family_workspaces; r public.account_relationships; perms jsonb;
begin
  if p_type not in ('parent', 'guardian', 'mentor', 'academic_parent', 'sponsor') or p_parent is null or p_student is null or p_parent = p_student then raise exception 'QB_FAMILY_INVALID'; end if;
  if not exists (select 1 from public.profiles where id = p_parent and lower(role::text) <> 'student') then raise exception 'QB_FAMILY_NOT_ADULT'; end if;
  if not exists (select 1 from public.profiles where id = p_student and lower(role::text) = 'student') then raise exception 'QB_FAMILY_INVALID'; end if;
  select * into w from public.family_workspaces where owner_user_id = p_parent;
  if w.id is null then insert into public.family_workspaces(owner_user_id) values (p_parent) returning * into w; end if;
  perms := quizbox_core.family_default_permissions(p_type);
  select * into r from public.account_relationships where source_user_id = p_parent and target_user_id = p_student and relationship_type = p_type and status <> 'revoked';
  if r.id is null then
    insert into public.account_relationships(source_user_id, target_user_id, relationship_type, status, can_fund, can_view_progress, can_manage_account, consent_status, family_workspace_id, permissions, created_by)
    values (p_parent, p_student, p_type, 'active', coalesce((perms ->> 'buy_coins')::boolean, false), coalesce((perms ->> 'view_progress')::boolean, false), coalesce((perms ->> 'manage_access')::boolean, false), 'granted', w.id, perms, p_parent)
    returning * into r;
    insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
    values (p_parent, 'family.child_attach', 'account_relationships', r.id, 'pass', jsonb_build_object('student', p_student, 'type', p_type, 'workspace', w.id));
  end if;
  return jsonb_build_object('relationship_id', r.id, 'workspace_id', w.id, 'status', r.status);
end $fn$;

revoke all on function quizbox_core.family_default_permissions(text), quizbox_core.family_can(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.qb_family_can(uuid, text), public.qb_family_open(text), public.qb_family_children(), public.qb_family_child_summary(uuid), public.qb_family_revoke(uuid), public.qb_family_attach_child(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.qb_family_can(uuid, text), public.qb_family_open(text), public.qb_family_children(), public.qb_family_child_summary(uuid), public.qb_family_revoke(uuid) to authenticated;

notify pgrst, 'reload schema';
