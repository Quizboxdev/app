-- QuizBox inter-school competitions, part 1 of 5: configuration, organiser permissions, educational divisions, rounds, question selection and freezing.
-- One competition engine, configured (open or invited, head-to-head or multi-school, individual or team, teacher or sponsor organised, school to national scale).
-- It reuses QuizBox accounts, institutions, memberships, the question bank, notifications, the audit log and the payment ledger. It is separate from the single-school
-- challenge engine (challenge_campaigns), which scores individuals, shows answers at once and counts against the free allowance (see docs/interschool/DESIGN.md).
-- Everything lives in the private schema quizbox_interschool (no browser can read a table); browsers call the public.interschool_* functions only.
-- Ships OFF behind flags.interschool (public pages: flags.interschool_public; sponsorship billing: flags.interschool_sponsorship).
-- Builds on 20261021100000 (qb_challenge_admin) and quizbox_core. Additive and idempotent. Rollback: supabase/rollback/interschool_core.sql
begin;

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

create table if not exists quizbox_interschool.rounds (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references quizbox_interschool.divisions(id) on delete cascade,
  round_no integer not null check (round_no between 1 and 100),
  title text not null check (length(btrim(title)) between 1 and 80),
  format text not null default 'FIELD' check (format in ('FIELD', 'ROUND_ROBIN', 'GROUP', 'KNOCKOUT')),
  stage text not null default 'ROUND' check (stage in ('ROUND', 'PRELIMINARY', 'GROUP', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL')),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds between 60 and 14400),
  sections jsonb not null check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) between 1 and 12),
  question_count integer not null check (question_count between 1 and 200),
  rule text not null default 'ALL' check (rule in ('ALL', 'PASS', 'TOP_LEARNERS', 'TOP_SCHOOLS', 'FIXTURE_WINNERS', 'PASS_AND_TOP_LEARNERS', 'MANUAL')),
  pass_percent integer check (pass_percent is null or pass_percent between 0 and 100),
  top_n integer check (top_n is null or top_n between 1 and 100000),
  finalised_at timestamptz,
  finalised_by uuid references public.profiles(id),
  unique (division_id, round_no),
  check (closes_at > opens_at),
  check (rule not in ('PASS', 'PASS_AND_TOP_LEARNERS') or pass_percent is not null),
  check (rule not in ('TOP_LEARNERS', 'TOP_SCHOOLS', 'PASS_AND_TOP_LEARNERS') or top_n is not null),
  check (rule <> 'FIXTURE_WINNERS' or format <> 'FIELD')
);

-- A paper is a frozen set of questions: one per round (common to every competing school), or one per fixture when a fixture has its own academic scope.
create table if not exists quizbox_interschool.papers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references quizbox_interschool.rounds(id) on delete cascade,
  fixture_id uuid,
  frozen_at timestamptz not null default now()
);
create unique index if not exists is_papers_round on quizbox_interschool.papers(round_id) where fixture_id is null;
create table if not exists quizbox_interschool.paper_questions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references quizbox_interschool.papers(id) on delete cascade,
  position integer not null check (position >= 1),
  source_question_id uuid not null,
  source_version integer,
  subject_node_id uuid not null,
  difficulty text,
  question_text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4),
  correct_index smallint not null check (correct_index between 0 and 3),
  explanation text,
  unique (paper_id, position),
  unique (paper_id, source_question_id)
);

alter table quizbox_interschool.competitions enable row level security;
alter table quizbox_interschool.divisions enable row level security;
alter table quizbox_interschool.rounds enable row level security;
alter table quizbox_interschool.papers enable row level security;
alter table quizbox_interschool.paper_questions enable row level security;
revoke all on all tables in schema quizbox_interschool from public, anon, authenticated;

-- ───────────── who may do what ─────────────
create or replace function quizbox_interschool.require_on() returns void language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'IS_SIGN_IN_REQUIRED' using errcode = '28000'; end if;
  if not coalesce(quizbox_core.flag('flags.interschool'), false) then raise exception 'QB_FEATURE_DISABLED' using errcode = '55000'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and lower(p.status::text) = 'active') then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
end $fn$;
create or replace function quizbox_interschool.is_admin() returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce(public.qb_challenge_admin(), false)
$fn$;
-- Verified school staff: an active teacher, administrator or owner membership of a school that QuizBox staff have verified.
create or replace function quizbox_interschool.staff_of(p_institution uuid, p_user uuid default auth.uid()) returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_institution is not null and exists (
    select 1 from public.institution_memberships m join public.institutions i on i.id = m.institution_id
     where m.institution_id = p_institution and m.user_id = p_user and lower(m.status::text) = 'active'
       and lower(m.role::text) in ('teacher', 'admin', 'owner') and i.verified_at is not null and lower(coalesce(i.status::text, 'active')) = 'active')
$fn$;
create or replace function quizbox_interschool.my_schools() returns setof uuid language sql stable security definer set search_path = '' as $fn$
  select distinct m.institution_id from public.institution_memberships m where m.user_id = auth.uid() and quizbox_interschool.staff_of(m.institution_id)
$fn$;
create or replace function quizbox_interschool.approved_sponsor(p_user uuid default auth.uid()) returns boolean language plpgsql stable security definer set search_path = '' as $fn$
declare r boolean := false;
begin
  if to_regclass('public.sponsor_profiles') is null then return false; end if;
  execute 'select exists (select 1 from public.sponsor_profiles s where s.user_id = $1 and upper(coalesce(s.verification_status::text, '''')) = ''VERIFIED'')' into r using p_user;
  return coalesce(r, false);
end $fn$;
create or replace function quizbox_interschool.can_manage(c quizbox_interschool.competitions) returns boolean language sql stable security definer set search_path = '' as $fn$
  select quizbox_interschool.is_admin()
    or (c.organiser_user_id = auth.uid() and (c.organiser_kind = 'SPONSOR' or c.host_institution_id is null or quizbox_interschool.staff_of(c.host_institution_id)))
    or (c.organiser_kind = 'SCHOOL' and quizbox_interschool.staff_of(c.host_institution_id))
$fn$;
create or replace function quizbox_interschool.managed(p_id uuid, p_lock boolean default false) returns quizbox_interschool.competitions language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  perform quizbox_interschool.require_on();
  if p_lock then select * into c from quizbox_interschool.competitions where id = p_id for update;
  else select * into c from quizbox_interschool.competitions where id = p_id; end if;
  if c.id is null or not quizbox_interschool.can_manage(c) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  return c;
end $fn$;
create or replace function quizbox_interschool.audit(p_action text, p_competition uuid, p_details jsonb default '{}') returns void language sql security definer set search_path = '' as $fn$
  insert into public.audit_logs(actor_user_id, action, entity_type, entity_id, status, details) values (auth.uid(), 'interschool.' || p_action, 'interschool_competition', p_competition, 'pass', coalesce(p_details, '{}'::jsonb))
$fn$;
create or replace function quizbox_interschool.notify(p_user uuid, p_title text, p_message text, p_link text default null) returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if p_user is null or to_regclass('public.notifications') is null then return; end if;
  execute 'insert into public.notifications(recipient_user_id, recipient_profile_id, recipient_email, recipient_role, type, title, message, link, category) select p.id, p.id, p.email, p.role, ''interschool'', $1, $2, $3, ''system'' from public.profiles p where p.id = $4'
    using left(p_title, 140), left(p_message, 400), p_link, p_user;
exception when others then null;   -- a notification problem must never block the action that caused it
end $fn$;

-- ───────────── question selection ─────────────
-- Usable bank questions under a subject (optionally narrowed to chosen strands, sub-strands or indicators) for the division's class levels.
create or replace function quizbox_interschool.pool(p_levels text[], p_subject uuid, p_nodes uuid[])
returns table(question_id uuid, difficulty text) language sql stable security definer set search_path = '' as $fn$
  with recursive tree(id, depth) as (
    select n.id, 0 from public.curriculum_nodes n
     where n.is_active and ((p_nodes is null and n.id = p_subject) or (p_nodes is not null and n.id = any(p_nodes)))
    union
    select ch.id, t.depth + 1 from tree t join public.curriculum_nodes ch on ch.parent_id = t.id where ch.is_active and t.depth < 8),
  under_subject(id, depth) as (
    select p_subject, 0
    union
    select ch.id, u.depth + 1 from under_subject u join public.curriculum_nodes ch on ch.parent_id = u.id where u.depth < 8)
  select q.id, lower(coalesce(nullif(q.difficulty_label, ''), q.difficulty_code::text))
    from public.questions q
   where q.curriculum_node_id in (select t.id from tree t) and q.curriculum_node_id in (select u.id from under_subject u)
     and upper(coalesce(nullif(q.source_grade_code, ''), q.grade::text)) = any(p_levels)
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and (q.tenant_id is null or q.tenant_id = public.qb_public_tenant_id())
     and upper(coalesce(q.answer_type, 'SINGLE_CHOICE')) in ('SINGLE_CHOICE', 'TRUE_FALSE') and upper(coalesce(q.correct_answer, '')) in ('A', 'B', 'C', 'D')
     and coalesce(q.source_type, '') not like 'DEV\_%' and public.qb_question_is_listable(q)
$fn$;

-- Checks a round's sections: [{subject_id, count, node_ids?, difficulty?: {easy, medium, hard}}]. Returns each section with the number of usable questions.
create or replace function quizbox_interschool.section_report(p_levels text[], p_sections jsonb) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare s jsonb; subject uuid; n integer; nodes uuid[]; have integer; d text; need integer; short jsonb; out jsonb := '[]'::jsonb; seen text[] := '{}';
begin
  for s in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(s) <> 'object' or coalesce(s ->> 'subject_id', '') !~ '^[0-9a-fA-F-]{36}$' or coalesce(s ->> 'count', '') !~ '^[0-9]{1,3}$' then raise exception 'IS_SECTION_INVALID' using errcode = '22023'; end if;
    subject := (s ->> 'subject_id')::uuid; n := (s ->> 'count')::integer;
    if n < 1 then raise exception 'IS_SECTION_INVALID' using errcode = '22023'; end if;
    if subject::text = any(seen) then raise exception 'IS_SECTION_DUPLICATE_SUBJECT' using errcode = '22023'; end if;
    seen := seen || subject::text;
    if not exists (select 1 from public.curriculum_nodes c where c.id = subject and c.is_active and c.node_type = 'subject'
                    and upper(coalesce(c.canonical_grade_code, c.grade_code)) = any(p_levels)) then raise exception 'IS_SUBJECT_NOT_FOR_LEVEL' using errcode = '22023'; end if;
    nodes := case when jsonb_typeof(s -> 'node_ids') = 'array' and jsonb_array_length(s -> 'node_ids') > 0 then array(select jsonb_array_elements_text(s -> 'node_ids'))::uuid[] end;
    short := '[]'::jsonb;
    if jsonb_typeof(s -> 'difficulty') = 'object' then
      if (select coalesce(sum(value::integer), 0) from jsonb_each_text(s -> 'difficulty') where key in ('easy', 'medium', 'hard')) <> n
         or exists (select 1 from jsonb_object_keys(s -> 'difficulty') k where k not in ('easy', 'medium', 'hard')) then raise exception 'IS_DIFFICULTY_MIX_INVALID' using errcode = '22023'; end if;
      for d, need in select key, value::integer from jsonb_each_text(s -> 'difficulty') loop
        select count(*) into have from quizbox_interschool.pool(p_levels, subject, nodes) p where p.difficulty = d;
        if have < need then short := short || jsonb_build_object('difficulty', d, 'need', need, 'have', have); end if;
      end loop;
    end if;
    select count(*) into have from quizbox_interschool.pool(p_levels, subject, nodes);
    out := out || jsonb_build_array(jsonb_build_object('subject_id', subject, 'subject', (select title from public.curriculum_nodes where id = subject), 'need', n, 'have', have,
             'short', short, 'ok', have >= n and jsonb_array_length(short) = 0));
  end loop;
  return out;
end $fn$;

-- Freezes a paper: copies the chosen questions (text, options, key, version) so later edits to the bank cannot change a competition.
create or replace function quizbox_interschool.freeze_paper(p_round uuid, p_fixture uuid, p_levels text[], p_sections jsonb) returns uuid language plpgsql security definer set search_path = '' as $fn$
declare paper uuid; s jsonb; subject uuid; nodes uuid[]; n integer; pos integer := 0; d text; need integer; got integer; report jsonb;
begin
  report := quizbox_interschool.section_report(p_levels, p_sections);
  if exists (select 1 from jsonb_array_elements(report) r where not (r.value ->> 'ok')::boolean) then raise exception 'IS_NOT_ENOUGH_QUESTIONS' using errcode = '55000', detail = report::text; end if;
  insert into quizbox_interschool.papers(round_id, fixture_id) values (p_round, p_fixture) returning id into paper;
  for s in select value from jsonb_array_elements(p_sections) loop
    subject := (s ->> 'subject_id')::uuid; n := (s ->> 'count')::integer;
    nodes := case when jsonb_typeof(s -> 'node_ids') = 'array' and jsonb_array_length(s -> 'node_ids') > 0 then array(select jsonb_array_elements_text(s -> 'node_ids'))::uuid[] end;
    got := 0;
    for d, need in
      select key, value::integer from jsonb_each_text(case when jsonb_typeof(s -> 'difficulty') = 'object' then s -> 'difficulty' else jsonb_build_object('any', n) end) loop
      insert into quizbox_interschool.paper_questions(paper_id, position, source_question_id, source_version, subject_node_id, difficulty, question_text, options, correct_index, explanation)
      select paper, pos + row_number() over (), x.id, x.version, subject, x.difficulty, x.question_text,
             case when upper(coalesce(x.answer_type, '')) = 'TRUE_FALSE' then jsonb_build_array(x.option_a, x.option_b) else jsonb_build_array(x.option_a, x.option_b, x.option_c, x.option_d) end,
             ascii(upper(x.correct_answer)) - 65, x.explanation
        from (select cand.* from (
                select q.id, q.version, p.difficulty, q.question_text, q.answer_type, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.explanation
                  from quizbox_interschool.pool(p_levels, subject, nodes) p join public.questions q on q.id = p.question_id
                 where (d = 'any' or p.difficulty = d)
                   -- a question already used in any paper of this division is not repeated
                   and not exists (select 1 from quizbox_interschool.paper_questions pq join quizbox_interschool.papers pp on pp.id = pq.paper_id join quizbox_interschool.rounds r on r.id = pp.round_id
                                    where r.division_id = (select r2.division_id from quizbox_interschool.rounds r2 where r2.id = p_round) and pq.source_question_id = q.id)
                 order by random() limit need * 3 + 30) cand
              -- the full availability rule (approved sources, market) is checked on the short list only
              where (select public.qb_question_is_available(q2) from public.questions q2 where q2.id = cand.id)
              limit need) x;
      get diagnostics need = row_count;
      pos := pos + need; got := got + need;
    end loop;
    if got < n then raise exception 'IS_NOT_ENOUGH_QUESTIONS' using errcode = '55000', detail = 'questions already used in other rounds of this division'; end if;
  end loop;
  return paper;
end $fn$;

-- ───────────── configuration ─────────────
create or replace function quizbox_interschool.slugify(p_title text) returns text language plpgsql volatile security definer set search_path = '' as $fn$
declare base text; s text; n integer := 0;
begin
  base := regexp_replace(regexp_replace(lower(btrim(p_title)), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g');
  if length(base) < 3 then base := 'competition'; end if;
  base := left(base, 60); base := regexp_replace(base, '-+$', ''); s := base;
  while exists (select 1 from quizbox_interschool.competitions where slug = s) loop n := n + 1; s := base || '-' || n; end loop;
  return s;
end $fn$;

-- Applies the editable settings in p to a competition row (unknown keys are refused, so a typing mistake cannot be silently ignored).
create or replace function quizbox_interschool.apply_settings(c quizbox_interschool.competitions, p jsonb) returns quizbox_interschool.competitions language plpgsql stable security definer set search_path = '' as $fn$
declare bad text;
begin
  select k into bad from jsonb_object_keys(p) k where k not in ('title', 'description', 'sponsor_name', 'sponsor_logo_url', 'flyer_url', 'scale', 'region', 'district', 'participation', 'entry_mode',
    'registration_mode', 'funding', 'max_schools', 'max_per_school', 'max_per_level_per_school', 'expected_participants', 'capacity', 'waitlist', 'registration_opens_at', 'registration_closes_at',
    'opens_at', 'ends_at', 'rules', 'prizes', 'school_scoring', 'scoring_top_n', 'min_candidates', 'score_carry') limit 1;
  if bad is not null then raise exception 'IS_UNKNOWN_SETTING' using errcode = '22023', detail = bad; end if;
  c := jsonb_populate_record(c, p);
  c.title := btrim(c.title);
  return c;
end $fn$;

create or replace function public.interschool_create(p_settings jsonb, p_host uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; kind text;
begin
  perform quizbox_interschool.require_on();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or length(btrim(coalesce(p_settings ->> 'title', ''))) < 3 then raise exception 'IS_TITLE_REQUIRED' using errcode = '22023'; end if;
  if quizbox_interschool.is_admin() then kind := 'ADMIN';
  elsif p_host is not null and quizbox_interschool.staff_of(p_host) then kind := 'SCHOOL';
  elsif quizbox_interschool.approved_sponsor() then kind := 'SPONSOR';
  else raise exception 'IS_ORGANISER_NOT_APPROVED' using errcode = '42501'; end if;
  if (select count(*) from quizbox_interschool.competitions x where x.organiser_user_id = auth.uid() and x.created_at > now() - interval '1 day') >= 40 then raise exception 'IS_RATE_LIMITED' using errcode = '53400'; end if;
  c.id := gen_random_uuid(); c.slug := quizbox_interschool.slugify(p_settings ->> 'title'); c.title := p_settings ->> 'title'; c.description := ''; c.organiser_user_id := auth.uid(); c.organiser_kind := kind;
  c.host_institution_id := case when kind = 'SCHOOL' or (kind = 'ADMIN' and p_host is not null) then p_host end;
  c.scale := 'SCHOOLS'; c.participation := 'INVITE'; c.entry_mode := 'SCHOOL_TEAM'; c.registration_mode := 'BOTH'; c.funding := case when kind = 'SPONSOR' then 'SPONSORED' else 'FREE' end;
  c.expected_participants := 100; c.capacity := 100; c.waitlist := false; c.rules := ''; c.prizes := ''; c.school_scoring := 'TOP_N'; c.scoring_top_n := 5; c.min_candidates := 1; c.score_carry := 'RESET';
  c.status := 'DRAFT'; c.funded_participants := 0; c.created_at := now(); c.updated_at := now();
  c := quizbox_interschool.apply_settings(c, p_settings);
  if kind = 'SPONSOR' and c.funding <> 'SPONSORED' then raise exception 'IS_SPONSOR_MUST_FUND' using errcode = '22023'; end if;
  if kind = 'SCHOOL' and c.funding = 'COMPLIMENTARY' then raise exception 'IS_ADMIN_ONLY_SETTING' using errcode = '42501'; end if;
  insert into quizbox_interschool.competitions select (c).*;
  perform quizbox_interschool.audit('created', c.id, jsonb_build_object('kind', kind));
  return jsonb_build_object('id', c.id, 'slug', c.slug, 'organiser_kind', kind, 'status', 'DRAFT');
end $fn$;

-- Drafts can change everything. After publishing, only presentation can change, capacity can grow (within funding) and closing dates can move later: rules and scoring are frozen.
create or replace function public.interschool_update(p_id uuid, p_patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; n quizbox_interschool.competitions; bad text;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status in ('COMPLETED', 'CANCELLED') then raise exception 'IS_COMPETITION_CLOSED' using errcode = '55000'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'IS_UNKNOWN_SETTING' using errcode = '22023'; end if;
  if c.status not in ('DRAFT', 'PENDING_APPROVAL') then
    select k into bad from jsonb_object_keys(p_patch) k where k not in ('title', 'description', 'sponsor_name', 'sponsor_logo_url', 'flyer_url', 'prizes', 'capacity', 'max_schools', 'waitlist', 'registration_closes_at', 'ends_at') limit 1;
    if bad is not null then raise exception 'IS_FROZEN_AFTER_PUBLISH' using errcode = '55000', detail = bad; end if;
  end if;
  n := quizbox_interschool.apply_settings(c, p_patch);
  if c.status not in ('DRAFT', 'PENDING_APPROVAL') then
    if n.capacity < c.capacity or (c.max_schools is not null and n.max_schools < c.max_schools) then raise exception 'IS_CAPACITY_CANNOT_SHRINK' using errcode = '55000'; end if;
    if n.registration_closes_at < c.registration_closes_at or n.ends_at < c.ends_at then raise exception 'IS_DATE_CANNOT_MOVE_EARLIER' using errcode = '55000'; end if;
    if n.funding = 'SPONSORED' and n.capacity > greatest(c.funded_participants, c.capacity) then raise exception 'IS_FUNDING_REQUIRED_FOR_CAPACITY' using errcode = '55000'; end if;
  end if;
  if c.organiser_kind = 'SPONSOR' and n.funding <> c.funding and not quizbox_interschool.is_admin() then raise exception 'IS_ADMIN_ONLY_SETTING' using errcode = '42501'; end if;
  if n.funding = 'COMPLIMENTARY' and c.funding <> 'COMPLIMENTARY' and not quizbox_interschool.is_admin() then raise exception 'IS_ADMIN_ONLY_SETTING' using errcode = '42501'; end if;
  -- A change to a draft that was waiting for, or had, approval must be approved again.
  if c.status in ('DRAFT', 'PENDING_APPROVAL') and (n.participation, n.scale, n.funding, n.capacity, n.expected_participants) is distinct from (c.participation, c.scale, c.funding, c.capacity, c.expected_participants) and not quizbox_interschool.is_admin() then
    n.approved_at := null; n.approved_by := null;
  end if;
  n.updated_at := now();
  update quizbox_interschool.competitions x set
    title = n.title, description = n.description, sponsor_name = n.sponsor_name, sponsor_logo_url = n.sponsor_logo_url, flyer_url = n.flyer_url, scale = n.scale, region = n.region, district = n.district,
    participation = n.participation, entry_mode = n.entry_mode, registration_mode = n.registration_mode, funding = n.funding, max_schools = n.max_schools, max_per_school = n.max_per_school,
    max_per_level_per_school = n.max_per_level_per_school, expected_participants = n.expected_participants, capacity = n.capacity, waitlist = n.waitlist, registration_opens_at = n.registration_opens_at,
    registration_closes_at = n.registration_closes_at, opens_at = n.opens_at, ends_at = n.ends_at, rules = n.rules, prizes = n.prizes, school_scoring = n.school_scoring, scoring_top_n = n.scoring_top_n,
    min_candidates = n.min_candidates, score_carry = n.score_carry, approved_at = n.approved_at, approved_by = n.approved_by, updated_at = n.updated_at
  where x.id = c.id;
  perform quizbox_interschool.audit('updated', c.id, jsonb_build_object('fields', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k)));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.interschool_set_divisions(p_id uuid, p_divisions jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; d jsonb; i integer := 0; levels text[]; v_mixed boolean; seen text[] := '{}'; l text;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status not in ('DRAFT', 'PENDING_APPROVAL') then raise exception 'IS_FROZEN_AFTER_PUBLISH' using errcode = '55000'; end if;
  if jsonb_typeof(p_divisions) is distinct from 'array' or jsonb_array_length(p_divisions) not between 1 and 30 then raise exception 'IS_DIVISIONS_INVALID' using errcode = '22023'; end if;
  delete from quizbox_interschool.divisions where competition_id = c.id;
  for d in select value from jsonb_array_elements(p_divisions) loop
    i := i + 1;
    if jsonb_typeof(d -> 'level_codes') is distinct from 'array' then raise exception 'IS_DIVISIONS_INVALID' using errcode = '22023'; end if;
    select array_agg(distinct upper(btrim(x))) into levels from jsonb_array_elements_text(d -> 'level_codes') x;
    v_mixed := coalesce((d ->> 'mixed')::boolean, false);
    if levels is null or exists (select 1 from unnest(levels) x where x !~ '^(B[1-9]|SHS[1-3])$') then raise exception 'IS_LEVEL_INVALID' using errcode = '22023'; end if;
    if cardinality(levels) > 1 and not v_mixed then raise exception 'IS_MIXED_LEVELS_NOT_CONFIRMED' using errcode = '22023'; end if;
    foreach l in array levels loop
      if l = any(seen) then raise exception 'IS_LEVEL_IN_TWO_DIVISIONS' using errcode = '22023'; end if;
      seen := seen || l;
    end loop;
    insert into quizbox_interschool.divisions(competition_id, position, title, level_codes, mixed, capacity)
    values (c.id, i, coalesce(nullif(btrim(d ->> 'title'), ''), array_to_string(levels, ' + ')), levels, cardinality(levels) > 1, nullif(d ->> 'capacity', '')::integer);
  end loop;
  perform quizbox_interschool.audit('divisions_set', c.id, jsonb_build_object('divisions', i));
  return jsonb_build_object('ok', true, 'divisions', (select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'level_codes', v.level_codes, 'position', v.position) order by v.position) from quizbox_interschool.divisions v where v.competition_id = c.id));
end $fn$;

-- Rounds of one division: [{title, format, stage, opens_at, closes_at, duration_seconds, sections, rule, pass_percent, top_n}]. Any number up to 100.
create or replace function public.interschool_set_rounds(p_division uuid, p_rounds jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare d quizbox_interschool.divisions; c quizbox_interschool.competitions; r jsonb; i integer := 0; total integer; prev timestamptz; v_opens timestamptz; v_closes timestamptz;
begin
  select * into d from quizbox_interschool.divisions where id = p_division;
  c := quizbox_interschool.managed(d.competition_id, true);
  if c.status not in ('DRAFT', 'PENDING_APPROVAL') then raise exception 'IS_FROZEN_AFTER_PUBLISH' using errcode = '55000'; end if;
  if jsonb_typeof(p_rounds) is distinct from 'array' or jsonb_array_length(p_rounds) not between 1 and 100 then raise exception 'IS_ROUNDS_INVALID' using errcode = '22023'; end if;
  delete from quizbox_interschool.rounds where division_id = d.id;
  for r in select value from jsonb_array_elements(p_rounds) loop
    i := i + 1;
    v_opens := nullif(r ->> 'opens_at', '')::timestamptz; v_closes := nullif(r ->> 'closes_at', '')::timestamptz;
    if v_opens is null or v_closes is null or v_closes <= v_opens then raise exception 'IS_ROUND_DATES_INVALID' using errcode = '22023'; end if;
    if prev is not null and v_opens < prev then raise exception 'IS_ROUNDS_OVERLAP' using errcode = '22023'; end if;
    prev := v_closes;
    if jsonb_typeof(r -> 'sections') is distinct from 'array' then raise exception 'IS_SECTION_INVALID' using errcode = '22023'; end if;
    perform quizbox_interschool.section_report(d.level_codes, r -> 'sections');
    select sum((x.value ->> 'count')::integer) into total from jsonb_array_elements(r -> 'sections') x;
    insert into quizbox_interschool.rounds(division_id, round_no, title, format, stage, opens_at, closes_at, duration_seconds, sections, question_count, rule, pass_percent, top_n)
    values (d.id, i, coalesce(nullif(btrim(r ->> 'title'), ''), 'Round ' || i), upper(coalesce(nullif(r ->> 'format', ''), 'FIELD')), upper(coalesce(nullif(r ->> 'stage', ''), 'ROUND')),
            v_opens, v_closes, (r ->> 'duration_seconds')::integer, r -> 'sections', total, upper(coalesce(nullif(r ->> 'rule', ''), 'ALL')), nullif(r ->> 'pass_percent', '')::integer, nullif(r ->> 'top_n', '')::integer);
  end loop;
  perform quizbox_interschool.audit('rounds_set', c.id, jsonb_build_object('division', d.id, 'rounds', i));
  return jsonb_build_object('ok', true, 'rounds', i);
end $fn$;

-- Everything that stops a competition being published, in plain codes.
create or replace function quizbox_interschool.problems(c quizbox_interschool.competitions) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare out jsonb := '[]'::jsonb; d record; r record; rep jsonb;
begin
  if c.registration_opens_at is null or c.registration_closes_at is null or c.opens_at is null or c.ends_at is null then out := out || '"IS_DATES_REQUIRED"'::jsonb;
  else
    if c.registration_closes_at <= now() then out := out || '"IS_REGISTRATION_ALREADY_CLOSED"'::jsonb; end if;
    if c.registration_closes_at > c.ends_at then out := out || '"IS_REGISTRATION_CLOSES_AFTER_END"'::jsonb; end if;
  end if;
  if c.capacity > c.expected_participants then out := out || '"IS_CAPACITY_ABOVE_EXPECTED"'::jsonb; end if;
  if c.school_scoring = 'TEAM_TOTAL' and c.max_per_level_per_school is null then out := out || '"IS_TEAM_SIZE_REQUIRED"'::jsonb; end if;
  if not exists (select 1 from quizbox_interschool.divisions v where v.competition_id = c.id) then out := out || '"IS_NO_DIVISIONS"'::jsonb; end if;
  for d in select * from quizbox_interschool.divisions v where v.competition_id = c.id order by v.position loop
    if not exists (select 1 from quizbox_interschool.rounds x where x.division_id = d.id) then out := out || jsonb_build_array(jsonb_build_object('code', 'IS_NO_ROUNDS', 'division', d.title)); end if;
    for r in select * from quizbox_interschool.rounds x where x.division_id = d.id order by x.round_no loop
      if c.opens_at is not null and (r.opens_at < c.opens_at or r.closes_at > c.ends_at) then out := out || jsonb_build_array(jsonb_build_object('code', 'IS_ROUND_OUTSIDE_COMPETITION', 'division', d.title, 'round', r.round_no)); end if;
      rep := quizbox_interschool.section_report(d.level_codes, r.sections);
      if exists (select 1 from jsonb_array_elements(rep) x where not (x.value ->> 'ok')::boolean) then out := out || jsonb_build_array(jsonb_build_object('code', 'IS_NOT_ENOUGH_QUESTIONS', 'division', d.title, 'round', r.round_no, 'sections', rep)); end if;
    end loop;
  end loop;
  return out;
end $fn$;

create or replace function public.interschool_check(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; d record; r record; rows jsonb := '[]'::jsonb;
begin
  c := quizbox_interschool.managed(p_id);
  for d in select * from quizbox_interschool.divisions v where v.competition_id = c.id order by v.position loop
    for r in select * from quizbox_interschool.rounds x where x.division_id = d.id order by x.round_no loop
      rows := rows || jsonb_build_array(jsonb_build_object('division', d.title, 'round', r.round_no, 'sections', quizbox_interschool.section_report(d.level_codes, r.sections)));
    end loop;
  end loop;
  return jsonb_build_object('problems', quizbox_interschool.problems(c), 'questions', rows, 'needs_approval', quizbox_interschool.needs_approval(c), 'approved', c.approved_at is not null);
end $fn$;

-- School staff may run invited competitions themselves; anything open to all schools, wider than a few schools, sponsored or complimentary needs a QuizBox administrator.
create or replace function quizbox_interschool.needs_approval(c quizbox_interschool.competitions) returns boolean language sql stable security definer set search_path = '' as $fn$
  select c.organiser_kind <> 'ADMIN' and (c.organiser_kind = 'SPONSOR' or c.participation = 'OPEN' or c.scale in ('REGIONAL', 'NATIONAL') or c.funding <> 'FREE' or c.capacity > 500)
$fn$;

create or replace function public.interschool_request_approval(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status <> 'DRAFT' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  update quizbox_interschool.competitions set status = 'PENDING_APPROVAL', decision_note = null, updated_at = now() where id = c.id;
  perform quizbox_interschool.audit('submitted', c.id);
  return jsonb_build_object('ok', true, 'status', 'PENDING_APPROVAL');
end $fn$;

create or replace function public.interschool_decide(p_id uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  perform quizbox_interschool.require_on();
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into c from quizbox_interschool.competitions where id = p_id for update;
  if c.id is null or c.status <> 'PENDING_APPROVAL' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if not p_approve and length(btrim(coalesce(p_note, ''))) < 3 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  update quizbox_interschool.competitions set status = 'DRAFT', approved_at = case when p_approve then now() end, approved_by = case when p_approve then auth.uid() end,
         decision_note = nullif(btrim(p_note), ''), updated_at = now() where id = c.id;
  perform quizbox_interschool.audit(case when p_approve then 'approved' else 'declined' end, c.id, jsonb_build_object('note', p_note));
  perform quizbox_interschool.notify(c.organiser_user_id, case when p_approve then 'Competition approved' else 'Competition needs changes' end,
    c.title || case when p_approve then ' is approved. You can publish it.' else ': ' || coalesce(p_note, '') end, '/interschool/manage/' || c.id);
  return jsonb_build_object('ok', true, 'approved', p_approve);
end $fn$;

create or replace function public.interschool_publish(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; probs jsonb; d record; r record; papers integer := 0;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status <> 'DRAFT' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if quizbox_interschool.needs_approval(c) and c.approved_at is null then raise exception 'IS_APPROVAL_REQUIRED' using errcode = '55000'; end if;
  probs := quizbox_interschool.problems(c);
  if jsonb_array_length(probs) > 0 then raise exception 'IS_NOT_READY' using errcode = '55000', detail = probs::text; end if;
  -- Funded competitions may be announced only after verified payment or an authorised funding approval.
  if c.funding = 'SPONSORED' and (c.funding_cleared_at is null or c.funded_participants < c.capacity) then raise exception 'IS_FUNDING_REQUIRED' using errcode = '55000'; end if;
  for d in select * from quizbox_interschool.divisions v where v.competition_id = c.id order by v.position loop
    for r in select * from quizbox_interschool.rounds x where x.division_id = d.id order by x.round_no loop
      delete from quizbox_interschool.papers where round_id = r.id and fixture_id is null;
      perform quizbox_interschool.freeze_paper(r.id, null, d.level_codes, r.sections); papers := papers + 1;
    end loop;
  end loop;
  update quizbox_interschool.competitions set status = 'PUBLISHED', published_at = coalesce(published_at, now()), updated_at = now() where id = c.id;
  perform quizbox_interschool.audit('published', c.id, jsonb_build_object('papers_frozen', papers));
  return jsonb_build_object('ok', true, 'slug', c.slug, 'papers_frozen', papers);
end $fn$;

create or replace function public.interschool_set_status(p_id uuid, p_status text, p_reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; v text := upper(coalesce(p_status, '')); ok boolean;
begin
  c := quizbox_interschool.managed(p_id, true);
  ok := (c.status = 'PUBLISHED' and v in ('PAUSED', 'CLOSED', 'CANCELLED')) or (c.status = 'PAUSED' and v in ('PUBLISHED', 'CLOSED', 'CANCELLED'))
     or (c.status = 'CLOSED' and v in ('PUBLISHED', 'CANCELLED')) or (c.status in ('DRAFT', 'PENDING_APPROVAL') and v = 'CANCELLED');
  if not ok then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if v = 'CANCELLED' and length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  update quizbox_interschool.competitions set status = v, decision_note = coalesce(nullif(btrim(p_reason), ''), decision_note), updated_at = now() where id = c.id;
  perform quizbox_interschool.audit('status_' || lower(v), c.id, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true, 'status', v);
end $fn$;

create or replace function public.interschool_duplicate(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; n quizbox_interschool.competitions; d record; nd uuid;
begin
  c := quizbox_interschool.managed(p_id);
  n := c; n.id := gen_random_uuid(); n.title := left(c.title || ' (copy)', 140); n.slug := quizbox_interschool.slugify(n.title); n.organiser_user_id := auth.uid();
  n.status := 'DRAFT'; n.approved_at := null; n.approved_by := null; n.decision_note := null; n.funding_cleared_at := null; n.funded_participants := 0; n.listed_at := null; n.listed_by := null;
  n.published_at := null; n.finalised_at := null; n.registration_opens_at := null; n.registration_closes_at := null; n.opens_at := null; n.ends_at := null; n.created_at := now(); n.updated_at := now();
  if quizbox_interschool.is_admin() and c.organiser_user_id <> auth.uid() then n.organiser_kind := 'ADMIN'; end if;
  insert into quizbox_interschool.competitions select (n).*;
  for d in select * from quizbox_interschool.divisions v where v.competition_id = c.id loop
    insert into quizbox_interschool.divisions(competition_id, position, title, level_codes, mixed, capacity) values (n.id, d.position, d.title, d.level_codes, d.mixed, d.capacity) returning id into nd;
    insert into quizbox_interschool.rounds(division_id, round_no, title, format, stage, opens_at, closes_at, duration_seconds, sections, question_count, rule, pass_percent, top_n)
    select nd, r.round_no, r.title, r.format, r.stage, r.opens_at, r.closes_at, r.duration_seconds, r.sections, r.question_count, r.rule, r.pass_percent, r.top_n from quizbox_interschool.rounds r where r.division_id = d.id;
  end loop;
  perform quizbox_interschool.audit('duplicated', n.id, jsonb_build_object('from', c.id));
  return jsonb_build_object('id', n.id, 'slug', n.slug);
end $fn$;

-- The organiser's own view: full configuration (never any question or answer key).
create or replace function public.interschool_manage_get(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id);
  return to_jsonb(c) || jsonb_build_object('is_admin', quizbox_interschool.is_admin(), 'needs_approval', quizbox_interschool.needs_approval(c),
    'divisions', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('rounds',
        coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('frozen', exists (select 1 from quizbox_interschool.papers p where p.round_id = r.id)) order by r.round_no) from quizbox_interschool.rounds r where r.division_id = d.id), '[]'::jsonb)) order by d.position)
      from quizbox_interschool.divisions d where d.competition_id = c.id), '[]'::jsonb));
end $fn$;

create or replace function public.interschool_manage_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  return jsonb_build_object(
    'can_create', jsonb_build_object('admin', quizbox_interschool.is_admin(), 'sponsor', quizbox_interschool.approved_sponsor(),
      'schools', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name) from public.institutions i where i.id in (select quizbox_interschool.my_schools())), '[]'::jsonb)),
    'competitions', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select c.id, c.slug, c.title, c.status, c.participation, c.scale, c.funding, c.capacity, c.organiser_kind, c.approved_at is not null as approved, c.decision_note,
             c.registration_closes_at, c.opens_at, c.ends_at, c.created_at
        from quizbox_interschool.competitions c where quizbox_interschool.can_manage(c) order by c.created_at desc limit 200) x), '[]'::jsonb));
end $fn$;

-- Subjects and topics an organiser can pick for a level, with the number of usable questions under each.
create or replace function public.interschool_subjects(p_levels text[]) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare lv text[];
begin
  perform quizbox_interschool.require_on();
  if not (quizbox_interschool.is_admin() or quizbox_interschool.approved_sponsor() or exists (select 1 from quizbox_interschool.my_schools())) then raise exception 'IS_ORGANISER_NOT_APPROVED' using errcode = '42501'; end if;
  select array_agg(upper(btrim(x))) into lv from unnest(p_levels) x;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'level', upper(coalesce(n.canonical_grade_code, n.grade_code)),
      'questions', (select count(*) from quizbox_interschool.pool(lv, n.id, null))) order by upper(coalesce(n.canonical_grade_code, n.grade_code)), n.title)
    from public.curriculum_nodes n where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = any(lv)), '[]'::jsonb);
end $fn$;
create or replace function public.interschool_topics(p_subject uuid, p_parent uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare lv text[];
begin
  perform quizbox_interschool.require_on();
  if not (quizbox_interschool.is_admin() or quizbox_interschool.approved_sponsor() or exists (select 1 from quizbox_interschool.my_schools())) then raise exception 'IS_ORGANISER_NOT_APPROVED' using errcode = '42501'; end if;
  select array[upper(coalesce(canonical_grade_code, grade_code))] into lv from public.curriculum_nodes where id = p_subject and node_type = 'subject';
  if lv is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'code', n.code, 'type', n.node_type,
      'questions', (select count(*) from quizbox_interschool.pool(lv, p_subject, array[n.id]))) order by n.code, n.title)
    from public.curriculum_nodes n where n.is_active and n.parent_id = coalesce(p_parent, p_subject)), '[]'::jsonb);
end $fn$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'quizbox_interschool' or (n.nspname = 'public' and p.proname like 'interschool\_%') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
grant execute on function public.interschool_create(jsonb, uuid), public.interschool_update(uuid, jsonb), public.interschool_set_divisions(uuid, jsonb), public.interschool_set_rounds(uuid, jsonb), public.interschool_check(uuid),
  public.interschool_request_approval(uuid), public.interschool_decide(uuid, boolean, text), public.interschool_publish(uuid), public.interschool_set_status(uuid, text, text), public.interschool_duplicate(uuid),
  public.interschool_manage_get(uuid), public.interschool_manage_list(), public.interschool_subjects(text[]), public.interschool_topics(uuid, uuid) to authenticated;

commit;
notify pgrst, 'reload schema';
