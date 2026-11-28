-- QuizBox inter-school competitions, part 3 of 5: fixtures, sittings, server scoring, school rankings, progression, disputes and audited corrections.
-- Competing schools answer the same frozen paper; question and answer order are shuffled per sitting; answers never leave the server until a round is finalised;
-- the timer is the server's; one sitting per learner per round; saved answers survive a lost connection; late answers are ignored.
-- Builds on 20261126100000 and 20261126110000. Additive and idempotent. Rollback: supabase/rollback/interschool_play.sql


create table if not exists quizbox_interschool.fixtures (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references quizbox_interschool.rounds(id) on delete cascade,
  group_no integer,
  match_no integer not null default 1,
  home_institution uuid not null references public.institutions(id),
  away_institution uuid references public.institutions(id),
  scheduled_at timestamptz not null,
  closes_at timestamptz not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds between 60 and 14400),
  sections jsonb,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'CANCELLED', 'COMPLETED')),
  home_score numeric, away_score numeric, home_points integer, away_points integer,
  winner_institution uuid references public.institutions(id),
  note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (away_institution is null or away_institution <> home_institution),
  check (closes_at > scheduled_at)
);
create index if not exists is_fixtures_round on quizbox_interschool.fixtures(round_id, status);
create index if not exists is_fixtures_home on quizbox_interschool.fixtures(home_institution, scheduled_at);
create index if not exists is_fixtures_away on quizbox_interschool.fixtures(away_institution, scheduled_at);

create table if not exists quizbox_interschool.sittings (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references quizbox_interschool.rounds(id),
  paper_id uuid not null references quizbox_interschool.papers(id),
  fixture_id uuid references quizbox_interschool.fixtures(id),
  candidate_id uuid not null references quizbox_interschool.candidates(id),
  user_id uuid not null references public.profiles(id),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  answers jsonb not null default '{}',
  saved_at timestamptz,
  submitted_at timestamptz,
  auto_submitted boolean not null default false,
  score integer, max_score integer, duration_ms integer,
  unique (round_id, candidate_id)
);
create index if not exists is_sittings_round on quizbox_interschool.sittings(round_id);

create table if not exists quizbox_interschool.round_results (
  round_id uuid not null references quizbox_interschool.rounds(id) on delete cascade,
  candidate_id uuid not null references quizbox_interschool.candidates(id),
  institution_id uuid,
  score numeric not null default 0,
  max_score integer not null default 0,
  percent numeric not null default 0,
  total_score numeric not null default 0,
  duration_ms bigint not null default 0,
  absent boolean not null default false,
  rank integer,
  qualified boolean not null default false,
  manual boolean not null default false,
  primary key (round_id, candidate_id)
);
create table if not exists quizbox_interschool.school_results (
  round_id uuid not null references quizbox_interschool.rounds(id) on delete cascade,
  institution_id uuid not null references public.institutions(id),
  entered integer not null default 0,
  present integer not null default 0,
  score numeric not null default 0,
  total_score numeric not null default 0,
  duration_ms bigint not null default 0,
  eligible boolean not null default true,
  rank integer,
  qualified boolean not null default false,
  primary key (round_id, institution_id)
);
create table if not exists quizbox_interschool.disputes (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_interschool.competitions(id) on delete cascade,
  round_id uuid not null references quizbox_interschool.rounds(id) on delete cascade,
  candidate_id uuid references quizbox_interschool.candidates(id),
  institution_id uuid references public.institutions(id),
  raised_by uuid not null references public.profiles(id),
  reason text not null check (length(btrim(reason)) between 10 and 1000),
  status text not null default 'OPEN' check (status in ('OPEN', 'UPHELD', 'REJECTED')),
  resolution text,
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists is_disputes_comp on quizbox_interschool.disputes(competition_id, status);
-- Score corrections are added, never edited: the latest one for a learner in a round applies.
create table if not exists quizbox_interschool.adjustments (
  id bigint generated always as identity primary key,
  round_id uuid not null references quizbox_interschool.rounds(id) on delete cascade,
  candidate_id uuid not null references quizbox_interschool.candidates(id),
  old_score numeric not null,
  new_score numeric not null,
  reason text not null check (length(btrim(reason)) between 5 and 500),
  dispute_id uuid references quizbox_interschool.disputes(id),
  made_by uuid not null references public.profiles(id),
  made_at timestamptz not null default now()
);

alter table quizbox_interschool.fixtures enable row level security;
alter table quizbox_interschool.sittings enable row level security;
alter table quizbox_interschool.round_results enable row level security;
alter table quizbox_interschool.school_results enable row level security;
alter table quizbox_interschool.disputes enable row level security;
alter table quizbox_interschool.adjustments enable row level security;
revoke all on all tables in schema quizbox_interschool from public, anon, authenticated;

create or replace function quizbox_interschool.round_ctx(p_round uuid, out r quizbox_interschool.rounds, out d quizbox_interschool.divisions, out competition_id uuid)
language plpgsql stable security definer set search_path = '' as $fn$
begin
  select * into r from quizbox_interschool.rounds x where x.id = p_round;
  select * into d from quizbox_interschool.divisions x where x.id = r.division_id;
  competition_id := d.competition_id;
end $fn$;

-- Schools able to play in a division: registered, with at least the minimum number of confirmed learners.
create or replace function quizbox_interschool.playing_schools(p_division uuid) returns setof uuid language sql stable security definer set search_path = '' as $fn$
  select k.institution_id from quizbox_interschool.candidates k
    join quizbox_interschool.divisions d on d.id = k.division_id
    join quizbox_interschool.competitions c on c.id = d.competition_id
    join quizbox_interschool.school_entries e on e.competition_id = c.id and e.institution_id = k.institution_id and e.status = 'REGISTERED'
   where k.division_id = p_division and k.status = 'CONFIRMED'
   group by k.institution_id, c.min_candidates having count(*) >= c.min_candidates
$fn$;

-- A school's team for one class level cannot be in two fixtures at once (in this or any other competition).
create or replace function quizbox_interschool.fixture_clash(p_round uuid, p_fixture uuid, p_schools uuid[], p_from timestamptz, p_to timestamptz) returns uuid language sql stable security definer set search_path = '' as $fn$
  select f.id from quizbox_interschool.fixtures f
    join quizbox_interschool.rounds r on r.id = f.round_id join quizbox_interschool.divisions d on d.id = r.division_id join quizbox_interschool.competitions c on c.id = d.competition_id
   where f.status = 'SCHEDULED' and f.id is distinct from p_fixture and c.status <> 'CANCELLED'
     and (f.home_institution = any(p_schools) or f.away_institution = any(p_schools))
     and (f.round_id = p_round or (d.level_codes && (select d2.level_codes from quizbox_interschool.rounds r2 join quizbox_interschool.divisions d2 on d2.id = r2.division_id where r2.id = p_round)
                                   and f.scheduled_at < p_to and p_from < f.closes_at))
   limit 1
$fn$;
