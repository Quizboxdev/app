-- Parent accounts (Family workspace). A parent signs up with the parent role and is stored the way a
-- sponsor is: one profile role plus one profile-type row (parent_profiles, like sponsor_profiles).
-- Children stay linked through account_relationships with family_workspace_id, which is the table of
-- a parent's children. Closed while flags.family_workspace is off: onboarding refuses the parent role.
-- Replaces quizbox_core.held_roles and public.qb_complete_onboarding (copied from their latest definitions, parent branch added).
-- Rollback: supabase/rollback/parent_accounts.sql

alter type public.qb_role add value if not exists 'parent';

create table if not exists public.parent_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  full_name text,
  country text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.parent_profiles enable row level security;
drop policy if exists parent_profiles_read_own on public.parent_profiles;
create policy parent_profiles_read_own on public.parent_profiles for select to authenticated using (user_id = auth.uid());
revoke all on public.parent_profiles from anon, authenticated;
grant select on public.parent_profiles to authenticated;

create or replace function quizbox_core.held_roles(p_user uuid) returns text[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct x order by x),'{}') from (
  select case lower(role::text) when 'student' then 'student' when 'teacher' then 'teacher' when 'admin' then 'platform_admin'
    when 'owner' then 'super_admin' when 'sponsor' then 'sponsor_user' when 'parent' then 'parent_guardian' when 'support' then 'support_agent' end x
   from public.profiles where id=p_user and lower(status::text)='active'
  union select case capability when 'sme_reviewer' then 'sme_reviewer' when 'senior_sme_reviewer' then 'senior_reviewer' when 'content_admin' then 'content_manager'
    when 'competition_admin' then 'competition_manager' when 'sponsor_admin' then 'sponsor_admin' else capability end
   from public.user_capabilities c where user_id=p_user and active and exists(select 1 from public.profiles where id=p_user and lower(status::text)='active')
  union select case m.role::text when 'student' then 'student' when 'teacher' then 'teacher' when 'admin' then 'school_admin' when 'owner' then 'school_owner' end
   from public.institution_memberships m where m.user_id=p_user and m.status::text='active'
  union select 'parent_guardian' from public.account_relationships where source_user_id=p_user and relationship_type='guardian' and status='active'
  union select 'sponsor_user' from public.account_relationships where source_user_id=p_user and relationship_type='sponsor' and status='active'
 ) s where x is not null;
$$;
