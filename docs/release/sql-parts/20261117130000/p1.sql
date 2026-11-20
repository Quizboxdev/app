-- Family workspace: a sponsor may link to ANY student, including a school-managed or under-13 child, with approval first.
-- Under-13 / managed child, a parent or guardian is linked to that child:  the guardian approves (status requested, shown in
--   qb_family_guardian_requests); the child never sees or answers it.
-- Under-13 / managed child, no guardian linked:  QuizBox staff approve (status pending_verification, shown in qb_family_staff_verifications).
-- Every other student: unchanged. The student accepts (status requested).
-- Only a sponsor can start a link to a managed child. Any other adult gets the same silent answer as for a missing account.
-- Sponsor links carry sponsor permissions only (progress, Coins and subscriptions; no assigning or challenges).
-- Replaces: qb_family_link_request, qb_family_my_requests, qb_family_link_respond (managed children never see or answer requests).
-- Adds: qb_family_guardian_requests, qb_family_guardian_respond, qb_family_staff_verifications, qb_family_staff_decide.
-- Rollback: supabase/rollback/family_guardian_and_staff_approval.sql

create or replace function public.qb_family_link_request(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); par text; rtype text; w public.family_workspaces; s public.profiles; perms jsonb; rid uuid; addr text := lower(btrim(coalesce(p_email, '')));
  managed boolean := false; has_guardian boolean := false; new_status text;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select lower(role::text) into par from public.profiles where id = uid;
  if par is null or par = 'student' then raise exception 'QB_FAMILY_NOT_ADULT' using errcode = '42501'; end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(addr) > 200 then raise exception 'QB_FAMILY_INVALID' using errcode = '22023'; end if;
  if (select count(*) from public.account_relationships where source_user_id = uid and family_workspace_id is not null and status in ('requested', 'pending_verification') and created_at > now() - interval '1 day') >= 10 then raise exception 'QB_RATE_LIMITED' using errcode = '54000'; end if;
  select * into s from public.profiles where lower(email) = addr and lower(role::text) = 'student' and lower(status::text) = 'active' and id <> uid limit 1;
  if s.id is not null then
    managed := exists (select 1 from public.student_profiles sp where sp.user_id = s.id and sp.managed_by is not null);
  end if;
  -- A managed child can be linked only by a sponsor. For anyone else the answer is the same as for a missing account.
  if s.id is not null and (not managed or par = 'sponsor') and not exists (select 1 from public.account_relationships r where r.source_user_id = uid and r.target_user_id = s.id and r.family_workspace_id is not null and r.status <> 'revoked') then
    select * into w from public.family_workspaces where owner_user_id = uid;
    if w.id is null then insert into public.family_workspaces(owner_user_id) values (uid) returning * into w; end if;
    rtype := case when par = 'sponsor' then 'sponsor' else 'parent' end;
    perms := quizbox_core.family_default_permissions(rtype);
    has_guardian := exists (select 1 from public.account_relationships g where g.target_user_id = s.id and g.family_workspace_id is not null and g.status = 'active' and g.relationship_type in ('parent', 'guardian', 'academic_parent'));
    new_status := case when not managed then 'requested' when has_guardian then 'requested' else 'pending_verification' end;
    insert into public.account_relationships(source_user_id, target_user_id, relationship_type, status, can_fund, can_view_progress, can_manage_account, consent_status, family_workspace_id, permissions, created_by, label)
    values (uid, s.id, rtype, new_status, coalesce((perms ->> 'buy_coins')::boolean, false), true, false, 'pending', w.id, perms - 'manage_access', uid, addr) returning id into rid;
    if not managed then
      insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
      values (s.id, 'student', 'family_link_request', 'Link request', (select coalesce(nullif(full_name, ''), 'Someone') from public.profiles where id = uid) || ' asked to link to your account as ' || case when rtype = 'sponsor' then 'your sponsor' else 'your parent' end || '. Open your workspace to accept or decline.', 'account_relationships', rid);
    elsif has_guardian then
      insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
      select g.source_user_id, gp.role, 'family_link_request', 'Sponsor link request', (select coalesce(nullif(full_name, ''), 'A sponsor') from public.profiles where id = uid) || ' asked to link to ' || coalesce(nullif(sp.full_name, ''), 'your child') || ' as a sponsor. Open your Family workspace to accept or decline.', 'account_relationships', rid
        from public.account_relationships g join public.profiles gp on gp.id = g.source_user_id join public.profiles sp on sp.id = s.id
       where g.target_user_id = s.id and g.family_workspace_id is not null and g.status = 'active' and g.relationship_type in ('parent', 'guardian', 'academic_parent');
    end if;
    perform quizbox_core.audit('family.link_request', 'account_relationships', rid, jsonb_build_object('managed', managed, 'route', case when not managed then 'student' when has_guardian then 'guardian' else 'staff' end));
  end if;
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.qb_family_my_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  -- A managed child never sees a request: a guardian or staff member answers it.
  if exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.managed_by is not null) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'parent_name', coalesce(nullif(p.full_name, ''), 'A parent'), 'relationship_type', r.relationship_type, 'created_at', r.created_at) order by r.created_at desc)
    from public.account_relationships r join public.profiles p on p.id = r.source_user_id
    where r.target_user_id = auth.uid() and r.family_workspace_id is not null and r.status = 'requested'), '[]'::jsonb);
end $fn$;

create or replace function public.qb_family_link_respond(p_relationship uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); r public.account_relationships;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if exists (select 1 from public.student_profiles sp where sp.user_id = uid and sp.managed_by is not null) then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select * into r from public.account_relationships where id = p_relationship and target_user_id = uid and family_workspace_id is not null and status = 'requested' for update;
  if r.id is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(p_accept, false) then
    update public.account_relationships set status = 'active', consent_status = 'granted', verified_by = uid, verified_at = now(), updated_at = now() where id = r.id;
  else
    update public.account_relationships set status = 'revoked', consent_status = 'withdrawn', updated_at = now() where id = r.id;
  end if;
  perform quizbox_core.audit('family.link_respond', 'account_relationships', r.id, jsonb_build_object('accepted', coalesce(p_accept, false)));
  return jsonb_build_object('accepted', coalesce(p_accept, false));
end $fn$;
