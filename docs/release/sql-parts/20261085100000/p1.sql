-- Family workspace, phase 4b: a parent sends a challenge they made (in Create and share) to the children they choose, using the existing challenge engine unchanged.
-- The parent builds the challenge as usual; an invitation is a reference to that challenge for a named child, so the child sees it on their home screen with its access code and opens it in the normal play page.
--   public.qb_family_challenges()                       the parent's own challenges, and which children are invited
--   public.qb_family_invite_challenge(campaign, kids)   invite ticked children (the parent must own the challenge and may create challenges for each child)
--   public.qb_family_uninvite_challenge(campaign, kid)  take an invitation back
--   public.qb_family_my_challenges()                    the child's invitations for live challenges that have not ended
-- A child under 13 keeps the existing rules for challenges. Off with the rest of the workspace (flags.family_workspace).
-- Errors: QB_AUTH_REQUIRED, QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN, QB_NOT_FOUND. Additive and idempotent. Rollback: supabase/rollback/family_challenges.sql
begin;

create table if not exists public.family_challenge_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.family_workspaces(id) on delete cascade,
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  student_user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (campaign_id, student_user_id)
);
create index if not exists family_challenge_invites_student on public.family_challenge_invites(student_user_id);
alter table public.family_challenge_invites enable row level security;
revoke all on public.family_challenge_invites from public, anon, authenticated;

create or replace function public.qb_family_challenges() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); w uuid;
begin
  if uid is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.family_workspace'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '42501'; end if;
  select id into w from public.family_workspaces where owner_user_id = uid;
  if w is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('campaign_id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status, 'visibility', c.visibility, 'starts_at', c.starts_at, 'ends_at', c.ends_at,
      'children', coalesce((select jsonb_agg(jsonb_build_object('student_id', i.student_user_id, 'name', p.full_name) order by p.full_name)
          from public.family_challenge_invites i join public.profiles p on p.id = i.student_user_id
          where i.campaign_id = c.id and i.workspace_id = w and quizbox_core.family_can(uid, i.student_user_id, 'view_progress')), '[]'::jsonb)) order by c.created_at desc)
    from (select * from public.challenge_campaigns where owner_id = uid and status <> 'ARCHIVED' order by created_at desc limit 50) c), '[]'::jsonb);
end $fn$;

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

create or replace function public.qb_family_my_challenges() returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTH_REQUIRED' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('campaign_id', c.id, 'slug', c.slug, 'title', c.title, 'ends_at', c.ends_at, 'starts_at', c.starts_at,
      'access_code', case when c.visibility = 'PRIVATE' then c.access_code end, 'from', coalesce(nullif(o.full_name, ''), 'Your family')) order by i.created_at desc)
    from public.family_challenge_invites i join public.challenge_campaigns c on c.id = i.campaign_id join public.profiles o on o.id = i.invited_by
    where i.student_user_id = auth.uid() and c.status = 'LIVE' and (c.ends_at is null or c.ends_at > now())), '[]'::jsonb);
end $fn$;

revoke all on function public.qb_family_challenges(), public.qb_family_invite_challenge(uuid, uuid[]), public.qb_family_uninvite_challenge(uuid, uuid), public.qb_family_my_challenges() from public, anon, authenticated;
grant execute on function public.qb_family_challenges(), public.qb_family_invite_challenge(uuid, uuid[]), public.qb_family_uninvite_challenge(uuid, uuid), public.qb_family_my_challenges() to authenticated;

commit;
notify pgrst, 'reload schema';
