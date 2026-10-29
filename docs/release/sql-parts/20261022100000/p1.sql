-- QuizBox Challenges, extensions: multi-round stages, uploaded source content (versioned, with question evidence), prizes and fulfilment, organiser branding, analytics.
-- Builds on 20261021100000_challenges_foundation.sql. Same rules: tables have RLS on and no direct grants, everything goes through SECURITY DEFINER functions
-- with a fixed search_path, managed under-13 learners are excluded, additive and idempotent. Rollback: supabase/rollback/challenges_extensions.sql.
--   Stages:    challenge_set_stages / challenge_my_progress; start and submit are stage aware; a stage unlocks when the previous pass mark is met.
--   Content:   challenge_content_add / challenge_content_list / challenge_content_chunks; questions can cite a passage (chunk) and a verbatim quote.
--   Prizes:    challenge_set_prizes / challenge_finalize / challenge_awards_list / challenge_award_update / challenge_my_awards.
--   Branding:  challenge_set_brand (organiser name, tagline, accent colour, welcome text).
--   Insight:   challenge_analytics (creator) and challenge_admin_overview (admin).

-- 1. Columns and constraints.
alter table public.challenge_campaigns
  add column if not exists brand jsonb not null default '{}'::jsonb check (jsonb_typeof(brand) = 'object'),
  add column if not exists stage_count integer not null default 1 check (stage_count between 1 and 6),
  add column if not exists finalized_at timestamptz;
alter table public.challenge_questions
  add column if not exists stage_no integer not null default 1 check (stage_no between 1 and 6),
  add column if not exists source_chunk_id uuid,
  add column if not exists source_quote text check (source_quote is null or length(source_quote) <= 300);
alter table public.challenge_attempts add column if not exists stage_no integer not null default 1;
alter table public.challenge_attempts drop constraint if exists challenge_attempts_campaign_id_user_id_attempt_no_key;
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'challenge_attempts_stage_unique') then
    alter table public.challenge_attempts add constraint challenge_attempts_stage_unique unique (campaign_id, user_id, stage_no, attempt_no);
  end if;
end $do$;
alter table public.challenge_events drop constraint if exists challenge_events_event_check;
alter table public.challenge_events add constraint challenge_events_event_check check (event in
  ('campaign_published','campaign_paused','campaign_completed','campaign_viewed','attempt_started','attempt_submitted','campaign_shared','campaign_finalized','award_issued','content_added'));

create table if not exists public.challenge_stages (
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  stage_no integer not null check (stage_no between 1 and 6),
  title text not null check (length(btrim(title)) between 1 and 80),
  question_count integer not null check (question_count between 3 and 100),
  time_limit_seconds integer not null check (time_limit_seconds between 60 and 7200),
  pass_percent integer not null default 0 check (pass_percent between 0 and 100),
  starts_at timestamptz, ends_at timestamptz,
  primary key (campaign_id, stage_no),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table if not exists public.challenge_content_assets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  title text not null check (length(btrim(title)) between 2 and 160),
  kind text not null default 'book' check (kind in ('book','article','notes')),
  rights_attested boolean not null check (rights_attested),
  current_version integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.challenge_content_versions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.challenge_content_assets(id) on delete cascade,
  version integer not null,
  source_name text check (source_name is null or length(source_name) <= 200),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  char_count integer not null, chunk_count integer not null,
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  unique (asset_id, version)
);
create table if not exists public.challenge_source_chunks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.challenge_content_versions(id) on delete cascade,
  position integer not null,
  heading text check (heading is null or length(heading) <= 160),
  body text not null check (length(body) between 20 and 2500),
  unique (version_id, position)
);
do $do$ begin
  if not exists (select 1 from pg_constraint where conname = 'challenge_questions_chunk_fk') then
    alter table public.challenge_questions add constraint challenge_questions_chunk_fk foreign key (source_chunk_id) references public.challenge_source_chunks(id) on delete set null;
  end if;
end $do$;
create table if not exists public.challenge_prizes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  rank_from integer not null check (rank_from >= 1), rank_to integer not null,
  kind text not null default 'recognition' check (kind in ('cash','goods','voucher','certificate','recognition')),
  title text not null check (length(btrim(title)) between 2 and 120),
  details text check (details is null or length(details) <= 400),
  check (rank_to >= rank_from and rank_to <= 100)
);
create table if not exists public.challenge_awards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.challenge_campaigns(id) on delete cascade,
  prize_id uuid not null references public.challenge_prizes(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  rank integer not null,
  status text not null default 'PENDING' check (status in ('PENDING','CONTACTED','FULFILLED','FORFEITED')),
  fulfilment_note text check (fulfilment_note is null or length(fulfilment_note) <= 400),
  updated_at timestamptz not null default now(), fulfilled_at timestamptz,
  unique (campaign_id, user_id, prize_id)
);
alter table public.challenge_stages enable row level security;
alter table public.challenge_content_assets enable row level security;
alter table public.challenge_content_versions enable row level security;
alter table public.challenge_source_chunks enable row level security;
alter table public.challenge_prizes enable row level security;
alter table public.challenge_awards enable row level security;
revoke all on public.challenge_stages, public.challenge_content_assets, public.challenge_content_versions, public.challenge_source_chunks, public.challenge_prizes, public.challenge_awards from anon, authenticated, public;
create index if not exists challenge_awards_user on public.challenge_awards(user_id);
create index if not exists challenge_questions_stage on public.challenge_questions(campaign_id, stage_no);

-- 2. Shared helpers (internal).
create or replace function public.qb_challenge_stage(p_campaign uuid, p_stage integer) returns table(title text, question_count integer, time_limit_seconds integer, pass_percent integer, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = '' as $fn$
  select coalesce(s.title, 'Round ' || p_stage), coalesce(s.question_count, c.question_count), coalesce(s.time_limit_seconds, c.time_limit_seconds), coalesce(s.pass_percent, 0),
         coalesce(s.starts_at, case when p_stage = 1 then c.starts_at end), coalesce(s.ends_at, case when p_stage = c.stage_count then c.ends_at end)
    from public.challenge_campaigns c left join public.challenge_stages s on s.campaign_id = c.id and s.stage_no = p_stage where c.id = p_campaign;
$fn$;
