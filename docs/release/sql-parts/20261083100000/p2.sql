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
