-- Family workspace: a sponsor links to an existing student as a sponsor, not as a parent. A sponsor's link gets the sponsor
-- permissions only (see progress, buy Coins and subscriptions) and never assigns work or challenges. Every other adult keeps
-- the parent link exactly as before. The student still has to accept, and a managed (school or parent managed) child still cannot be linked.
-- Replaces public.qb_family_link_request(text). Rollback: supabase/rollback/family_sponsor_links.sql
create or replace function public.qb_family_link_request(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); par text; rtype text; w public.family_workspaces; s public.profiles; perms jsonb; rid uuid; addr text := lower(btrim(coalesce(p_email, '')));
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
    rtype := case when par = 'sponsor' then 'sponsor' else 'parent' end; perms := quizbox_core.family_default_permissions(rtype);
    insert into public.account_relationships(source_user_id, target_user_id, relationship_type, status, can_fund, can_view_progress, can_manage_account, consent_status, family_workspace_id, permissions, created_by, label)
    values (uid, s.id, rtype, 'requested', coalesce((perms ->> 'buy_coins')::boolean, false), true, false, 'pending', w.id, perms - 'manage_access', uid, addr) returning id into rid;
    insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
    values (s.id, 'student', 'family_link_request', 'Link request', (select coalesce(nullif(full_name, ''), 'Someone') from public.profiles where id = uid) || ' asked to link to your account as ' || case when rtype = 'sponsor' then 'your sponsor' else 'your parent' end || '. Open your workspace to accept or decline.', 'account_relationships', rid);
    perform quizbox_core.audit('family.link_request', 'account_relationships', rid, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true);
end $fn$;
