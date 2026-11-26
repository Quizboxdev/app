-- QuizBox inter-school competitions, part 2 of 5: school invitations, candidate registration, affiliation and level checks, capacity, waiting lists, replacement and roster lock.
-- Every change to who holds a place takes a lock on the competition row first, so two registrations at the same moment can never go over a limit.
-- Places are held by PENDING (waiting for the school to confirm) and CONFIRMED candidates. School staff see only their own school's learners.
-- Builds on 20261126100000. Additive and idempotent. Rollback: supabase/rollback/interschool_registration.sql


create table if not exists quizbox_interschool.school_entries (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_interschool.competitions(id) on delete cascade,
  institution_id uuid not null references public.institutions(id) on delete cascade,
  status text not null check (status in ('INVITED', 'REGISTERED', 'WAITLISTED', 'DECLINED', 'WITHDRAWN', 'DISQUALIFIED')),
  source text not null default 'DIRECT' check (source in ('DIRECT', 'LINK', 'QR', 'WHATSAPP', 'SOCIAL', 'SPONSOR', 'INVITE', 'SCHOOL')),
  invited_by uuid references public.profiles(id),
  invited_at timestamptz,
  registered_by uuid references public.profiles(id),
  registered_at timestamptz,
  roster_locked_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique (competition_id, institution_id)
);
create index if not exists is_entries_institution on quizbox_interschool.school_entries(institution_id, status);

create table if not exists quizbox_interschool.candidates (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references quizbox_interschool.competitions(id) on delete cascade,
  division_id uuid not null references quizbox_interschool.divisions(id) on delete cascade,
  institution_id uuid references public.institutions(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  level_code text not null,
  status text not null check (status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'WITHDRAWN', 'REJECTED', 'DISQUALIFIED')),
  source text not null default 'DIRECT' check (source in ('DIRECT', 'LINK', 'QR', 'WHATSAPP', 'SOCIAL', 'SPONSOR', 'INVITE', 'SCHOOL')),
  registered_by uuid not null references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  confirmed_at timestamptz,
  replaces_candidate uuid references quizbox_interschool.candidates(id),
  status_reason text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- one live registration per learner per competition
create unique index if not exists is_candidates_one on quizbox_interschool.candidates(competition_id, user_id) where status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED');
create index if not exists is_candidates_comp on quizbox_interschool.candidates(competition_id, status, division_id, institution_id);
create index if not exists is_candidates_user on quizbox_interschool.candidates(user_id);

create table if not exists quizbox_interschool.events (
  id bigint generated always as identity primary key,
  competition_id uuid not null references quizbox_interschool.competitions(id) on delete cascade,
  kind text not null check (kind in ('view', 'share', 'full', 'reminder_registration', 'reminder_round')),
  source text,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists is_events_comp on quizbox_interschool.events(competition_id, kind);

alter table quizbox_interschool.school_entries enable row level security;
alter table quizbox_interschool.candidates enable row level security;
alter table quizbox_interschool.events enable row level security;
revoke all on all tables in schema quizbox_interschool from public, anon, authenticated;

create or replace function quizbox_interschool.source_of(p text) returns text language sql immutable set search_path = '' as $fn$
  select case when upper(coalesce(p, '')) in ('LINK', 'QR', 'WHATSAPP', 'SOCIAL', 'SPONSOR', 'INVITE', 'SCHOOL') then upper(p) else 'DIRECT' end
$fn$;
create or replace function quizbox_interschool.level_of(p_user uuid) returns text language sql stable security definer set search_path = '' as $fn$
  select case when v = 'B10' then 'SHS1' else v end from (select upper(coalesce(nullif(s.grade_code, ''), s.grade::text)) as v from public.student_profiles s where s.user_id = p_user) x
$fn$;
-- Verified affiliation: an active learner membership of the school, or an active membership of one of its classes. A school typed at sign-up is not proof.
create or replace function quizbox_interschool.learner_verified(p_user uuid, p_institution uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.institution_memberships m where m.institution_id = p_institution and m.user_id = p_user and lower(m.role::text) = 'student' and lower(m.status::text) = 'active')
      or exists (select 1 from public.class_memberships m join public.classes k on k.id = m.class_id
                  where k.institution_id = p_institution and m.student_user_id = p_user and lower(m.status::text) = 'active' and lower(k.status::text) = 'active')
$fn$;
create or replace function quizbox_interschool.school_learner(p_user uuid, p_institution uuid) returns boolean language plpgsql stable security definer set search_path = '' as $fn$
declare r boolean;
begin
  if quizbox_interschool.learner_verified(p_user, p_institution) then return true; end if;
  select exists (select 1 from public.student_profiles s where s.user_id = p_user and s.institution_id = p_institution) into r;
  return r;
end $fn$;
create or replace function quizbox_interschool.short_name(p_user uuid) returns text language sql stable security definer set search_path = '' as $fn$
  select split_part(btrim(p.full_name), ' ', 1) || case when position(' ' in btrim(p.full_name)) > 0 then ' ' || upper(left(regexp_replace(btrim(p.full_name), '^.*\s', ''), 1)) || '.' else '' end
    from public.profiles p where p.id = p_user
$fn$;

create or replace function quizbox_interschool.registration_state(c quizbox_interschool.competitions) returns text language sql stable security definer set search_path = '' as $fn$
  select case
    when c.status = 'CANCELLED' then 'CANCELLED'
    when c.status in ('COMPLETED', 'CLOSED') or (c.ends_at is not null and c.ends_at <= now()) or (c.registration_closes_at is not null and c.registration_closes_at <= now()) then 'CLOSED'
    when c.status = 'PAUSED' then 'PAUSED'
    when c.status <> 'PUBLISHED' then 'NOT_YET'
    when c.registration_opens_at is not null and c.registration_opens_at > now() then 'NOT_YET'
    when c.funding = 'SPONSORED' and c.funding_cleared_at is null then 'AWAITING_FUNDING'
    when (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.status in ('PENDING', 'CONFIRMED')) >= c.capacity then case when c.waitlist then 'WAITLIST' else 'FULL' end
    else 'OPEN' end
$fn$;

-- Rosters lock when the organiser or the school locks them, and for everyone when the first round opens.
create or replace function quizbox_interschool.roster_locked(p_competition uuid, p_institution uuid) returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from quizbox_interschool.school_entries e where e.competition_id = p_competition and e.institution_id = p_institution and e.roster_locked_at is not null)
      or exists (select 1 from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id = r.division_id where d.competition_id = p_competition and r.opens_at <= now())
$fn$;

create or replace function quizbox_interschool.notify_school(p_institution uuid, p_title text, p_message text, p_link text) returns void language plpgsql security definer set search_path = '' as $fn$
declare u uuid;
begin
  for u in select distinct m.user_id from public.institution_memberships m where m.institution_id = p_institution and lower(m.status::text) = 'active' and lower(m.role::text) in ('teacher', 'admin', 'owner') limit 50 loop
    perform quizbox_interschool.notify(u, p_title, p_message, p_link);
  end loop;
end $fn$;
