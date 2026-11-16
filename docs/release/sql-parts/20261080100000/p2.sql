create or replace function public.qb_family_invite_issue(p_student uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid; tok text; exp timestamptz := now() + interval '7 days'; inv uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not quizbox_core.family_can(uid, p_student, 'manage_access') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  update public.family_invitations set status = 'revoked' where student_user_id = p_student and status = 'pending';
  tok := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.family_invitations(workspace_id, student_user_id, token_hash, expires_at, created_by)
  values (w, p_student, quizbox_core.family_token_hash(tok), exp, uid) returning id into inv;
  perform quizbox_core.audit('family.invite_issue', 'family_invitations', inv, jsonb_build_object('student', p_student));
  return jsonb_build_object('token', tok, 'expires_at', exp);
end $fn$;

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
