create or replace function public.qb_family_invite_challenge(p_campaign uuid, p_students uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid; c public.challenge_campaigns; sid uuid; n integer := 0; parent_name text;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  if p_students is null or cardinality(p_students) not between 1 and 20 then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  select * into c from public.challenge_campaigns where id = p_campaign and owner_id = uid and status in ('DRAFT', 'LIVE', 'PAUSED');
  if c.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  foreach sid in array p_students loop
    if not quizbox_core.family_can(uid, sid, 'create_challenge') then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  end loop;
  select coalesce(nullif(full_name, ''), 'Your family') into parent_name from public.profiles where id = uid;
  foreach sid in array p_students loop
    if not exists (select 1 from public.family_challenge_invites where campaign_id = c.id and student_user_id = sid) then
      insert into public.family_challenge_invites(workspace_id, campaign_id, student_user_id, invited_by) values (w, c.id, sid, uid);
      insert into public.notifications(recipient_user_id, recipient_role, type, title, message, entity_type, entity_id)
      values (sid, 'student', 'family_challenge', 'A challenge from ' || parent_name, parent_name || ' invited you to "' || c.title || '". Find it on your home screen.', 'challenge_campaigns', c.id);
      n := n + 1;
    end if;
  end loop;
  perform quizbox_core.audit('family.challenge_invite', 'challenge_campaigns', c.id, jsonb_build_object('children', n));
  return jsonb_build_object('invited', n);
end $fn$;

create or replace function public.qb_family_uninvite_challenge(p_campaign uuid, p_student uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); n integer;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  delete from public.family_challenge_invites i using public.family_workspaces w where i.workspace_id = w.id and w.owner_user_id = uid and i.campaign_id = p_campaign and i.student_user_id = p_student;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'QB_FAMILY_FORBIDDEN' using errcode = '42501'; end if;
  perform quizbox_core.audit('family.challenge_uninvite', 'challenge_campaigns', p_campaign, jsonb_build_object('student', p_student));
  return jsonb_build_object('removed', n);
end $fn$;
