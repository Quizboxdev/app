create or replace function public.qb_family_invite_revoke(p_student uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not quizbox_core.family_can(uid, p_student, 'manage_access') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  update public.family_invitations set status = 'revoked' where student_user_id = p_student and status = 'pending';
  get diagnostics n = row_count;
  perform quizbox_core.audit('family.invite_revoke', 'profiles', p_student, jsonb_build_object('revoked', n));
  return jsonb_build_object('revoked', n);
end $fn$;

create or replace function public.qb_family_invite_peek(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare i public.family_invitations;
begin
  select * into i from public.family_invitations where token_hash = quizbox_core.family_token_hash(p_token) and status = 'pending' and expires_at > now();
  if i.id is null then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object('valid', true, 'first_name', split_part((select full_name from public.profiles where id = i.student_user_id), ' ', 1));
end $fn$;

create or replace function public.qb_family_invite_consume(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare i public.family_invitations; email text;
begin
  update public.family_invitations set status = 'used', used_at = now()
   where token_hash = quizbox_core.family_token_hash(p_token) and status = 'pending' and expires_at > now() returning * into i;
  if i.id is null then raise exception 'QB_INVITE_INVALID' using errcode = '22023'; end if;
  select p.email into email from public.profiles p where p.id = i.student_user_id;
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details)
  values (i.student_user_id, 'family.invite_used', 'family_invitations', i.id, 'pass', '{}'::jsonb);
  return jsonb_build_object('student_id', i.student_user_id, 'username', split_part(email, '@', 1));
end $fn$;

create or replace function public.qb_family_link_request(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); par text; w public.family_workspaces; s public.profiles; perms jsonb; rid uuid; addr text := lower(btrim(coalesce(p_email, '')));
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select lower(role::text) into par from public.profiles where id = uid;
  if par is null or par = 'student' then raise exception 'QB_FAMILY_NOT_ADULT' using errcode = '42501'; end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(addr) > 200 then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
  if (select count(*) from public.account_relationships where source_user_id = uid and family_workspace_id is not null and status = 'requested' and created_at > now() - interval '1 day') >= 10 then raise exception 'QB_RATE_LIMITED' using errcode = '54000'; end if;
  select * into s from public.profiles where lower(email) = addr and lower(role::text) = 'student' and lower(status::text) = 'active' and id <> uid
     and not exists (select 1 from public.student_profiles sp where sp.user_id = profiles.id and sp.managed_by is not null) limit 1;
  if s.id is not null and not exists (select 1 from public.account_relationships r where r.source_user_id = uid and r.target_user_id = s.id and r.family_workspace_id is not null and r.status <> 'revoked') then
    select * into w from public.family_workspaces where owner_user_id = uid;
    if w.id is null then insert into public.family_workspaces(owner_user_id) values (uid) returning * into w; end if;
    perms := quizbox_core.family_default_permissions('parent');
    insert into public.account_relationships(source_user_id, target_user_id, relationship_type, status, can_fund, can_view_progress, can_manage_account, consent_status, family_workspace_id, permissions, created_by, label)
    values (uid, s.id, 'parent', 'requested', coalesce((perms ->> 'buy_coins')::boolean, false), true, false, 'pending', w.id, perms - 'manage_access', uid, addr) returning id into rid;
    insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
    values (s.id, 'student', 'family_link_request', 'Link request', (select coalesce(nullif(full_name, ''), 'Someone') from public.profiles where id = uid) || ' asked to link to your account as your parent. Open your workspace to accept or decline.', 'account_relationships', rid);
    perform quizbox_core.audit('family.link_request', 'account_relationships', rid, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.qb_family_my_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'parent_name', coalesce(nullif(p.full_name, ''), 'A parent'), 'relationship_type', r.relationship_type, 'created_at', r.created_at) order by r.created_at desc)
    from public.account_relationships r join public.profiles p on p.id = r.source_user_id
    where r.target_user_id = auth.uid() and r.family_workspace_id is not null and r.status = 'requested'), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_link_respond(p_relationship uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); r public.account_relationships;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  select * into r from public.account_relationships where id = p_relationship and target_user_id = uid and family_workspace_id is not null and status = 'requested' for update;
  if r.id is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(p_accept, false) then
    update public.account_relationships set status = 'active', consent_status = 'granted', verified_at = now(), updated_at = now() where id = r.id;
  else
    update public.account_relationships set status = 'revoked', consent_status = 'withdrawn', updated_at = now() where id = r.id;
  end if;
  perform quizbox_core.audit('family.link_respond', 'account_relationships', r.id, jsonb_build_object('accepted', coalesce(p_accept, false)));
  return jsonb_build_object('accepted', coalesce(p_accept, false));
end $fn$;

-- The parent's list never shows a waiting student's name or class: only the email the parent typed.
create or replace function public.qb_family_children() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('student_id', case when r.status = 'active' then r.target_user_id end, 'relationship_id', r.id, 'relationship_type', r.relationship_type, 'status', r.status,
      'permissions', r.permissions, 'full_name', case when r.status = 'active' then p.full_name end, 'grade_code', case when r.status = 'active' then sp.grade_code end,
      'school_name', case when r.status = 'active' then sp.school_name end, 'label', r.label) order by r.status, p.full_name)
    from public.account_relationships r join public.family_workspaces w on w.id = r.family_workspace_id and w.owner_user_id = uid
    join public.profiles p on p.id = r.target_user_id left join public.student_profiles sp on sp.user_id = r.target_user_id
    where r.source_user_id = uid and r.status in ('active', 'pending_verification', 'requested')), '[]'::jsonb);
end $fn$;

revoke all on function quizbox_core.family_token_hash(text) from public, anon, authenticated;
