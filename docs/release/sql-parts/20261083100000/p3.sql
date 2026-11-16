create or replace function public.qb_admin_families() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not (quizbox_core.is_staff() or quizbox_market.is_super()) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object('generated_at', now(),
    'workspaces', (select count(*) from public.family_workspaces),
    'children_linked', (select count(*) from public.account_relationships where family_workspace_id is not null and status = 'active'),
    'requests_waiting', (select count(*) from public.account_relationships where family_workspace_id is not null and status = 'requested'),
    'invitations_waiting', (select count(*) from public.family_invitations where status = 'pending' and expires_at > now()),
    'orders', coalesce((select jsonb_object_agg(s.status, s.c) from (select status, count(*)::integer as c from public.family_orders group by status) s), '{}'::jsonb),
    'paid_minor', coalesce((select sum(total_minor) from public.family_orders where status in ('paid', 'fulfilled')), 0),
    'family_assignments', (select count(*) from public.assignments where source_type = 'family'),
    'families', coalesce((select jsonb_agg(f.j order by f.created_at desc) from (
        select w.created_at, jsonb_build_object('workspace_id', w.id, 'owner', p.full_name, 'email', p.email, 'created_at', w.created_at,
          'children', (select count(*) from public.account_relationships r where r.family_workspace_id = w.id and r.status = 'active'),
          'orders', (select count(*) from public.family_orders o where o.workspace_id = w.id),
          'spent_minor', coalesce((select sum(o.total_minor) from public.family_orders o where o.workspace_id = w.id and o.status in ('paid', 'fulfilled')), 0),
          'assignments', (select count(*) from public.assignments x where x.workspace_id = w.id)) as j
        from public.family_workspaces w join public.profiles p on p.id = w.owner_user_id order by w.created_at desc limit 100) f), '[]'::jsonb));
end $fn$;

create or replace function public.qb_admin_family_detail(p_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare w public.family_workspaces;
begin
  if auth.uid() is null or not (quizbox_core.is_staff() or quizbox_market.is_super()) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into w from public.family_workspaces where id = p_workspace;
  if w.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('workspace_id', w.id, 'name', w.name, 'created_at', w.created_at,
    'owner', (select jsonb_build_object('name', p.full_name, 'email', p.email, 'role', p.role) from public.profiles p where p.id = w.owner_user_id),
    'children', coalesce((select jsonb_agg(jsonb_build_object('student_id', r.target_user_id, 'name', p.full_name, 'grade_code', sp.grade_code, 'type', r.relationship_type, 'status', r.status, 'since', r.created_at, 'minor', coalesce(sp.is_minor, false)) order by p.full_name)
        from public.account_relationships r join public.profiles p on p.id = r.target_user_id left join public.student_profiles sp on sp.user_id = r.target_user_id where r.family_workspace_id = w.id), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('reference', o.reference, 'kind', o.kind, 'status', o.status, 'total_minor', o.total_minor, 'created_at', o.created_at) order by o.created_at desc) from (select * from public.family_orders where workspace_id = w.id order by created_at desc limit 30) o), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'status', l.status) order by l.created_at desc)
        from (select action, created_at, status from public.audit_logs where actor_user_id = w.owner_user_id and action like 'family.%' order by created_at desc limit 50) l), '[]'::jsonb));
end $fn$;

revoke all on function public.qb_family_progress(integer), public.qb_family_child_progress(uuid, integer), public.qb_admin_families(), public.qb_admin_family_detail(uuid) from public, anon, authenticated;
grant execute on function public.qb_family_progress(integer), public.qb_family_child_progress(uuid, integer), public.qb_admin_families(), public.qb_admin_family_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
