
-- A guardian's list of sponsor requests for a child they are linked to. Shows the sponsor's name, the child's name and grade.
create or replace function public.qb_family_guardian_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sponsor_name', coalesce(nullif(sp.organization_name, ''), nullif(p.full_name, ''), 'A sponsor'),
      'child_name', coalesce(nullif(c.full_name, ''), 'Your child'), 'child_grade', scp.grade_code, 'created_at', r.created_at) order by r.created_at desc)
    from public.account_relationships r
    join public.profiles p on p.id = r.source_user_id
    join public.profiles c on c.id = r.target_user_id
    left join public.sponsor_profiles sp on sp.user_id = r.source_user_id
    left join public.student_profiles scp on scp.user_id = r.target_user_id
    where r.family_workspace_id is not null and r.relationship_type = 'sponsor' and r.status = 'requested'
      and exists (select 1 from public.student_profiles m where m.user_id = r.target_user_id and m.managed_by is not null)
      and exists (select 1 from public.account_relationships g where g.source_user_id = uid and g.target_user_id = r.target_user_id and g.family_workspace_id is not null and g.status = 'active' and g.relationship_type in ('parent', 'guardian', 'academic_parent'))), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_guardian_respond(p_relationship uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); r public.account_relationships;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into r from public.account_relationships where id = p_relationship and relationship_type = 'sponsor' and family_workspace_id is not null and status = 'requested' for update;
  if r.id is null
     or not exists (select 1 from public.student_profiles m where m.user_id = r.target_user_id and m.managed_by is not null)
     or not exists (select 1 from public.account_relationships g where g.source_user_id = uid and g.target_user_id = r.target_user_id and g.family_workspace_id is not null and g.status = 'active' and g.relationship_type in ('parent', 'guardian', 'academic_parent'))
  then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(p_accept, false) then
    update public.account_relationships set status = 'active', consent_status = 'granted', verified_by = uid, verified_at = now(), updated_at = now() where id = r.id;
  else
    update public.account_relationships set status = 'revoked', consent_status = 'withdrawn', updated_at = now() where id = r.id;
  end if;
  insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
  select r.source_user_id, sp.role, 'family_link_response', 'Link ' || case when coalesce(p_accept, false) then 'accepted' else 'declined' end,
    'The guardian ' || case when coalesce(p_accept, false) then 'accepted' else 'declined' end || ' your request to link to a child as a sponsor.', 'account_relationships', r.id
    from public.profiles sp where sp.id = r.source_user_id;
  perform quizbox_core.audit('family.guardian_respond', 'account_relationships', r.id, jsonb_build_object('accepted', coalesce(p_accept, false)));
  return jsonb_build_object('accepted', coalesce(p_accept, false));
end $fn$;

-- QuizBox staff: the managed child has no guardian linked, so staff approve or decline the sponsor link.
create or replace function public.qb_family_staff_verifications() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null or not (quizbox_core.is_staff() or quizbox_market.is_super()) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'sponsor_name', coalesce(nullif(sp.organization_name, ''), nullif(p.full_name, ''), 'A sponsor'), 'sponsor_email', p.email,
      'child_name', coalesce(nullif(c.full_name, ''), 'A child'), 'child_grade', scp.grade_code, 'child_school', scp.school_name, 'created_at', r.created_at) order by r.created_at)
    from public.account_relationships r
    join public.profiles p on p.id = r.source_user_id
    join public.profiles c on c.id = r.target_user_id
    left join public.sponsor_profiles sp on sp.user_id = r.source_user_id
    left join public.student_profiles scp on scp.user_id = r.target_user_id
    where r.family_workspace_id is not null and r.relationship_type = 'sponsor' and r.status = 'pending_verification'), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_staff_decide(p_relationship uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); r public.account_relationships;
begin
  if uid is null or not (quizbox_core.is_staff() or quizbox_market.is_super()) then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  select * into r from public.account_relationships where id = p_relationship and relationship_type = 'sponsor' and family_workspace_id is not null and status = 'pending_verification' for update;
  if r.id is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(p_approve, false) then
    update public.account_relationships set status = 'active', consent_status = 'granted', verified_by = uid, verified_at = now(), updated_at = now() where id = r.id;
  else
    update public.account_relationships set status = 'revoked', consent_status = 'withdrawn', updated_at = now() where id = r.id;
  end if;
  insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
  select r.source_user_id, sp.role, 'family_link_response', 'Link ' || case when coalesce(p_approve, false) then 'approved' else 'declined' end,
    'QuizBox ' || case when coalesce(p_approve, false) then 'approved' else 'declined' end || ' your request to link to a student as a sponsor.', 'account_relationships', r.id
    from public.profiles sp where sp.id = r.source_user_id;
  perform quizbox_core.audit('family.staff_decide', 'account_relationships', r.id, jsonb_build_object('approved', coalesce(p_approve, false)));
  return jsonb_build_object('approved', coalesce(p_approve, false));
end $fn$;

revoke all on function public.qb_family_link_request(text), public.qb_family_my_requests(), public.qb_family_link_respond(uuid, boolean),
  public.qb_family_guardian_requests(), public.qb_family_guardian_respond(uuid, boolean), public.qb_family_staff_verifications(), public.qb_family_staff_decide(uuid, boolean)
  from public, anon;
grant execute on function public.qb_family_link_request(text), public.qb_family_my_requests(), public.qb_family_link_respond(uuid, boolean),
  public.qb_family_guardian_requests(), public.qb_family_guardian_respond(uuid, boolean), public.qb_family_staff_verifications(), public.qb_family_staff_decide(uuid, boolean)
  to authenticated;
