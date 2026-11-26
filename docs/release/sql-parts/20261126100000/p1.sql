-- QuizBox inter-school competitions, part 1 of 5: configuration, organiser permissions, educational divisions, rounds, question selection and freezing.
-- One competition engine, configured (open or invited, head-to-head or multi-school, individual or team, teacher or sponsor organised, school to national scale).
-- It reuses QuizBox accounts, institutions, memberships, the question bank, notifications, the audit log and the payment ledger. It is separate from the single-school
-- challenge engine (challenge_campaigns), which scores individuals, shows answers at once and counts against the free allowance (see docs/interschool/DESIGN.md).
-- Everything lives in the private schema quizbox_interschool (no browser can read a table); browsers call the public.interschool_* functions only.
-- Ships OFF behind flags.interschool (public pages: flags.interschool_public; sponsorship billing: flags.interschool_sponsorship).
-- Builds on 20261021100000 (qb_challenge_admin) and quizbox_core. Additive and idempotent. Rollback: supabase/rollback/interschool_core.sql


create schema if not exists quizbox_interschool;
revoke all on schema quizbox_interschool from public, anon, authenticated;

insert into public.platform_settings(key, value, description)
select v.key, v.value::jsonb, v.description from (values
  ('flags.interschool', 'false', 'Inter-school competitions: organisers, school registration, rounds and results'),
  ('flags.interschool_public', 'false', 'Public inter-school competition pages, campaign links and discovery'),
  ('flags.interschool_sponsorship', 'false', 'Sponsor quotations, invoices and online payment for inter-school competitions'),
  ('interschool.allow_managed_learners', 'false', 'Let schools enter teacher or parent managed learners (under 13) in inter-school competitions'),
  ('interschool.rate_per_participant_minor', 'null', 'Sponsorship price for one expected participant, in pesewas (set by an administrator before quoting)'),
  ('interschool.setup_fee_minor', '0', 'Default one-off setup fee on a sponsorship quotation, in pesewas')) v(key, value, description)
where not exists (select 1 from public.platform_settings p where p.key = v.key and p.scope_type = 'global');

-- The school verification record (also added by 20261068100000; repeated here so this migration stands on its own).
alter table public.institutions add column if not exists verified_at timestamptz;

create table if not exists quizbox_interschool.competitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 70),
  title text not null check (length(btrim(title)) between 3 and 140),
  description text not null default '' check (length(description) <= 4000),
  organiser_user_id uuid not null references public.profiles(id),
  organiser_kind text not null check (organiser_kind in ('ADMIN', 'SCHOOL', 'SPONSOR')),
  host_institution_id uuid references public.institutions(id) on delete set null,
  sponsor_name text check (sponsor_name is null or length(sponsor_name) <= 140),
  sponsor_logo_url text check (sponsor_logo_url is null or (sponsor_logo_url ~ '^(https://|/)[^\s<>"'']+$' and length(sponsor_logo_url) <= 500)),
  flyer_url text check (flyer_url is null or (flyer_url ~ '^(https://|/)[^\s<>"'']+$' and length(flyer_url) <= 500)),
  scale text not null default 'SCHOOLS' check (scale in ('SCHOOLS', 'DISTRICT', 'REGIONAL', 'NATIONAL')),
  region text check (region is null or length(region) <= 80),
  district text check (district is null or length(district) <= 80),
  participation text not null default 'INVITE' check (participation in ('OPEN', 'INVITE')),
  entry_mode text not null default 'SCHOOL_TEAM' check (entry_mode in ('INDIVIDUAL', 'SCHOOL_TEAM')),
  registration_mode text not null default 'BOTH' check (registration_mode in ('LEARNER', 'TEACHER', 'BOTH')),
  funding text not null default 'FREE' check (funding in ('FREE', 'SPONSORED', 'COMPLIMENTARY')),
  max_schools integer check (max_schools is null or max_schools between 1 and 5000),
  max_per_school integer check (max_per_school is null or max_per_school between 1 and 5000),
  max_per_level_per_school integer check (max_per_level_per_school is null or max_per_level_per_school between 1 and 5000),
  expected_participants integer not null default 100 check (expected_participants between 1 and 200000),
  capacity integer not null default 100 check (capacity between 1 and 200000),
  waitlist boolean not null default false,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  opens_at timestamptz,
  ends_at timestamptz,
  rules text not null default '' check (length(rules) <= 6000),
  prizes text not null default '' check (length(prizes) <= 2000),
  school_scoring text not null default 'TOP_N' check (school_scoring in ('AVERAGE', 'TOP_N', 'TEAM_TOTAL', 'FIXTURE_POINTS')),
  scoring_top_n integer not null default 5 check (scoring_top_n between 1 and 500),
  min_candidates integer not null default 1 check (min_candidates between 1 and 500),
  score_carry text not null default 'RESET' check (score_carry in ('RESET', 'ACCUMULATE')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'PAUSED', 'CLOSED', 'COMPLETED', 'CANCELLED')),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  decision_note text,
  funding_cleared_at timestamptz,
  funded_participants integer not null default 0 check (funded_participants >= 0),
  listed_at timestamptz,
  listed_by uuid references public.profiles(id),
  published_at timestamptz,
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (registration_closes_at is null or registration_opens_at is null or registration_closes_at > registration_opens_at),
  check (ends_at is null or opens_at is null or ends_at > opens_at)
);
create index if not exists is_competitions_status on quizbox_interschool.competitions(status, participation);
create index if not exists is_competitions_owner on quizbox_interschool.competitions(organiser_user_id);

create table if not exists quizbox_interschool.divisions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_interschool.competitions(id) on delete cascade,
  position integer not null check (position between 1 and 30),
  title text not null check (length(btrim(title)) between 1 and 80),
  level_codes text[] not null check (cardinality(level_codes) between 1 and 6),
  mixed boolean not null default false,
  capacity integer check (capacity is null or capacity between 1 and 200000),
  unique (competition_id, position),
  check (mixed or cardinality(level_codes) = 1)
);
create index if not exists is_divisions_competition on quizbox_interschool.divisions(competition_id);
