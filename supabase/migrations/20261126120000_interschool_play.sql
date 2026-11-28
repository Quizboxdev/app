-- QuizBox inter-school competitions, part 3 of 5: fixtures, sittings, server scoring, school rankings, progression, disputes and audited corrections.
-- Competing schools answer the same frozen paper; question and answer order are shuffled per sitting; answers never leave the server until a round is finalised;
-- the timer is the server's; one sitting per learner per round; saved answers survive a lost connection; late answers are ignored.
-- Builds on 20261126100000 and 20261126110000. Additive and idempotent. Rollback: supabase/rollback/interschool_play.sql
begin;

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

create or replace function quizbox_interschool.make_fixture(p_round uuid, p_home uuid, p_away uuid, p_from timestamptz, p_to timestamptz, p_group integer, p_match integer, p_sections jsonb default null, p_duration integer default null)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare x record; f uuid; schools uuid[]; c quizbox_interschool.competitions;
begin
  x := quizbox_interschool.round_ctx(p_round);
  select * into c from quizbox_interschool.competitions where id = x.competition_id;
  if (x.r).format = 'FIELD' then raise exception 'IS_ROUND_HAS_NO_FIXTURES' using errcode = '55000'; end if;
  if (x.r).finalised_at is not null then raise exception 'IS_ROUND_FINALISED' using errcode = '55000'; end if;
  if p_from < (x.r).opens_at or p_to > (x.r).closes_at or p_to <= p_from then raise exception 'IS_FIXTURE_OUTSIDE_ROUND' using errcode = '22023'; end if;
  if p_home is null or p_home = p_away then raise exception 'IS_FIXTURE_SCHOOLS_INVALID' using errcode = '22023'; end if;
  schools := array_remove(array[p_home, p_away], null);
  if exists (select 1 from unnest(schools) s where not exists (select 1 from quizbox_interschool.school_entries e where e.competition_id = c.id and e.institution_id = s and e.status = 'REGISTERED')) then
    raise exception 'IS_SCHOOL_NOT_REGISTERED' using errcode = '55000'; end if;
  if quizbox_interschool.fixture_clash(p_round, null, schools, p_from, p_to) is not null then raise exception 'IS_FIXTURE_CLASH' using errcode = '55000'; end if;
  insert into quizbox_interschool.fixtures(round_id, group_no, match_no, home_institution, away_institution, scheduled_at, closes_at, duration_seconds, sections, status, winner_institution, note)
  values (p_round, p_group, p_match, p_home, p_away, p_from, p_to, p_duration, p_sections, 'SCHEDULED', null, case when p_away is null then 'bye' end) returning id into f;
  if p_sections is not null then
    perform quizbox_interschool.section_report((x.d).level_codes, p_sections);
    perform quizbox_interschool.freeze_paper(p_round, f, (x.d).level_codes, p_sections);
  end if;
  if p_away is null then
    perform quizbox_interschool.notify_school(p_home, 'Bye this round', c.title || ': your school has a bye in ' || (x.r).title || '.', '/interschool/school/' || c.id);
  else
    perform quizbox_interschool.notify_school(p_home, 'Fixture scheduled', c.title || ' (' || (x.d).title || '): ' || (x.r).title || ' fixture on ' || to_char(p_from at time zone 'UTC', 'DD Mon HH24:MI') || ' GMT.', '/interschool/school/' || c.id);
    perform quizbox_interschool.notify_school(p_away, 'Fixture scheduled', c.title || ' (' || (x.d).title || '): ' || (x.r).title || ' fixture on ' || to_char(p_from at time zone 'UTC', 'DD Mon HH24:MI') || ' GMT.', '/interschool/school/' || c.id);
  end if;
  return f;
end $fn$;

-- Pairs schools for a knockout round. With an uneven number the first schools in the seeded order receive byes, so the next round has a power of two.
create or replace function quizbox_interschool.knockout_pairs(p_round uuid, p_schools uuid[]) returns integer language plpgsql security definer set search_path = '' as $fn$
declare r quizbox_interschool.rounds; n integer := coalesce(cardinality(p_schools), 0); size integer := 1; byes integer; j integer; m integer := 0;
begin
  select * into r from quizbox_interschool.rounds where id = p_round;
  if n < 2 then return 0; end if;
  while size < n loop size := size * 2; end loop;
  byes := size - n;
  for j in 1..byes loop m := m + 1; perform quizbox_interschool.make_fixture(p_round, p_schools[j], null, r.opens_at, r.closes_at, null, m); end loop;
  -- the rest (always an even number): first against last
  for j in 1..(n - byes) / 2 loop m := m + 1; perform quizbox_interschool.make_fixture(p_round, p_schools[byes + j], p_schools[n + 1 - j], r.opens_at, r.closes_at, null, m); end loop;
  return m;
end $fn$;

create or replace function public.interschool_generate_fixtures(p_division uuid, p_method text, p_groups integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare d quizbox_interschool.divisions; c quizbox_interschool.competitions; method text := upper(coalesce(p_method, '')); schools uuid[]; round_ids uuid[]; n integer; made integer := 0;
  g integer; grp uuid[]; size integer; day integer; i integer; a uuid; b uuid; r quizbox_interschool.rounds; ring uuid[]; need integer;
begin
  select * into d from quizbox_interschool.divisions where id = p_division;
  c := quizbox_interschool.managed(d.competition_id, true);
  if c.status not in ('PUBLISHED', 'PAUSED', 'CLOSED') then raise exception 'IS_PUBLISH_FIRST' using errcode = '55000'; end if;
  if method not in ('ROUND_ROBIN', 'GROUP', 'KNOCKOUT') then raise exception 'IS_METHOD_INVALID' using errcode = '22023'; end if;
  select array_agg(x.id order by x.round_no) into round_ids from quizbox_interschool.rounds x where x.division_id = d.id and x.format = method and x.finalised_at is null;
  if round_ids is null then raise exception 'IS_NO_ROUND_FOR_METHOD' using errcode = '55000'; end if;
  -- a stable draw for this division (repeatable, not alphabetical)
  select array_agg(s order by md5(s::text || d.id::text)) into schools from quizbox_interschool.playing_schools(d.id) s;
  n := coalesce(cardinality(schools), 0);
  if n < 2 then raise exception 'IS_NOT_ENOUGH_SCHOOLS' using errcode = '55000'; end if;
  if method = 'KNOCKOUT' then round_ids := round_ids[1:1]; end if;
  if exists (select 1 from quizbox_interschool.sittings s where s.round_id = any(round_ids)) then raise exception 'IS_ROUND_ALREADY_STARTED' using errcode = '55000'; end if;
  delete from quizbox_interschool.papers where fixture_id in (select id from quizbox_interschool.fixtures where round_id = any(round_ids));
  delete from quizbox_interschool.fixtures where round_id = any(round_ids);
  if method = 'KNOCKOUT' then
    -- after an earlier round, only the schools that qualified from it are drawn
    select * into r from quizbox_interschool.rounds where id = round_ids[1];
    if r.round_no > 1 then
      select array_agg(s.institution_id order by s.rank, s.institution_id) into schools from quizbox_interschool.school_results s join quizbox_interschool.rounds p on p.id = s.round_id
       where p.division_id = d.id and p.round_no = r.round_no - 1 and p.finalised_at is not null and s.qualified;
      if coalesce(cardinality(schools), 0) < 2 then raise exception 'IS_PREVIOUS_ROUND_NOT_FINALISED' using errcode = '55000'; end if;
    end if;
    made := quizbox_interschool.knockout_pairs(round_ids[1], schools);
  else
    size := case when method = 'GROUP' then greatest(coalesce(p_groups, 1), 1) else 1 end;
    if n / size < 2 then raise exception 'IS_TOO_MANY_GROUPS' using errcode = '22023'; end if;
    need := (ceil(n::numeric / size))::integer; need := case when need % 2 = 0 then need - 1 else need end;
    if cardinality(round_ids) < need then raise exception 'IS_NOT_ENOUGH_ROUNDS' using errcode = '55000', detail = need::text; end if;
    for g in 1..size loop
      select array_agg(schools[x] order by x) into grp from generate_series(g, n, size) x;
      ring := grp; if cardinality(ring) % 2 = 1 then ring := ring || array[null::uuid]; end if;
      for day in 1..cardinality(ring) - 1 loop
        select * into r from quizbox_interschool.rounds where id = round_ids[day];
        for i in 1..cardinality(ring) / 2 loop
          a := ring[i]; b := ring[cardinality(ring) - i + 1];
          if a is null then a := b; b := null; end if;
          made := made + 1;
          perform quizbox_interschool.make_fixture(r.id, a, b, r.opens_at, r.closes_at, case when method = 'GROUP' then g end, made);
        end loop;
        -- circle method: the first school stays, the rest rotate one place
        ring := array[ring[1]] || array[ring[cardinality(ring)]] || ring[2:cardinality(ring) - 1];
      end loop;
    end loop;
  end if;
  perform quizbox_interschool.audit('fixtures_generated', c.id, jsonb_build_object('division', d.id, 'method', method, 'fixtures', made));
  return jsonb_build_object('ok', true, 'fixtures', made);
end $fn$;

create or replace function public.interschool_add_fixture(p_round uuid, p_home uuid, p_away uuid, p_from timestamptz, p_to timestamptz, p_sections jsonb default null, p_duration integer default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare x record; c quizbox_interschool.competitions; f uuid; m integer;
begin
  x := quizbox_interschool.round_ctx(p_round);
  c := quizbox_interschool.managed(x.competition_id, true);
  if c.status not in ('PUBLISHED', 'PAUSED', 'CLOSED') then raise exception 'IS_PUBLISH_FIRST' using errcode = '55000'; end if;
  select coalesce(max(match_no), 0) + 1 into m from quizbox_interschool.fixtures where round_id = p_round;
  f := quizbox_interschool.make_fixture(p_round, p_home, p_away, p_from, p_to, null, m, p_sections, p_duration);
  perform quizbox_interschool.audit('fixture_added', c.id, jsonb_build_object('fixture', f));
  return jsonb_build_object('ok', true, 'fixture_id', f);
end $fn$;

create or replace function public.interschool_change_fixture(p_fixture uuid, p_from timestamptz default null, p_to timestamptz default null, p_cancel boolean default false, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare f quizbox_interschool.fixtures; x record; c quizbox_interschool.competitions; s uuid; msg text; v_from timestamptz; v_to timestamptz;
begin
  select * into f from quizbox_interschool.fixtures where id = p_fixture;
  x := quizbox_interschool.round_ctx(f.round_id);
  c := quizbox_interschool.managed(x.competition_id, true);
  if f.status <> 'SCHEDULED' or (x.r).finalised_at is not null then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if exists (select 1 from quizbox_interschool.sittings t where t.fixture_id = f.id) then raise exception 'IS_ROUND_ALREADY_STARTED' using errcode = '55000'; end if;
  if p_cancel then
    if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
    update quizbox_interschool.fixtures set status = 'CANCELLED', note = p_reason, updated_at = now() where id = f.id;
    msg := c.title || ': your ' || (x.r).title || ' fixture was cancelled. ' || p_reason;
  else
    v_from := coalesce(p_from, f.scheduled_at); v_to := coalesce(p_to, f.closes_at);
    if v_from < (x.r).opens_at or v_to > (x.r).closes_at or v_to <= v_from then raise exception 'IS_FIXTURE_OUTSIDE_ROUND' using errcode = '22023'; end if;
    if quizbox_interschool.fixture_clash(f.round_id, f.id, array_remove(array[f.home_institution, f.away_institution], null), v_from, v_to) is not null then raise exception 'IS_FIXTURE_CLASH' using errcode = '55000'; end if;
    update quizbox_interschool.fixtures set scheduled_at = v_from, closes_at = v_to, note = nullif(btrim(p_reason), ''), updated_at = now() where id = f.id;
    msg := c.title || ': your ' || (x.r).title || ' fixture moved to ' || to_char(v_from at time zone 'UTC', 'DD Mon HH24:MI') || ' GMT.';
  end if;
  foreach s in array array_remove(array[f.home_institution, f.away_institution], null) loop
    perform quizbox_interschool.notify_school(s, case when p_cancel then 'Fixture cancelled' else 'Fixture changed' end, msg, '/interschool/school/' || c.id);
  end loop;
  perform quizbox_interschool.audit(case when p_cancel then 'fixture_cancelled' else 'fixture_rescheduled' end, c.id, jsonb_build_object('fixture', f.id, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $fn$;

-- ───────────── taking a round ─────────────
-- Why this learner may or may not sit this round now. Returns the fixture and paper when they may.
create or replace function quizbox_interschool.sit_state(k quizbox_interschool.candidates, p_round uuid, out state text, out fixture uuid, out paper uuid, out opens timestamptz, out closes timestamptz, out seconds integer)
language plpgsql stable security definer set search_path = '' as $fn$
declare r quizbox_interschool.rounds; c quizbox_interschool.competitions; f quizbox_interschool.fixtures; prev quizbox_interschool.rounds;
begin
  select * into r from quizbox_interschool.rounds where id = p_round;
  select * into c from quizbox_interschool.competitions where id = k.competition_id;
  opens := r.opens_at; closes := r.closes_at; seconds := r.duration_seconds;
  if r.id is null or r.division_id <> k.division_id then state := 'NOT_YOUR_ROUND'; return; end if;
  if k.status <> 'CONFIRMED' then state := 'NOT_CONFIRMED'; return; end if;
  if c.status = 'CANCELLED' then state := 'CANCELLED'; return; end if;
  if r.round_no > 1 then
    select * into prev from quizbox_interschool.rounds where division_id = r.division_id and round_no = r.round_no - 1;
    if prev.finalised_at is null then state := 'WAITING'; return; end if;
    if not exists (select 1 from quizbox_interschool.round_results x where x.round_id = prev.id and x.candidate_id = k.id and x.qualified) then state := 'NOT_THROUGH'; return; end if;
  end if;
  if r.format <> 'FIELD' then
    select * into f from quizbox_interschool.fixtures x where x.round_id = r.id and x.status <> 'CANCELLED' and (x.home_institution = k.institution_id or x.away_institution = k.institution_id);
    if f.id is null then state := 'NO_FIXTURE'; return; end if;
    if f.away_institution is null then state := 'BYE'; return; end if;
    fixture := f.id; opens := f.scheduled_at; closes := f.closes_at; seconds := coalesce(f.duration_seconds, r.duration_seconds);
  end if;
  select p.id into paper from quizbox_interschool.papers p where p.round_id = r.id and p.fixture_id is not distinct from fixture;
  if paper is null then select p.id into paper from quizbox_interschool.papers p where p.round_id = r.id and p.fixture_id is null; end if;
  if c.status = 'PAUSED' then state := 'PAUSED';
  elsif c.status not in ('PUBLISHED', 'CLOSED') then state := 'CLOSED';
  elsif r.finalised_at is not null or closes <= now() then state := 'CLOSED';
  elsif opens > now() then state := 'NOT_OPEN';
  else state := 'OPEN';
  end if;
end $fn$;

-- The paper as one sitting sees it: questions and options in this sitting's own order, no answers.
create or replace function quizbox_interschool.sitting_view(s quizbox_interschool.sittings) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('sitting_id', s.id, 'expires_at', s.expires_at, 'server_time', now(), 'submitted', s.submitted_at is not null,
    'title', (select c.title || ' · ' || d.title || ' · ' || r.title from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id = r.division_id join quizbox_interschool.competitions c on c.id = d.competition_id where r.id = s.round_id),
    'questions', (select jsonb_agg(jsonb_build_object('id', q.id, 'question_text', q.question_text,
        'options', (select jsonb_agg(q.options -> o.i order by md5(s.id::text || q.id::text || o.i::text)) from generate_series(0, jsonb_array_length(q.options) - 1) o(i)),
        'chosen', (select p.pos from (select o.i, (row_number() over (order by md5(s.id::text || q.id::text || o.i::text)) - 1)::integer as pos from generate_series(0, jsonb_array_length(q.options) - 1) o(i)) p
                    where p.i = (s.answers ->> q.id::text)::integer)) order by md5(s.id::text || q.id::text))
      from quizbox_interschool.paper_questions q where q.paper_id = s.paper_id))
$fn$;

-- Stores answers given as positions in this sitting's order, translated back to the question's own order. Unknown questions or positions are ignored.
create or replace function quizbox_interschool.merge_answers(s quizbox_interschool.sittings, p_answers jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare item jsonb; q quizbox_interschool.paper_questions; pos integer; original integer; out jsonb := s.answers;
begin
  if p_answers is null then return out; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 400 then raise exception 'IS_ANSWERS_INVALID' using errcode = '22023'; end if;
  for item in select value from jsonb_array_elements(p_answers) loop
    if coalesce(item ->> 'question_id', '') !~ '^[0-9a-fA-F-]{36}$' then continue; end if;
    select * into q from quizbox_interschool.paper_questions where id = (item ->> 'question_id')::uuid and paper_id = s.paper_id;
    if q.id is null then continue; end if;
    if item ->> 'choice' is null then out := out - q.id::text; continue; end if;
    if item ->> 'choice' !~ '^[0-3]$' then continue; end if;
    pos := (item ->> 'choice')::integer;
    select x.i into original from (select o.i, (row_number() over (order by md5(s.id::text || q.id::text || o.i::text)) - 1)::integer as shown_at from generate_series(0, jsonb_array_length(q.options) - 1) o(i)) x where x.shown_at = pos;
    if original is null then continue; end if;
    out := out || jsonb_build_object(q.id::text, original);
  end loop;
  return out;
end $fn$;

create or replace function quizbox_interschool.close_sitting(p_sitting uuid, p_auto boolean) returns void language sql security definer set search_path = '' as $fn$
  update quizbox_interschool.sittings s set submitted_at = least(now(), s.expires_at), auto_submitted = p_auto,
     duration_ms = greatest(0, (extract(epoch from (least(now(), s.expires_at) - s.started_at)) * 1000)::integer),
     max_score = (select count(*) from quizbox_interschool.paper_questions q where q.paper_id = s.paper_id),
     score = (select count(*) from quizbox_interschool.paper_questions q where q.paper_id = s.paper_id and (s.answers ->> q.id::text)::integer = q.correct_index)
   where s.id = p_sitting and s.submitted_at is null
$fn$;

create or replace function public.interschool_start(p_round uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k quizbox_interschool.candidates; s quizbox_interschool.sittings; st record; x record;
begin
  perform quizbox_interschool.require_on();
  x := quizbox_interschool.round_ctx(p_round);
  -- the candidate row is locked, so a double tap or two devices cannot create two sittings
  select * into k from quizbox_interschool.candidates where competition_id = x.competition_id and user_id = auth.uid() and status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED') for update;
  if k.id is null then raise exception 'IS_NOT_REGISTERED' using errcode = '42501'; end if;
  select * into s from quizbox_interschool.sittings where round_id = p_round and candidate_id = k.id;
  select * into st from quizbox_interschool.sit_state(k, p_round);
  if s.id is not null then
    if s.submitted_at is not null or s.expires_at <= now() then raise exception 'IS_ALREADY_TAKEN' using errcode = '55000'; end if;
    if st.state <> 'OPEN' then raise exception '%', 'IS_ROUND_' || st.state using errcode = '55000'; end if;
    return quizbox_interschool.sitting_view(s) || jsonb_build_object('resumed', true);
  end if;
  if st.state <> 'OPEN' then raise exception '%', 'IS_ROUND_' || st.state using errcode = '55000'; end if;
  if st.paper is null then raise exception 'IS_NO_PAPER' using errcode = '55000'; end if;
  insert into quizbox_interschool.sittings(round_id, paper_id, fixture_id, candidate_id, user_id, expires_at)
  values (p_round, st.paper, st.fixture, k.id, auth.uid(), least(now() + make_interval(secs => st.seconds), st.closes)) returning * into s;
  return quizbox_interschool.sitting_view(s) || jsonb_build_object('resumed', false);
end $fn$;

create or replace function public.interschool_save(p_sitting uuid, p_answers jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s quizbox_interschool.sittings;
begin
  perform quizbox_interschool.require_on();
  select * into s from quizbox_interschool.sittings where id = p_sitting and user_id = auth.uid() for update;
  if s.id is null then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  if s.submitted_at is not null then return jsonb_build_object('saved', false, 'submitted', true); end if;
  if now() > s.expires_at + interval '20 seconds' then return jsonb_build_object('saved', false, 'expired', true); end if;
  update quizbox_interschool.sittings set answers = quizbox_interschool.merge_answers(s, p_answers), saved_at = now() where id = s.id;
  return jsonb_build_object('saved', true, 'server_time', now(), 'expires_at', s.expires_at);
end $fn$;

-- Submitting twice returns the same receipt. After the time is up (plus 20 seconds for the network) only answers saved in time count. No score is returned: results follow when the round is finalised.
create or replace function public.interschool_submit(p_sitting uuid, p_answers jsonb default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare s quizbox_interschool.sittings; late boolean;
begin
  perform quizbox_interschool.require_on();
  select * into s from quizbox_interschool.sittings where id = p_sitting and user_id = auth.uid() for update;
  if s.id is null then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  if s.submitted_at is not null then return jsonb_build_object('ok', true, 'already_submitted', true, 'submitted_at', s.submitted_at, 'answered', (select count(*) from jsonb_object_keys(s.answers))); end if;
  late := now() > s.expires_at + interval '20 seconds';
  if not late then update quizbox_interschool.sittings set answers = quizbox_interschool.merge_answers(s, p_answers), saved_at = now() where id = s.id returning * into s; end if;
  perform quizbox_interschool.close_sitting(s.id, late);
  return jsonb_build_object('ok', true, 'already_submitted', false, 'late_answers_ignored', late, 'answered', (select count(*) from jsonb_object_keys(s.answers)));
end $fn$;

-- ───────────── results, rankings and progression ─────────────
-- Fixture results of a round, and the standings by fixture points.
create or replace function quizbox_interschool.settle_fixtures(p_round uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare x record; r quizbox_interschool.rounds; d quizbox_interschool.divisions; c quizbox_interschool.competitions; f quizbox_interschool.fixtures;
  hs record; aws record; winner uuid; hp integer; ap integer; lot text;
begin
  x := quizbox_interschool.round_ctx(p_round); r := x.r; d := x.d;
  select * into c from quizbox_interschool.competitions where id = d.competition_id;
  -- fixtures: higher school score wins; equal scores go to the shorter time; a knockout tie that is still level is decided by a recorded draw of lots
  for f in select * from quizbox_interschool.fixtures where round_id = r.id and status <> 'CANCELLED' loop
    select * into hs from quizbox_interschool.school_results where round_id = r.id and institution_id = f.home_institution;
    select * into aws from quizbox_interschool.school_results where round_id = r.id and institution_id = f.away_institution;
    winner := null; lot := null;
    if f.away_institution is null then winner := f.home_institution;
    elsif coalesce(hs.eligible, false) and not coalesce(aws.eligible, false) then winner := f.home_institution;
    elsif coalesce(aws.eligible, false) and not coalesce(hs.eligible, false) then winner := f.away_institution;
    elsif coalesce(hs.eligible, false) then
      if hs.score <> aws.score then winner := case when hs.score > aws.score then f.home_institution else f.away_institution end;
      elsif hs.duration_ms <> aws.duration_ms then winner := case when hs.duration_ms < aws.duration_ms then f.home_institution else f.away_institution end;
      end if;
    end if;
    if winner is null and r.format = 'KNOCKOUT' then
      winner := case when md5(f.id::text || f.home_institution::text) < md5(f.id::text || f.away_institution::text) then f.home_institution else f.away_institution end;
      lot := 'level on score and time: decided by lot';
    end if;
    hp := case when f.away_institution is null then 3 when winner = f.home_institution then 3 when winner is null and coalesce(hs.eligible, false) then 1 else 0 end;
    ap := case when f.away_institution is null then null when winner = f.away_institution then 3 when winner is null and coalesce(aws.eligible, false) then 1 else 0 end;
    update quizbox_interschool.fixtures set status = 'COMPLETED', home_score = hs.score, away_score = aws.score, home_points = hp, away_points = ap, winner_institution = winner, note = coalesce(lot, note), updated_at = now() where id = f.id;
  end loop;
  -- league and group standings (and any fixture-points competition) add up fixture points across the match days; level points are split by the summed school scores, then time
  if r.format in ('ROUND_ROBIN', 'GROUP') or (c.school_scoring = 'FIXTURE_POINTS' and r.format <> 'FIELD') then
    update quizbox_interschool.school_results t set total_score = coalesce((select sum(case when fx.home_institution = t.institution_id then fx.home_points else fx.away_points end)
        from quizbox_interschool.fixtures fx join quizbox_interschool.rounds rx on rx.id = fx.round_id
       where rx.division_id = d.id and rx.round_no <= r.round_no and fx.status = 'COMPLETED' and (fx.home_institution = t.institution_id or fx.away_institution = t.institution_id)), 0)
     where t.round_id = r.id;
    update quizbox_interschool.school_results t set rank = z.rk from (
      select s.institution_id, rank() over (order by s.total_score desc, h.points_for desc, h.time_ms asc) as rk
        from quizbox_interschool.school_results s
        cross join lateral (select coalesce(sum(p.score), 0) as points_for, coalesce(sum(p.duration_ms), 0) as time_ms from quizbox_interschool.school_results p join quizbox_interschool.rounds rp on rp.id = p.round_id
                             where rp.division_id = d.id and rp.round_no <= r.round_no and rp.format = r.format and p.institution_id = s.institution_id) h
       where s.round_id = r.id) z
     where t.round_id = r.id and t.institution_id = z.institution_id;
  end if;
end $fn$;

-- Who goes through, by the round's rule. Authorised manual choices are kept (all earlier choices when p_keep).
create or replace function quizbox_interschool.apply_rules(p_round uuid, p_keep boolean) returns void language plpgsql security definer set search_path = '' as $fn$
declare r quizbox_interschool.rounds;
begin
  select * into r from quizbox_interschool.rounds where id = p_round;
  -- who goes through
  update quizbox_interschool.round_results t set qualified = case r.rule
      when 'ALL' then true
      when 'PASS' then not t.absent and t.percent >= r.pass_percent
      when 'TOP_LEARNERS' then not t.absent and t.rank <= r.top_n and t.percent >= coalesce(r.pass_percent, 0)
      when 'PASS_AND_TOP_LEARNERS' then not t.absent and t.percent >= r.pass_percent and t.rank <= r.top_n
      -- in a group stage the top schools of EACH group go through
      when 'TOP_SCHOOLS' then exists (
                              select 1 from (select z.institution_id, z.eligible, z.rank as overall, rank() over (partition by z.grp order by z.rank nulls last) as in_group
                                from (select s.institution_id, s.eligible, s.rank, (select max(fx.group_no) from quizbox_interschool.fixtures fx join quizbox_interschool.rounds rx on rx.id = fx.round_id
                                          where rx.division_id = r.division_id and (fx.home_institution = s.institution_id or fx.away_institution = s.institution_id)) as grp
                                        from quizbox_interschool.school_results s where s.round_id = r.id) z) g
                               where g.institution_id = t.institution_id and (g.eligible or r.format = 'GROUP') and (case when r.format = 'GROUP' then g.in_group else g.overall end) <= r.top_n)
                              and (r.pass_percent is null or (not t.absent and t.percent >= r.pass_percent))
      when 'FIXTURE_WINNERS' then exists (select 1 from quizbox_interschool.fixtures fx where fx.round_id = r.id and fx.status = 'COMPLETED' and fx.winner_institution = t.institution_id)
                              and (r.pass_percent is null or (not t.absent and t.percent >= r.pass_percent))
      else false end
   where t.round_id = r.id;
  if r.rule = 'MANUAL' then
    update quizbox_interschool.round_results t set qualified = k.qualified, manual = k.manual from is_keep k where t.round_id = r.id and t.candidate_id = k.candidate_id and k.manual;
  end if;
  if p_keep then
    update quizbox_interschool.round_results t set qualified = k.qualified, manual = k.manual from is_keep k where t.round_id = r.id and t.candidate_id = k.candidate_id;
  else
    update quizbox_interschool.round_results t set qualified = k.qualified, manual = true from is_keep k where t.round_id = r.id and t.candidate_id = k.candidate_id and k.manual;
  end if;
  update quizbox_interschool.school_results t set qualified = exists (select 1 from quizbox_interschool.round_results y where y.round_id = r.id and y.institution_id = t.institution_id and y.qualified)
    or (r.format <> 'FIELD' and r.rule = 'FIXTURE_WINNERS' and exists (select 1 from quizbox_interschool.fixtures fx where fx.round_id = r.id and fx.status = 'COMPLETED' and fx.winner_institution = t.institution_id))
   where t.round_id = r.id;
end $fn$;

-- Computes a closed round: each learner, each school, each fixture, then who goes through. p_keep keeps the qualification already announced (used when a later round has started).
create or replace function quizbox_interschool.compute_round(p_round uuid, p_keep boolean default false) returns void language plpgsql security definer set search_path = '' as $fn$
declare x record; r quizbox_interschool.rounds; d quizbox_interschool.divisions; c quizbox_interschool.competitions; prev uuid;
begin
  x := quizbox_interschool.round_ctx(p_round); r := x.r; d := x.d;
  select * into c from quizbox_interschool.competitions where id = d.competition_id;
  select id into prev from quizbox_interschool.rounds where division_id = d.id and round_no = r.round_no - 1;
  perform quizbox_interschool.close_sitting(s.id, true) from quizbox_interschool.sittings s where s.round_id = r.id and s.submitted_at is null;
  create temporary table if not exists is_keep(candidate_id uuid primary key, qualified boolean, manual boolean) on commit drop;
  truncate is_keep;
  insert into is_keep select candidate_id, qualified, manual from quizbox_interschool.round_results where round_id = r.id;
  delete from quizbox_interschool.round_results where round_id = r.id;
  delete from quizbox_interschool.school_results where round_id = r.id;
  -- who was meant to take this round
  insert into quizbox_interschool.round_results(round_id, candidate_id, institution_id, score, max_score, percent, total_score, duration_ms, absent)
  select r.id, k.id, k.institution_id, coalesce(adj.new_score, s.score, 0), m.max_score,
         case when m.max_score > 0 then round(100.0 * coalesce(adj.new_score, s.score, 0) / m.max_score, 2) else 0 end,
         coalesce(adj.new_score, s.score, 0) + case when c.score_carry = 'ACCUMULATE' then coalesce(pr.total_score, 0) else 0 end,
         coalesce(s.duration_ms, 0), s.id is null
    from quizbox_interschool.candidates k
    left join quizbox_interschool.sittings s on s.round_id = r.id and s.candidate_id = k.id
    left join quizbox_interschool.round_results pr on pr.round_id = prev and pr.candidate_id = k.id
    left join lateral (select a.new_score from quizbox_interschool.adjustments a where a.round_id = r.id and a.candidate_id = k.id order by a.id desc limit 1) adj on true
    cross join lateral (select coalesce(s.max_score, (select count(*) from quizbox_interschool.paper_questions q join quizbox_interschool.papers p on p.id = q.paper_id where p.round_id = r.id and p.fixture_id is null))::integer as max_score) m
   where k.division_id = d.id and k.status = 'CONFIRMED'
     and (r.round_no = 1 or pr.qualified or s.id is not null)
     -- in a knockout only the drawn schools take part; in a league or group stage a school resting on a match day stays in
     and (r.format <> 'KNOCKOUT' or exists (select 1 from quizbox_interschool.fixtures fx where fx.round_id = r.id and fx.status <> 'CANCELLED' and (fx.home_institution = k.institution_id or fx.away_institution = k.institution_id)));
  update quizbox_interschool.round_results t set rank = z.rk from (
    select candidate_id, rank() over (order by total_score desc, duration_ms asc) as rk from quizbox_interschool.round_results where round_id = r.id and not absent) z
   where t.round_id = r.id and t.candidate_id = z.candidate_id;
  -- schools: AVERAGE and TEAM_TOTAL count absent learners as zero; TOP_N and FIXTURE_POINTS use the best N learners present
  insert into quizbox_interschool.school_results(round_id, institution_id, entered, present, score, total_score, duration_ms, eligible)
  select r.id, y.institution_id, count(*), count(*) filter (where not y.absent),
         round(case c.school_scoring when 'AVERAGE' then avg(y.percent) when 'TEAM_TOTAL' then sum(y.score) else coalesce(sum(y.percent) filter (where not y.absent and y.pos <= c.scoring_top_n), 0) end, 2),
         0, coalesce(sum(y.duration_ms) filter (where not y.absent and (c.school_scoring in ('AVERAGE', 'TEAM_TOTAL') or y.pos <= c.scoring_top_n)), 0),
         count(*) filter (where not y.absent) >= c.min_candidates
    from (select rr.*, row_number() over (partition by rr.institution_id order by rr.absent, rr.percent desc, rr.duration_ms) as pos from quizbox_interschool.round_results rr where rr.round_id = r.id and rr.institution_id is not null) y
   group by y.institution_id;
  update quizbox_interschool.school_results t set total_score = t.score + case when c.score_carry = 'ACCUMULATE' then coalesce((select p.total_score from quizbox_interschool.school_results p where p.round_id = prev and p.institution_id = t.institution_id), 0) else 0 end
   where t.round_id = r.id;
  update quizbox_interschool.school_results t set rank = z.rk from (
    select institution_id, rank() over (order by total_score desc, duration_ms asc) as rk from quizbox_interschool.school_results where round_id = r.id and eligible) z
   where t.round_id = r.id and t.institution_id = z.institution_id;
  perform quizbox_interschool.settle_fixtures(r.id);
  perform quizbox_interschool.apply_rules(r.id, p_keep);
end $fn$;

create or replace function quizbox_interschool.after_finalise(p_round uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare x record; r quizbox_interschool.rounds; d quizbox_interschool.divisions; c quizbox_interschool.competitions; nxt quizbox_interschool.rounds; schools uuid[]; k record;
begin
  x := quizbox_interschool.round_ctx(p_round); r := x.r; d := x.d;
  select * into c from quizbox_interschool.competitions where id = d.competition_id;
  select * into nxt from quizbox_interschool.rounds where division_id = d.id and round_no = r.round_no + 1;
  for k in select cd.user_id, y.qualified from quizbox_interschool.round_results y join quizbox_interschool.candidates cd on cd.id = y.candidate_id where y.round_id = r.id loop
    perform quizbox_interschool.notify(k.user_id, case when nxt.id is null then 'Final results are out' when k.qualified then 'You qualified' else 'Round results are out' end,
      c.title || ' ' || r.title || case when nxt.id is null then ': see how you did.' when k.qualified then ': you are through to ' || nxt.title || '.' else ': you did not go through this time.' end, '/interschool');
  end loop;
  -- the next knockout draw is made automatically from the winners
  if nxt.id is not null and nxt.format = 'KNOCKOUT' and not exists (select 1 from quizbox_interschool.fixtures f where f.round_id = nxt.id) and nxt.closes_at > now() then
    select array_agg(s.institution_id order by s.rank nulls last, s.institution_id) into schools from quizbox_interschool.school_results s where s.round_id = r.id and s.qualified;
    perform quizbox_interschool.knockout_pairs(nxt.id, schools);
  end if;
  -- the competition is complete when every round of every division has been finalised
  if not exists (select 1 from quizbox_interschool.rounds y join quizbox_interschool.divisions v on v.id = y.division_id where v.competition_id = c.id and y.finalised_at is null) then
    update quizbox_interschool.competitions set status = 'COMPLETED', finalised_at = now(), updated_at = now() where id = c.id and status <> 'CANCELLED';
  end if;
end $fn$;

create or replace function public.interschool_finalise_round(p_round uuid, p_force boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare x record; c quizbox_interschool.competitions; r quizbox_interschool.rounds;
begin
  x := quizbox_interschool.round_ctx(p_round);
  c := quizbox_interschool.managed(x.competition_id, true);
  select * into r from quizbox_interschool.rounds where id = p_round for update;
  if c.status not in ('PUBLISHED', 'PAUSED', 'CLOSED') then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if r.finalised_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if exists (select 1 from quizbox_interschool.rounds y where y.division_id = r.division_id and y.round_no < r.round_no and y.finalised_at is null) then raise exception 'IS_PREVIOUS_ROUND_NOT_FINALISED' using errcode = '55000'; end if;
  -- an early finish is for administrators only, and never while someone is still writing
  if r.closes_at > now() then
    if not (p_force and quizbox_interschool.is_admin()) then raise exception 'IS_ROUND_STILL_OPEN' using errcode = '55000'; end if;
    if exists (select 1 from quizbox_interschool.sittings s where s.round_id = r.id and s.submitted_at is null and s.expires_at > now()) then raise exception 'IS_LEARNERS_STILL_WRITING' using errcode = '55000'; end if;
  elsif exists (select 1 from quizbox_interschool.sittings s where s.round_id = r.id and s.submitted_at is null and s.expires_at + interval '20 seconds' > now()) then
    raise exception 'IS_LEARNERS_STILL_WRITING' using errcode = '55000';
  end if;
  if r.format <> 'FIELD' and not exists (select 1 from quizbox_interschool.fixtures f where f.round_id = r.id and f.status <> 'CANCELLED') then raise exception 'IS_NO_FIXTURES' using errcode = '55000'; end if;
  perform quizbox_interschool.compute_round(r.id, false);
  update quizbox_interschool.rounds set finalised_at = now(), finalised_by = auth.uid() where id = r.id;
  if r.rule <> 'MANUAL' then perform quizbox_interschool.after_finalise(r.id); end if;
  perform quizbox_interschool.audit('round_finalised', c.id, jsonb_build_object('round', r.id, 'forced', p_force));
  return jsonb_build_object('ok', true, 'qualified', (select count(*) from quizbox_interschool.round_results y where y.round_id = r.id and y.qualified), 'needs_manual_qualification', r.rule = 'MANUAL');
end $fn$;

-- Authorised manual qualification (for rounds set to MANUAL, or an administrator's correction), with a reason.
create or replace function public.interschool_qualify(p_round uuid, p_candidates uuid[], p_qualified boolean, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare x record; c quizbox_interschool.competitions; r quizbox_interschool.rounds; n integer;
begin
  x := quizbox_interschool.round_ctx(p_round);
  c := quizbox_interschool.managed(x.competition_id, true); r := x.r;
  if r.finalised_at is null then raise exception 'IS_ROUND_NOT_FINALISED' using errcode = '55000'; end if;
  if r.rule <> 'MANUAL' and not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  if exists (select 1 from quizbox_interschool.sittings s join quizbox_interschool.rounds y on y.id = s.round_id where y.division_id = r.division_id and y.round_no = r.round_no + 1 and s.candidate_id = any(p_candidates)) then raise exception 'IS_ROUND_ALREADY_STARTED' using errcode = '55000'; end if;
  update quizbox_interschool.round_results set qualified = p_qualified, manual = true where round_id = r.id and candidate_id = any(p_candidates);
  get diagnostics n = row_count;
  update quizbox_interschool.school_results t set qualified = exists (select 1 from quizbox_interschool.round_results y where y.round_id = r.id and y.institution_id = t.institution_id and y.qualified) where t.round_id = r.id;
  perform quizbox_interschool.audit('manual_qualification', c.id, jsonb_build_object('round', r.id, 'candidates', p_candidates, 'qualified', p_qualified, 'reason', p_reason));
  return jsonb_build_object('ok', true, 'changed', n);
end $fn$;

-- Announces a MANUAL round once the organiser has chosen who goes through.
create or replace function public.interschool_announce_round(p_round uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare x record; c quizbox_interschool.competitions;
begin
  x := quizbox_interschool.round_ctx(p_round);
  c := quizbox_interschool.managed(x.competition_id, true);
  if (x.r).finalised_at is null or (x.r).rule <> 'MANUAL' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  perform quizbox_interschool.after_finalise(p_round);
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.interschool_raise_dispute(p_round uuid, p_reason text, p_candidate uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare x record; k quizbox_interschool.candidates; v_id uuid; c quizbox_interschool.competitions;
begin
  perform quizbox_interschool.require_on();
  x := quizbox_interschool.round_ctx(p_round);
  select * into c from quizbox_interschool.competitions where id = x.competition_id;
  if p_candidate is null then select * into k from quizbox_interschool.candidates where competition_id = c.id and user_id = auth.uid() and status in ('CONFIRMED', 'DISQUALIFIED');
  else select * into k from quizbox_interschool.candidates where id = p_candidate and competition_id = c.id; end if;
  if k.id is null or k.division_id <> (x.d).id or not (k.user_id = auth.uid() or quizbox_interschool.staff_of(k.institution_id)) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if (x.r).finalised_at is null then raise exception 'IS_ROUND_NOT_FINALISED' using errcode = '55000'; end if;
  if (x.r).finalised_at < now() - interval '7 days' then raise exception 'IS_DISPUTE_WINDOW_CLOSED' using errcode = '55000'; end if;
  if exists (select 1 from quizbox_interschool.disputes q where q.round_id = p_round and q.candidate_id = k.id and q.status = 'OPEN') then raise exception 'IS_DISPUTE_ALREADY_OPEN' using errcode = '55000'; end if;
  insert into quizbox_interschool.disputes(competition_id, round_id, candidate_id, institution_id, raised_by, reason) values (c.id, p_round, k.id, k.institution_id, auth.uid(), btrim(p_reason)) returning id into v_id;
  perform quizbox_interschool.notify(c.organiser_user_id, 'A result is disputed', c.title || ': a dispute was raised for ' || (x.r).title || '.', '/interschool/manage/' || c.id);
  perform quizbox_interschool.audit('dispute_raised', c.id, jsonb_build_object('dispute', v_id));
  return jsonb_build_object('ok', true, 'dispute_id', v_id);
end $fn$;

create or replace function public.interschool_resolve_dispute(p_dispute uuid, p_upheld boolean, p_resolution text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare q quizbox_interschool.disputes; c quizbox_interschool.competitions;
begin
  select * into q from quizbox_interschool.disputes where id = p_dispute for update;
  c := quizbox_interschool.managed(q.competition_id);
  if c.organiser_kind = 'SPONSOR' and not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if q.status <> 'OPEN' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_resolution, ''))) < 5 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  update quizbox_interschool.disputes set status = case when p_upheld then 'UPHELD' else 'REJECTED' end, resolution = btrim(p_resolution), resolved_by = auth.uid(), resolved_at = now() where id = q.id;
  perform quizbox_interschool.notify(q.raised_by, 'Dispute decided', c.title || ': ' || btrim(p_resolution), '/interschool');
  perform quizbox_interschool.audit('dispute_resolved', c.id, jsonb_build_object('dispute', q.id, 'upheld', p_upheld));
  return jsonb_build_object('ok', true);
end $fn$;

-- A score correction is for platform administrators only. The round is recomputed; once the next round has started, announced qualifications stay as they were.
create or replace function public.interschool_adjust_score(p_round uuid, p_candidate uuid, p_new_score numeric, p_reason text, p_dispute uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare x record; c quizbox_interschool.competitions; old record; started boolean;
begin
  perform quizbox_interschool.require_on();
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  x := quizbox_interschool.round_ctx(p_round);
  select * into c from quizbox_interschool.competitions where id = x.competition_id for update;
  select * into old from quizbox_interschool.round_results where round_id = p_round and candidate_id = p_candidate;
  if (x.r).finalised_at is null or old.candidate_id is null then raise exception 'IS_ROUND_NOT_FINALISED' using errcode = '55000'; end if;
  if p_new_score is null or p_new_score < 0 or p_new_score > old.max_score then raise exception 'IS_SCORE_INVALID' using errcode = '22023'; end if;
  insert into quizbox_interschool.adjustments(round_id, candidate_id, old_score, new_score, reason, dispute_id, made_by) values (p_round, p_candidate, old.score, p_new_score, btrim(p_reason), p_dispute, auth.uid());
  started := exists (select 1 from quizbox_interschool.sittings s join quizbox_interschool.rounds y on y.id = s.round_id where y.division_id = (x.d).id and y.round_no > (x.r).round_no);
  perform quizbox_interschool.compute_round(p_round, started);
  -- totals carried into later finalised rounds follow the correction; their announced qualifiers stay
  perform quizbox_interschool.compute_round(y.id, true) from (select id from quizbox_interschool.rounds where division_id = (x.d).id and round_no > (x.r).round_no and finalised_at is not null order by round_no) y;
  perform quizbox_interschool.audit('score_adjusted', c.id, jsonb_build_object('round', p_round, 'candidate', p_candidate, 'old', old.score, 'new', p_new_score, 'reason', p_reason, 'qualifications_kept', started));
  return jsonb_build_object('ok', true, 'qualifications_kept', started);
end $fn$;

create or replace function public.interschool_disqualify(p_candidate uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k quizbox_interschool.candidates; c quizbox_interschool.competitions; r record;
begin
  select * into k from quizbox_interschool.candidates where id = p_candidate;
  c := quizbox_interschool.managed(k.competition_id, true);
  if c.organiser_kind = 'SPONSOR' and not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  if k.status not in ('PENDING', 'CONFIRMED', 'WAITLISTED') then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  update quizbox_interschool.candidates set status = 'DISQUALIFIED', status_reason = btrim(p_reason), updated_at = now() where id = k.id;
  -- finalised rounds are recomputed without this learner; announced qualifications of others are kept
  for r in select id from quizbox_interschool.rounds where division_id = k.division_id and finalised_at is not null order by round_no loop perform quizbox_interschool.compute_round(r.id, true); end loop;
  perform quizbox_interschool.notify(k.user_id, 'Disqualified', c.title || ': ' || btrim(p_reason), '/interschool');
  perform quizbox_interschool.audit('disqualified', c.id, jsonb_build_object('candidate', k.id, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $fn$;

-- ───────────── views ─────────────
create or replace function quizbox_interschool.school_table(p_round uuid) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('institution_id', s.institution_id, 'school', i.name, 'rank', s.rank, 'score', s.score, 'total_score', s.total_score, 'present', s.present, 'entered', s.entered, 'eligible', s.eligible, 'qualified', s.qualified) order by s.rank nulls last, i.name), '[]'::jsonb)
    from quizbox_interschool.school_results s join public.institutions i on i.id = s.institution_id where s.round_id = p_round
$fn$;

-- A learner's own competitions: every round with what they can do now; scores appear only after a round is finalised.
create or replace function public.interschool_mine() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  return coalesce((select jsonb_agg(jsonb_build_object('candidate_id', k.id, 'status', k.status, 'status_reason', k.status_reason, 'competition', jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status),
      'division', d.title, 'school', (select i.name from public.institutions i where i.id = k.institution_id), 'can_withdraw', k.status in ('PENDING', 'WAITLISTED') or (k.status = 'CONFIRMED' and not quizbox_interschool.roster_locked(c.id, k.institution_id)),
      'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_id', r.id, 'round_no', r.round_no, 'title', r.title, 'question_count', r.question_count, 'duration_seconds', coalesce(st.seconds, r.duration_seconds), 'opens_at', st.opens, 'closes_at', st.closes,
            'state', case when s.submitted_at is not null or (s.id is not null and s.expires_at <= now()) then 'TAKEN' when s.id is not null and st.state = 'OPEN' then 'IN_PROGRESS' else st.state end,
            'opponent', (select i.name from quizbox_interschool.fixtures f join public.institutions i on i.id = case when f.home_institution = k.institution_id then f.away_institution else f.home_institution end where f.id = st.fixture),
            'result', case when r.finalised_at is not null then (select jsonb_build_object('score', y.score, 'max_score', y.max_score, 'percent', y.percent, 'rank', y.rank, 'qualified', y.qualified, 'absent', y.absent) from quizbox_interschool.round_results y where y.round_id = r.id and y.candidate_id = k.id) end) order by r.round_no)
          from quizbox_interschool.rounds r cross join lateral quizbox_interschool.sit_state(k, r.id) st left join quizbox_interschool.sittings s on s.round_id = r.id and s.candidate_id = k.id where r.division_id = k.division_id), '[]'::jsonb)) order by k.created_at desc)
    from quizbox_interschool.candidates k join quizbox_interschool.competitions c on c.id = k.competition_id join quizbox_interschool.divisions d on d.id = k.division_id
   where k.user_id = auth.uid() and k.status <> 'WITHDRAWN' and c.status not in ('DRAFT', 'PENDING_APPROVAL')), '[]'::jsonb);
end $fn$;

-- Results of one finalised round, according to who is asking: organisers and administrators see everything; a school sees the school table and its own learners.
create or replace function public.interschool_results(p_round uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare x record; c quizbox_interschool.competitions; manager boolean; admin boolean; mine uuid[]; all_learners boolean;
begin
  perform quizbox_interschool.require_on();
  x := quizbox_interschool.round_ctx(p_round);
  select * into c from quizbox_interschool.competitions where id = x.competition_id;
  manager := c.id is not null and quizbox_interschool.can_manage(c); admin := quizbox_interschool.is_admin();
  select coalesce(array_agg(s), '{}') into mine from quizbox_interschool.my_schools() s;
  -- a sponsor who organises sees school results and figures, never a list of learners
  all_learners := admin or (coalesce(manager, false) and c.organiser_kind <> 'SPONSOR');
  if c.id is null or not (manager or exists (select 1 from quizbox_interschool.school_entries e where e.competition_id = c.id and e.institution_id = any(mine))
      or exists (select 1 from quizbox_interschool.candidates k where k.competition_id = c.id and k.user_id = auth.uid() and k.status = 'CONFIRMED')) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if (x.r).finalised_at is null then return jsonb_build_object('finalised', false); end if;
  return jsonb_build_object('finalised', true, 'competition', c.title, 'division', (x.d).title, 'round', (x.r).title, 'rule', (x.r).rule, 'schools', quizbox_interschool.school_table(p_round),
    'learners', coalesce((select jsonb_agg(jsonb_build_object('candidate_id', y.candidate_id, 'name', case when admin or k.institution_id = any(mine) then p.full_name else quizbox_interschool.short_name(p.id) end,
          'school', i.name, 'score', y.score, 'max_score', y.max_score, 'percent', y.percent, 'total_score', y.total_score, 'rank', y.rank, 'qualified', y.qualified, 'absent', y.absent, 'seconds', round(y.duration_ms / 1000.0)) order by y.rank nulls last, p.full_name)
        from quizbox_interschool.round_results y join quizbox_interschool.candidates k on k.id = y.candidate_id join public.profiles p on p.id = k.user_id left join public.institutions i on i.id = y.institution_id
       where y.round_id = p_round and (all_learners or k.institution_id = any(mine) or k.user_id = auth.uid())), '[]'::jsonb),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('home', h.name, 'away', a.name, 'home_score', f.home_score, 'away_score', f.away_score, 'winner', w.name, 'note', f.note, 'status', f.status) order by f.match_no)
        from quizbox_interschool.fixtures f join public.institutions h on h.id = f.home_institution left join public.institutions a on a.id = f.away_institution left join public.institutions w on w.id = f.winner_institution where f.round_id = p_round), '[]'::jsonb));
end $fn$;

-- The public scoreboard: school tables and the leading learners by short name, one per finalised round of each division.
create or replace function public.interschool_public_results(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  if not (coalesce(quizbox_core.flag('flags.interschool'), false) and coalesce(quizbox_core.flag('flags.interschool_public'), false)) then return '[]'::jsonb; end if;
  select * into c from quizbox_interschool.competitions where slug = lower(btrim(p_slug)) and published_at is not null and status <> 'CANCELLED';
  return coalesce((select jsonb_agg(jsonb_build_object('division', d.title, 'round_no', r.round_no, 'round', r.title, 'schools', quizbox_interschool.school_table(r.id),
      'leaders', coalesce((select jsonb_agg(jsonb_build_object('rank', z.rank, 'name', z.name, 'school', z.school, 'percent', z.percent) order by z.rank) from (
          select y.rank, quizbox_interschool.short_name(k.user_id) as name, i.name as school, y.percent from quizbox_interschool.round_results y join quizbox_interschool.candidates k on k.id = y.candidate_id
            left join public.institutions i on i.id = y.institution_id
           where y.round_id = r.id and y.rank <= 10 and not exists (select 1 from public.student_profiles s where s.user_id = k.user_id and s.managed_by is not null) order by y.rank limit 10) z), '[]'::jsonb)) order by d.position, r.round_no desc)
    from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id = r.division_id where d.competition_id = c.id and r.finalised_at is not null), '[]'::jsonb);
end $fn$;

-- Fixtures, disputes and round state for the organiser's screen.
create or replace function public.interschool_operations(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id);
  return jsonb_build_object(
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_id', r.id, 'division_id', d.id, 'division', d.title, 'round_no', r.round_no, 'title', r.title, 'format', r.format, 'rule', r.rule, 'opens_at', r.opens_at, 'closes_at', r.closes_at,
        'finalised_at', r.finalised_at, 'started', (select count(*) from quizbox_interschool.sittings s where s.round_id = r.id), 'submitted', (select count(*) from quizbox_interschool.sittings s where s.round_id = r.id and s.submitted_at is not null),
        'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'home', h.name, 'away', a.name, 'scheduled_at', f.scheduled_at, 'closes_at', f.closes_at, 'status', f.status, 'group_no', f.group_no, 'winner', w.name, 'home_score', f.home_score, 'away_score', f.away_score, 'note', f.note) order by f.match_no)
            from quizbox_interschool.fixtures f join public.institutions h on h.id = f.home_institution left join public.institutions a on a.id = f.away_institution left join public.institutions w on w.id = f.winner_institution where f.round_id = r.id), '[]'::jsonb)) order by d.position, r.round_no)
      from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id = r.division_id where d.competition_id = c.id), '[]'::jsonb),
    'disputes', case when c.organiser_kind = 'SPONSOR' and not quizbox_interschool.is_admin() then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'round_id', q.round_id, 'candidate_id', q.candidate_id, 'school', i.name, 'reason', q.reason, 'status', q.status, 'resolution', q.resolution, 'created_at', q.created_at) order by q.status, q.created_at desc)
      from quizbox_interschool.disputes q left join public.institutions i on i.id = q.institution_id where q.competition_id = c.id), '[]'::jsonb) end);
end $fn$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'quizbox_interschool' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.interschool_generate_fixtures(uuid, text, integer), public.interschool_add_fixture(uuid, uuid, uuid, timestamptz, timestamptz, jsonb, integer), public.interschool_change_fixture(uuid, timestamptz, timestamptz, boolean, text),
  public.interschool_start(uuid), public.interschool_save(uuid, jsonb), public.interschool_submit(uuid, jsonb), public.interschool_finalise_round(uuid, boolean), public.interschool_qualify(uuid, uuid[], boolean, text), public.interschool_announce_round(uuid),
  public.interschool_raise_dispute(uuid, text, uuid), public.interschool_resolve_dispute(uuid, boolean, text), public.interschool_adjust_score(uuid, uuid, numeric, text, uuid), public.interschool_disqualify(uuid, text),
  public.interschool_mine(), public.interschool_results(uuid), public.interschool_public_results(text), public.interschool_operations(uuid) from public, anon, authenticated;
grant execute on function public.interschool_generate_fixtures(uuid, text, integer), public.interschool_add_fixture(uuid, uuid, uuid, timestamptz, timestamptz, jsonb, integer), public.interschool_change_fixture(uuid, timestamptz, timestamptz, boolean, text),
  public.interschool_start(uuid), public.interschool_save(uuid, jsonb), public.interschool_submit(uuid, jsonb), public.interschool_finalise_round(uuid, boolean), public.interschool_qualify(uuid, uuid[], boolean, text), public.interschool_announce_round(uuid),
  public.interschool_raise_dispute(uuid, text, uuid), public.interschool_resolve_dispute(uuid, boolean, text), public.interschool_adjust_score(uuid, uuid, numeric, text, uuid), public.interschool_disqualify(uuid, text),
  public.interschool_mine(), public.interschool_results(uuid), public.interschool_operations(uuid) to authenticated;
grant execute on function public.interschool_public_results(text) to authenticated, service_role;

commit;
notify pgrst, 'reload schema';
