-- QuizBox Challenges, foundation (Extension Blueprint phase 1; ADR-001: one identity, one question store, server-side scoring, tenant-ready).
-- A campaign is a timed quiz run by an authorised creator: its own question set (typed in or snapshotted from the bank), public or code-protected,
-- scored on the server, with a leaderboard. Everything goes through SECURITY DEFINER functions: the tables have RLS on and no direct grants,
-- so the answer key is never readable by a browser.
--   qb_challenge_creator() / qb_challenge_admin()   who may create / manage any campaign
--   challenge_public_list / challenge_public_get    public discovery of live campaigns (service role on the server; not callable by anon)
--   challenge_create / update / set_questions / pull_bank / publish / set_status   creator lifecycle (server-validated transitions)
--   challenge_start / challenge_submit              participant: start a timed attempt, submit once, scored on the server
--   challenge_leaderboard / challenge_my_*          rankings and own history
-- Managed learners under 13 can neither create nor join (UNDER_13_DESIGN.md). Additive and idempotent; rollback in supabase/rollback/challenges_foundation.sql.

-- 1. New capabilities (data only: the existing check constraint is widened).
alter table public.user_capabilities drop constraint if exists user_capabilities_capability_check;
alter table public.user_capabilities add constraint user_capabilities_capability_check check (capability in (
  'super_admin','content_admin','sme_reviewer','senior_sme_reviewer','competition_admin','sponsor_admin','finance_admin','platform_admin','content_manager',
  'competition_manager','support_agent','school_admin','school_owner','sponsor_user','parent_guardian','senior_reviewer','sme_support','campaign_creator','campaign_admin'));

-- 2. Tables.
create table if not exists public.challenge_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  tenant_id uuid,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  title text not null check (length(btrim(title)) between 3 and 120),
  summary text not null default '' check (length(summary) <= 500),
  category text not null default 'general_knowledge' check (category in ('school','book','general_knowledge','curriculum','sponsor','community')),
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC','UNLISTED','PRIVATE')),
  status text not null default 'DRAFT' check (status in ('DRAFT','LIVE','PAUSED','COMPLETED','ARCHIVED')),
  access_code text check (access_code is null or length(access_code) between 4 and 24),
  starts_at timestamptz, ends_at timestamptz,
  question_count integer not null default 10 check (question_count between 3 and 100),
  time_limit_seconds integer not null default 600 check (time_limit_seconds between 60 and 7200),
  max_attempts integer not null default 1 check (max_attempts between 1 and 10),
  reward_text text check (reward_text is null or length(reward_text) <= 300),
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (visibility <> 'PRIVATE' or access_code is not null)
);
create index if not exists challenge_campaigns_owner on public.challenge_campaigns(owner_id);
create index if not exists challenge_campaigns_live on public.challenge_campaigns(status, visibility);

create table if not exists public.challenge_questions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  position integer not null check (position >= 1),
  question_text text not null check (length(btrim(question_text)) between 5 and 600),
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text check (explanation is null or length(explanation) <= 800),
  source_question_id uuid,
  created_at timestamptz not null default now(),
  unique (campaign_id, position)
);

create table if not exists public.challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  attempt_no integer not null,
  question_ids uuid[] not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  submitted_at timestamptz,
  score integer, max_score integer, duration_ms integer, expired boolean not null default false,
  unique (campaign_id, user_id, attempt_no)
);
create index if not exists challenge_attempts_board on public.challenge_attempts(campaign_id, score desc, duration_ms) where submitted_at is not null and not expired;

create table if not exists public.challenge_responses (
  attempt_id uuid not null references public.challenge_attempts(id) on delete cascade,
  question_id uuid not null references public.challenge_questions(id) on delete cascade,
  chosen_index smallint, is_correct boolean not null,
  primary key (attempt_id, question_id)
);

create table if not exists public.challenge_events (
  id bigint generated always as identity primary key,
  campaign_id uuid references public.challenge_campaigns(id) on delete cascade,
  user_id uuid,
  event text not null check (event in ('campaign_published','campaign_paused','campaign_completed','campaign_viewed','attempt_started','attempt_submitted','campaign_shared')),
  created_at timestamptz not null default now()
);
create index if not exists challenge_events_campaign on public.challenge_events(campaign_id, event);

alter table public.challenge_campaigns enable row level security;
alter table public.challenge_questions enable row level security;
alter table public.challenge_attempts enable row level security;
alter table public.challenge_responses enable row level security;
alter table public.challenge_events enable row level security;
revoke all on public.challenge_campaigns, public.challenge_questions, public.challenge_attempts, public.challenge_responses, public.challenge_events from anon, authenticated, public;

-- 3. Who may do what.
create or replace function public.qb_challenge_active_user() returns boolean language sql stable security definer set search_path = '' as $fn$
  select auth.uid() is not null
    and exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active')
    and not exists (select 1 from public.student_profiles sp where sp.user_id = auth.uid() and sp.managed_by is not null);
$fn$;
create or replace function public.qb_challenge_admin() returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.qb_challenge_active_user() and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) in ('owner','admin'))
    or exists (select 1 from public.user_capabilities c where c.user_id = auth.uid() and c.active and c.capability in ('super_admin','campaign_admin')));
$fn$;
create or replace function public.qb_challenge_creator() returns boolean language sql stable security definer set search_path = '' as $fn$
  select public.qb_challenge_active_user() and (
    public.qb_challenge_admin()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.role::text) in ('teacher','sponsor'))
    or exists (select 1 from public.user_capabilities c where c.user_id = auth.uid() and c.active and c.capability = 'campaign_creator'));
$fn$;
create or replace function public.qb_challenge_live(c public.challenge_campaigns) returns boolean language sql stable set search_path = '' as $fn$
  select c.status = 'LIVE' and (c.starts_at is null or c.starts_at <= now()) and (c.ends_at is null or c.ends_at > now());
$fn$;
create or replace function public.qb_challenge_audit(p_action text, p_id uuid, p_details jsonb default '{}') returns void language sql security definer set search_path = '' as $fn$
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), p_action, 'challenge_campaign', p_id, 'ok', p_details);
$fn$;
