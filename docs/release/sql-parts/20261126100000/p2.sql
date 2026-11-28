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
