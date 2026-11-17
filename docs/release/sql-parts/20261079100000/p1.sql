-- Family workspace, phase 1: a parent (or guardian, mentor, academic parent) owns a workspace and is linked to children who stay ordinary students.
-- Reuses public.account_relationships (guardian / sponsor / institutional today) instead of a second table: it gains the types parent, mentor and academic_parent,
-- a family_workspace_id and a permissions object. Existing relationships are untouched and are not family relationships (family_workspace_id is null).
--   public.qb_family_open(name)                workspace for the signed-in adult (not a student); safe to call again
--   public.qb_family_children()                the caller's linked children and the state of each link
--   public.qb_family_can(student, permission)  may the caller do this for this child? (checks the relationship, never just a role)
--   public.qb_family_child_summary(student)    one child's name and class, only with view_progress (the pattern every later family read follows)
--   public.qb_family_revoke(student)           the parent ends the link; access ends at once, the student account is untouched
--   public.qb_family_attach_child(parent, student, type)   service role only: used by the server route that creates or links a child (phase 2)
-- Permissions: view_progress, assign, create_challenge, buy_questions, buy_coins, buy_subscription, manage_access. can_fund mirrors buy_coins so the existing checkout works.
-- Off behind flags.family_workspace (nothing existing changes). Errors: QB_AUTH_REQUIRED, QB_FEATURE_DISABLED, QB_FAMILY_FORBIDDEN, QB_FAMILY_NOT_ADULT, QB_FAMILY_INVALID.
-- Additive and idempotent. Rollback: supabase/rollback/family_workspace.sql


create table if not exists public.family_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null default 'My family' check (char_length(btrim(name)) between 2 and 80),
  created_at timestamptz not null default now()
);
create unique index if not exists family_workspaces_owner on public.family_workspaces(owner_user_id);
alter table public.family_workspaces enable row level security;
revoke all on public.family_workspaces from public, anon, authenticated;

alter table public.account_relationships add column if not exists family_workspace_id uuid references public.family_workspaces(id) on delete cascade;
alter table public.account_relationships add column if not exists permissions jsonb not null default '{}'::jsonb;
create index if not exists account_relationships_family on public.account_relationships(family_workspace_id) where family_workspace_id is not null;

do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid = 'public.account_relationships'::regclass and contype = 'c'
      and (pg_get_constraintdef(oid) like '%relationship_type%' or pg_get_constraintdef(oid) like '%verified_by%') loop
    execute format('alter table public.account_relationships drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.account_relationships add constraint account_relationships_type_ok check (relationship_type in ('guardian', 'sponsor', 'institutional', 'parent', 'mentor', 'academic_parent'));
alter table public.account_relationships add constraint account_relationships_active_verified check (status <> 'active' or verified_by is not null or family_workspace_id is not null);

insert into public.platform_settings(key, scope_type, value, description)
select 'flags.family_workspace', 'global', 'false'::jsonb, 'Parents and guardians run a Family workspace: link children, assign work, and buy coins and subscriptions for them'
 where not exists (select 1 from public.platform_settings p where p.key = 'flags.family_workspace' and p.scope_type = 'global');

create or replace function quizbox_core.family_default_permissions(p_type text) returns jsonb
language sql immutable set search_path = '' as $fn$
  select case p_type
    when 'academic_parent' then '{"view_progress":true,"assign":true,"create_challenge":true,"buy_questions":true,"buy_coins":true,"buy_subscription":true}'::jsonb
    when 'mentor' then '{"view_progress":true}'::jsonb
    when 'sponsor' then '{"view_progress":true,"buy_coins":true,"buy_subscription":true}'::jsonb
    else '{"view_progress":true,"assign":true,"create_challenge":true,"buy_questions":true,"buy_coins":true,"buy_subscription":true,"manage_access":true}'::jsonb
  end
$fn$;

create or replace function quizbox_core.family_can(p_parent uuid, p_student uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select p_parent is not null and p_perm in ('view_progress', 'assign', 'create_challenge', 'buy_questions', 'buy_coins', 'buy_subscription', 'manage_access') and exists (
    select 1 from public.account_relationships r
     where r.source_user_id = p_parent and r.target_user_id = p_student and r.family_workspace_id is not null and r.status = 'active'
       and r.valid_from <= now() and (r.valid_until is null or r.valid_until > now()) and r.consent_status in ('granted', 'not_required')
       and coalesce((r.permissions ->> p_perm)::boolean, false))
$fn$;

create or replace function public.qb_family_can(p_student uuid, p_perm text) returns boolean
language sql stable security definer set search_path = '' as $fn$ select quizbox_core.family_can(auth.uid(), p_student, p_perm) $fn$;

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
