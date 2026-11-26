-- QuizBox inter-school competitions, part 2 of 5: school invitations, candidate registration, affiliation and level checks, capacity, waiting lists, replacement and roster lock.
-- Every change to who holds a place takes a lock on the competition row first, so two registrations at the same moment can never go over a limit.
-- Places are held by PENDING (waiting for the school to confirm) and CONFIRMED candidates. School staff see only their own school's learners.
-- Builds on 20261126100000. Additive and idempotent. Rollback: supabase/rollback/interschool_registration.sql
begin;

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

-- Puts a school into a competition (called with the competition row locked). Returns the entry; raises when no more schools fit.
create or replace function quizbox_interschool.enter_school(c quizbox_interschool.competitions, p_institution uuid, p_source text) returns quizbox_interschool.school_entries
language plpgsql security definer set search_path = '' as $fn$
declare e quizbox_interschool.school_entries; used integer; target text := 'REGISTERED';
begin
  select * into e from quizbox_interschool.school_entries where competition_id = c.id and institution_id = p_institution;
  if e.id is not null and e.status = 'REGISTERED' then return e; end if;
  if e.id is not null and e.status = 'DISQUALIFIED' then raise exception 'IS_SCHOOL_DISQUALIFIED' using errcode = '55000'; end if;
  if c.participation = 'INVITE' and (e.id is null or e.status not in ('INVITED', 'WAITLISTED', 'WITHDRAWN', 'DECLINED') or e.invited_at is null) then raise exception 'IS_SCHOOL_NOT_INVITED' using errcode = '42501'; end if;
  if not exists (select 1 from public.institutions i where i.id = p_institution and i.verified_at is not null) then raise exception 'IS_SCHOOL_NOT_VERIFIED' using errcode = '55000'; end if;
  select count(*) into used from quizbox_interschool.school_entries x where x.competition_id = c.id and x.status = 'REGISTERED';
  if c.max_schools is not null and used >= c.max_schools then
    if not c.waitlist then raise exception 'IS_SCHOOL_PLACES_FULL' using errcode = '55000'; end if;
    target := 'WAITLISTED';
  end if;
  insert into quizbox_interschool.school_entries(competition_id, institution_id, status, source, registered_by, registered_at)
  values (c.id, p_institution, target, quizbox_interschool.source_of(p_source), auth.uid(), now())
  on conflict (competition_id, institution_id) do update set status = excluded.status, registered_by = excluded.registered_by, registered_at = excluded.registered_at
  returning * into e;
  return e;
end $fn$;

-- Which limit stops one more place (null when a place is free). Call with the competition row locked.
create or replace function quizbox_interschool.limit_reached(c quizbox_interschool.competitions, p_division uuid, p_institution uuid) returns text language plpgsql stable security definer set search_path = '' as $fn$
declare n integer; cap integer;
begin
  select count(*) into n from quizbox_interschool.candidates k where k.competition_id = c.id and k.status in ('PENDING', 'CONFIRMED');
  if n >= c.capacity then return 'IS_COMPETITION_FULL'; end if;
  select d.capacity into cap from quizbox_interschool.divisions d where d.id = p_division;
  if cap is not null then
    select count(*) into n from quizbox_interschool.candidates k where k.division_id = p_division and k.status in ('PENDING', 'CONFIRMED');
    if n >= cap then return 'IS_DIVISION_FULL'; end if;
  end if;
  if p_institution is not null then
    if c.max_per_school is not null then
      select count(*) into n from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = p_institution and k.status in ('PENDING', 'CONFIRMED');
      if n >= c.max_per_school then return 'IS_SCHOOL_ALLOCATION_FULL'; end if;
    end if;
    if c.max_per_level_per_school is not null then
      select count(*) into n from quizbox_interschool.candidates k where k.division_id = p_division and k.institution_id = p_institution and k.status in ('PENDING', 'CONFIRMED');
      if n >= c.max_per_level_per_school then return 'IS_SCHOOL_LEVEL_FULL'; end if;
    end if;
  end if;
  return null;
end $fn$;

-- The single path that adds a candidate. Call with the competition row locked.
create or replace function quizbox_interschool.add_candidate(c quizbox_interschool.competitions, p_division uuid, p_institution uuid, p_user uuid, p_source text, p_by_staff boolean, p_replaces uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare d quizbox_interschool.divisions; lv text; sp record; e quizbox_interschool.school_entries; v_status text; blocked text; v_id uuid; existing quizbox_interschool.candidates;
begin
  select * into d from quizbox_interschool.divisions where id = p_division and competition_id = c.id;
  if d.id is null then raise exception 'IS_DIVISION_NOT_FOUND' using errcode = 'P0002'; end if;
  select s.managed_by into sp from public.student_profiles s join public.profiles p on p.id = s.user_id where s.user_id = p_user and lower(p.status::text) = 'active';
  if not found then raise exception 'IS_NOT_A_LEARNER' using errcode = '55000'; end if;
  if sp.managed_by is not null and not (p_by_staff and coalesce(quizbox_core.flag('interschool.allow_managed_learners'), false)) then raise exception 'IS_MANAGED_LEARNER_NOT_ALLOWED' using errcode = '55000'; end if;
  lv := quizbox_interschool.level_of(p_user);
  if lv is null or not (lv = any(d.level_codes)) then raise exception 'IS_LEVEL_MISMATCH' using errcode = '55000', detail = coalesce(lv, 'none'); end if;
  select * into existing from quizbox_interschool.candidates k where k.competition_id = c.id and k.user_id = p_user and k.status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED');
  if existing.id is not null then
    if existing.status = 'DISQUALIFIED' then raise exception 'IS_DISQUALIFIED' using errcode = '55000'; end if;
    if existing.division_id = d.id and existing.institution_id is not distinct from p_institution then return jsonb_build_object('candidate_id', existing.id, 'status', existing.status, 'already', true); end if;
    raise exception 'IS_ALREADY_REGISTERED' using errcode = '55000';
  end if;
  if p_institution is null then
    if c.entry_mode <> 'INDIVIDUAL' or c.participation <> 'OPEN' then raise exception 'IS_SCHOOL_REQUIRED' using errcode = '55000'; end if;
    v_status := 'CONFIRMED';
  else
    if not quizbox_interschool.school_learner(p_user, p_institution) then raise exception 'IS_NOT_THIS_SCHOOL' using errcode = '55000'; end if;
    e := quizbox_interschool.enter_school(c, p_institution, p_source);
    v_status := case when e.status = 'WAITLISTED' then 'WAITLISTED' when p_by_staff or quizbox_interschool.learner_verified(p_user, p_institution) then 'CONFIRMED' else 'PENDING' end;
  end if;
  if v_status <> 'WAITLISTED' then
    blocked := quizbox_interschool.limit_reached(c, d.id, p_institution);
    if blocked is not null then
      if not c.waitlist or p_replaces is not null then raise exception '%', blocked using errcode = '55000'; end if;
      v_status := 'WAITLISTED';
    end if;
  end if;
  insert into quizbox_interschool.candidates(competition_id, division_id, institution_id, user_id, level_code, status, source, registered_by, confirmed_by, confirmed_at, replaces_candidate)
  values (c.id, d.id, p_institution, p_user, lv, v_status, quizbox_interschool.source_of(p_source), auth.uid(), case when v_status = 'CONFIRMED' and p_by_staff then auth.uid() end, case when v_status = 'CONFIRMED' then now() end, p_replaces)
  returning id into v_id;
  perform quizbox_interschool.notify(p_user, case v_status when 'WAITLISTED' then 'You are on the waiting list' when 'PENDING' then 'Registration received' else 'You are registered' end,
    c.title || case v_status when 'PENDING' then ': your school must confirm your place.' when 'WAITLISTED' then ': you will be told if a place opens.' else ' (' || d.title || ').' end, '/interschool');
  if v_status = 'PENDING' then perform quizbox_interschool.notify_school(p_institution, 'Confirm a competition registration', 'A learner registered for ' || c.title || ' and is waiting for your school to confirm.', '/interschool/school/' || c.id); end if;
  -- Tell the school, once, when its allocation is used up.
  if p_institution is not null and v_status <> 'WAITLISTED' and c.max_per_school is not null
     and (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = p_institution and k.status in ('PENDING', 'CONFIRMED')) = c.max_per_school
     and not exists (select 1 from quizbox_interschool.events v where v.competition_id = c.id and v.kind = 'full' and v.ref = p_institution::text) then
    insert into quizbox_interschool.events(competition_id, kind, ref) values (c.id, 'full', p_institution::text);
    perform quizbox_interschool.notify_school(p_institution, 'School places are full', c.title || ': your school has used all ' || c.max_per_school || ' places.', '/interschool/school/' || c.id);
  end if;
  return jsonb_build_object('candidate_id', v_id, 'status', v_status, 'already', false);
end $fn$;

-- Moves waiting candidates up, oldest first, while places allow. Call with the competition row locked.
create or replace function quizbox_interschool.promote_waiting(c quizbox_interschool.competitions) returns integer language plpgsql security definer set search_path = '' as $fn$
declare k record; moved integer := 0; v_status text;
begin
  if c.status <> 'PUBLISHED' then return 0; end if;
  for k in select x.* from quizbox_interschool.candidates x
            left join quizbox_interschool.school_entries e on e.competition_id = x.competition_id and e.institution_id = x.institution_id
           where x.competition_id = c.id and x.status = 'WAITLISTED' and (x.institution_id is null or e.status = 'REGISTERED') order by x.created_at, x.id loop
    if quizbox_interschool.roster_locked(c.id, k.institution_id) then continue; end if;
    if quizbox_interschool.limit_reached(c, k.division_id, k.institution_id) is not null then continue; end if;
    v_status := case when k.institution_id is null or k.registered_by <> k.user_id or quizbox_interschool.learner_verified(k.user_id, k.institution_id) then 'CONFIRMED' else 'PENDING' end;
    update quizbox_interschool.candidates set status = v_status, updated_at = now(), confirmed_at = case when v_status = 'CONFIRMED' then now() end where id = k.id;
    perform quizbox_interschool.notify(k.user_id, 'A place opened for you', c.title || ': you have moved off the waiting list.', '/interschool');
    moved := moved + 1;
  end loop;
  return moved;
end $fn$;

create or replace function quizbox_interschool.open_competition(p_id uuid) returns quizbox_interschool.competitions language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  perform quizbox_interschool.require_on();
  select * into c from quizbox_interschool.competitions where id = p_id for update;
  if c.id is null or c.status in ('DRAFT', 'PENDING_APPROVAL') then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  return c;
end $fn$;
create or replace function quizbox_interschool.require_registration_open(c quizbox_interschool.competitions) returns void language plpgsql stable security definer set search_path = '' as $fn$
declare s text := quizbox_interschool.registration_state(c);
begin
  if s in ('OPEN', 'WAITLIST') then return; end if;
  raise exception '%', case s when 'FULL' then 'IS_COMPETITION_FULL' when 'NOT_YET' then 'IS_REGISTRATION_NOT_OPEN' when 'PAUSED' then 'IS_REGISTRATION_PAUSED' when 'CANCELLED' then 'IS_COMPETITION_CANCELLED'
    when 'AWAITING_FUNDING' then 'IS_FUNDING_REQUIRED' else 'IS_REGISTRATION_CLOSED' end using errcode = '55000';
end $fn$;

-- ───────────── invitations and school entry ─────────────
create or replace function public.interschool_school_search(p_query text default null, p_region text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  if not (quizbox_interschool.is_admin() or quizbox_interschool.approved_sponsor() or exists (select 1 from quizbox_interschool.my_schools())) then raise exception 'IS_ORGANISER_NOT_APPROVED' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x.name) from (select i.id, i.name, i.region, i.district from public.institutions i
     where i.verified_at is not null and lower(coalesce(i.status::text, 'active')) = 'active'
       and (nullif(btrim(p_query), '') is null or i.name ilike '%' || btrim(p_query) || '%') and (nullif(btrim(p_region), '') is null or i.region ilike btrim(p_region))
     order by i.name limit 50) x), '[]'::jsonb);
end $fn$;

create or replace function public.interschool_invite(p_id uuid, p_institutions uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; i uuid; n integer := 0; changed integer;
begin
  c := quizbox_interschool.managed(p_id, true);
  if c.status not in ('PUBLISHED', 'PAUSED') then raise exception 'IS_PUBLISH_FIRST' using errcode = '55000'; end if;
  if p_institutions is null or cardinality(p_institutions) not between 1 and 200 then raise exception 'IS_SCHOOLS_INVALID' using errcode = '22023'; end if;
  foreach i in array p_institutions loop
    if not exists (select 1 from public.institutions x where x.id = i and x.verified_at is not null) then raise exception 'IS_SCHOOL_NOT_VERIFIED' using errcode = '55000'; end if;
    insert into quizbox_interschool.school_entries(competition_id, institution_id, status, source, invited_by, invited_at) values (c.id, i, 'INVITED', 'INVITE', auth.uid(), now())
    on conflict (competition_id, institution_id) do update set invited_by = excluded.invited_by, invited_at = excluded.invited_at,
      status = case when quizbox_interschool.school_entries.status in ('DECLINED', 'WITHDRAWN') then 'INVITED' else quizbox_interschool.school_entries.status end
      where quizbox_interschool.school_entries.invited_at is null or quizbox_interschool.school_entries.status in ('DECLINED', 'WITHDRAWN');
    get diagnostics changed = row_count;
    if changed > 0 then n := n + 1; perform quizbox_interschool.notify_school(i, 'Competition invitation', 'Your school is invited to ' || c.title || '.', '/interschool/school/' || c.id); end if;
  end loop;
  perform quizbox_interschool.audit('schools_invited', c.id, jsonb_build_object('count', n));
  return jsonb_build_object('ok', true, 'invited', n);
end $fn$;

-- A school accepts or declines (also how an open competition is joined, and how a school withdraws before its roster locks).
create or replace function public.interschool_school_respond(p_id uuid, p_institution uuid, p_accept boolean, p_source text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; e quizbox_interschool.school_entries; was text;
begin
  c := quizbox_interschool.open_competition(p_id);
  if not quizbox_interschool.staff_of(p_institution) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into e from quizbox_interschool.school_entries where competition_id = c.id and institution_id = p_institution;
  was := e.status;
  if p_accept then
    perform quizbox_interschool.require_registration_open(c);
    e := quizbox_interschool.enter_school(c, p_institution, p_source);
  else
    if e.id is null then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
    if e.status = 'REGISTERED' and quizbox_interschool.roster_locked(c.id, p_institution) then raise exception 'IS_ROSTER_LOCKED' using errcode = '55000'; end if;
    update quizbox_interschool.school_entries set status = case when was = 'INVITED' then 'DECLINED' else 'WITHDRAWN' end where id = e.id returning * into e;
    update quizbox_interschool.candidates set status = 'WITHDRAWN', status_reason = 'school withdrew', updated_at = now() where competition_id = c.id and institution_id = p_institution and status in ('PENDING', 'CONFIRMED', 'WAITLISTED');
    -- a waiting school takes the free place, oldest first
    update quizbox_interschool.school_entries set status = 'REGISTERED' where id = (select w.id from quizbox_interschool.school_entries w where w.competition_id = c.id and w.status = 'WAITLISTED' order by w.registered_at, w.id limit 1)
      and (c.max_schools is null or (select count(*) from quizbox_interschool.school_entries x where x.competition_id = c.id and x.status = 'REGISTERED') < c.max_schools);
    perform quizbox_interschool.promote_waiting(c);
  end if;
  perform quizbox_interschool.audit('school_' || lower(e.status), c.id, jsonb_build_object('institution', p_institution));
  return jsonb_build_object('ok', true, 'status', e.status);
end $fn$;

-- ───────────── candidates ─────────────
create or replace function public.interschool_register(p_slug text, p_division uuid, p_institution uuid default null, p_source text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; r jsonb;
begin
  perform quizbox_interschool.require_on();
  c := quizbox_interschool.open_competition((select id from quizbox_interschool.competitions where slug = lower(btrim(p_slug))));
  if c.registration_mode = 'TEACHER' then raise exception 'IS_TEACHER_REGISTRATION_ONLY' using errcode = '55000'; end if;
  perform quizbox_interschool.require_registration_open(c);
  r := quizbox_interschool.add_candidate(c, p_division, p_institution, auth.uid(), p_source, false);
  return r;
end $fn$;

create or replace function public.interschool_nominate(p_id uuid, p_institution uuid, p_division uuid, p_users uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; u uuid; r jsonb; out jsonb := '[]'::jsonb; msg text;
begin
  c := quizbox_interschool.open_competition(p_id);
  if not quizbox_interschool.staff_of(p_institution) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if c.registration_mode = 'LEARNER' then raise exception 'IS_LEARNER_REGISTRATION_ONLY' using errcode = '55000'; end if;
  perform quizbox_interschool.require_registration_open(c);
  if quizbox_interschool.roster_locked(c.id, p_institution) then raise exception 'IS_ROSTER_LOCKED' using errcode = '55000'; end if;
  if p_users is null or cardinality(p_users) not between 1 and 200 then raise exception 'IS_LEARNERS_INVALID' using errcode = '22023'; end if;
  foreach u in array p_users loop
    begin
      r := quizbox_interschool.add_candidate(c, p_division, p_institution, u, 'SCHOOL', true);
      out := out || jsonb_build_array(r || jsonb_build_object('user_id', u, 'ok', true));
    exception when others then
      get stacked diagnostics msg = message_text;
      if msg !~ '^IS_' then raise; end if;
      out := out || jsonb_build_array(jsonb_build_object('user_id', u, 'ok', false, 'error', msg));
    end;
  end loop;
  perform quizbox_interschool.audit('nominated', c.id, jsonb_build_object('institution', p_institution, 'results', out));
  return jsonb_build_object('results', out);
end $fn$;

create or replace function public.interschool_confirm_candidate(p_candidate uuid, p_approve boolean, p_reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k quizbox_interschool.candidates; c quizbox_interschool.competitions;
begin
  perform quizbox_interschool.require_on();
  select * into k from quizbox_interschool.candidates where id = p_candidate;
  if k.id is null then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  c := quizbox_interschool.open_competition(k.competition_id);
  select * into k from quizbox_interschool.candidates where id = p_candidate;
  if not (quizbox_interschool.staff_of(k.institution_id) or quizbox_interschool.is_admin()) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if k.status <> 'PENDING' then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if quizbox_interschool.roster_locked(c.id, k.institution_id) then raise exception 'IS_ROSTER_LOCKED' using errcode = '55000'; end if;
  update quizbox_interschool.candidates set status = case when p_approve then 'CONFIRMED' else 'REJECTED' end, confirmed_by = auth.uid(), confirmed_at = now(), status_reason = nullif(btrim(p_reason), ''), updated_at = now() where id = k.id;
  if not p_approve then perform quizbox_interschool.promote_waiting(c); end if;
  perform quizbox_interschool.notify(k.user_id, case when p_approve then 'Your place is confirmed' else 'Registration not confirmed' end, c.title || case when p_approve then ': your school confirmed your place.' else ': your school did not confirm this registration.' end, '/interschool');
  perform quizbox_interschool.audit(case when p_approve then 'candidate_confirmed' else 'candidate_rejected' end, c.id, jsonb_build_object('candidate', k.id));
  return jsonb_build_object('ok', true);
end $fn$;

create or replace function public.interschool_withdraw(p_candidate uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k quizbox_interschool.candidates; c quizbox_interschool.competitions;
begin
  perform quizbox_interschool.require_on();
  select * into k from quizbox_interschool.candidates where id = p_candidate;
  if k.id is null or not (k.user_id = auth.uid() or quizbox_interschool.staff_of(k.institution_id) or quizbox_interschool.is_admin()) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  c := quizbox_interschool.open_competition(k.competition_id);
  select * into k from quizbox_interschool.candidates where id = p_candidate;
  if k.status not in ('PENDING', 'CONFIRMED', 'WAITLISTED') then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if k.status <> 'WAITLISTED' and quizbox_interschool.roster_locked(c.id, k.institution_id) then raise exception 'IS_ROSTER_LOCKED' using errcode = '55000'; end if;
  update quizbox_interschool.candidates set status = 'WITHDRAWN', status_reason = nullif(btrim(p_reason), ''), updated_at = now() where id = k.id;
  perform quizbox_interschool.promote_waiting(c);
  perform quizbox_interschool.audit('candidate_withdrawn', c.id, jsonb_build_object('candidate', k.id));
  return jsonb_build_object('ok', true);
end $fn$;

-- Swaps one learner for another of the same school and level before the roster locks. The place passes straight across.
create or replace function public.interschool_replace(p_candidate uuid, p_new_user uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k quizbox_interschool.candidates; c quizbox_interschool.competitions; r jsonb;
begin
  perform quizbox_interschool.require_on();
  select * into k from quizbox_interschool.candidates where id = p_candidate;
  if k.id is null or not (quizbox_interschool.staff_of(k.institution_id) or quizbox_interschool.is_admin()) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  c := quizbox_interschool.open_competition(k.competition_id);
  select * into k from quizbox_interschool.candidates where id = p_candidate;
  if k.status not in ('PENDING', 'CONFIRMED') then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  if c.status not in ('PUBLISHED', 'PAUSED', 'CLOSED') or quizbox_interschool.roster_locked(c.id, k.institution_id) then raise exception 'IS_ROSTER_LOCKED' using errcode = '55000'; end if;
  update quizbox_interschool.candidates set status = 'WITHDRAWN', status_reason = coalesce(nullif(btrim(p_reason), ''), 'replaced'), updated_at = now() where id = k.id;
  r := quizbox_interschool.add_candidate(c, k.division_id, k.institution_id, p_new_user, 'SCHOOL', true, k.id);
  if r ->> 'status' <> 'CONFIRMED' then raise exception 'IS_REPLACEMENT_NOT_ELIGIBLE' using errcode = '55000'; end if;
  perform quizbox_interschool.audit('candidate_replaced', c.id, jsonb_build_object('old', k.id, 'new', r ->> 'candidate_id'));
  return r;
end $fn$;

create or replace function public.interschool_lock_roster(p_id uuid, p_institution uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.open_competition(p_id);
  if not (quizbox_interschool.staff_of(p_institution) or quizbox_interschool.can_manage(c)) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  update quizbox_interschool.school_entries set roster_locked_at = coalesce(roster_locked_at, now()) where competition_id = c.id and institution_id = p_institution and status = 'REGISTERED';
  if not found then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  perform quizbox_interschool.audit('roster_locked', c.id, jsonb_build_object('institution', p_institution));
  return jsonb_build_object('ok', true);
end $fn$;

-- ───────────── what each role sees ─────────────
-- A school's competitions: invitations, entries and open competitions it could join.
create or replace function public.interschool_school_home() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  return coalesce((select jsonb_agg(jsonb_build_object('institution_id', i.id, 'school', i.name,
    'competitions', coalesce((select jsonb_agg(row_to_json(t) order by t.registration_closes_at) from (
        select c.id, c.slug, c.title, c.status, c.participation, c.registration_closes_at, c.opens_at, e.status as entry_status, quizbox_interschool.registration_state(c) as registration,
               (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = i.id and k.status in ('PENDING', 'CONFIRMED')) as places_used, c.max_per_school
          from quizbox_interschool.competitions c left join quizbox_interschool.school_entries e on e.competition_id = c.id and e.institution_id = i.id
         where c.status in ('PUBLISHED', 'PAUSED', 'CLOSED', 'COMPLETED') and (e.id is not null or (c.participation = 'OPEN' and c.status = 'PUBLISHED' and c.registration_closes_at > now())) limit 100) t), '[]'::jsonb)) order by i.name)
    from public.institutions i where i.id in (select quizbox_interschool.my_schools())), '[]'::jsonb);
end $fn$;

-- One school's roster for one competition (that school's staff, or a platform administrator).
create or replace function public.interschool_school_roster(p_id uuid, p_institution uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; e quizbox_interschool.school_entries;
begin
  perform quizbox_interschool.require_on();
  if not (quizbox_interschool.staff_of(p_institution) or quizbox_interschool.is_admin()) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into c from quizbox_interschool.competitions where id = p_id and status not in ('DRAFT', 'PENDING_APPROVAL');
  select * into e from quizbox_interschool.school_entries where competition_id = c.id and institution_id = p_institution;
  if c.id is null or (e.id is null and c.participation <> 'OPEN') then raise exception 'IS_NOT_FOUND' using errcode = 'P0002'; end if;
  return jsonb_build_object('competition', jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status, 'rules', c.rules, 'registration', quizbox_interschool.registration_state(c),
      'registration_closes_at', c.registration_closes_at, 'registration_mode', c.registration_mode, 'max_per_school', c.max_per_school, 'max_per_level_per_school', c.max_per_level_per_school),
    'school', (select i.name from public.institutions i where i.id = p_institution), 'entry_status', e.status, 'locked', quizbox_interschool.roster_locked(c.id, p_institution),
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'level_codes', d.level_codes,
        'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'user_id', k.user_id, 'name', p.full_name, 'status', k.status, 'verified', quizbox_interschool.learner_verified(k.user_id, p_institution)) order by k.status, p.full_name)
           from quizbox_interschool.candidates k join public.profiles p on p.id = k.user_id where k.division_id = d.id and k.institution_id = p_institution and k.status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED')), '[]'::jsonb)) order by d.position)
      from quizbox_interschool.divisions d where d.competition_id = c.id), '[]'::jsonb));
end $fn$;

-- Learners of a school at a division's class level who are not yet registered, for nomination.
create or replace function public.interschool_school_learners(p_id uuid, p_institution uuid, p_division uuid, p_query text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare d quizbox_interschool.divisions;
begin
  perform quizbox_interschool.require_on();
  if not quizbox_interschool.staff_of(p_institution) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  select * into d from quizbox_interschool.divisions where id = p_division and competition_id = p_id;
  if d.id is null then raise exception 'IS_DIVISION_NOT_FOUND' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(x order by x.name) from (
    select p.id as user_id, p.full_name as name, quizbox_interschool.level_of(p.id) as level
      from public.profiles p join public.student_profiles s on s.user_id = p.id
     where lower(p.status::text) = 'active' and quizbox_interschool.level_of(p.id) = any(d.level_codes) and quizbox_interschool.school_learner(p.id, p_institution)
       and (s.managed_by is null or coalesce(quizbox_core.flag('interschool.allow_managed_learners'), false))
       and (nullif(btrim(p_query), '') is null or p.full_name ilike '%' || btrim(p_query) || '%')
       and not exists (select 1 from quizbox_interschool.candidates k where k.competition_id = p_id and k.user_id = p.id and k.status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED'))
     order by p.full_name limit 200) x), '[]'::jsonb);
end $fn$;

-- The organiser's registration monitor: numbers per school and level. Learner names are not included (each school sees its own).
create or replace function public.interschool_registrations(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id);
  return jsonb_build_object('registration', quizbox_interschool.registration_state(c), 'capacity', c.capacity, 'expected', c.expected_participants,
    'held', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.status in ('PENDING', 'CONFIRMED')),
    'waiting', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.status = 'WAITLISTED'),
    'schools', coalesce((select jsonb_agg(jsonb_build_object('institution_id', e.institution_id, 'school', i.name, 'region', i.region, 'status', e.status, 'source', e.source, 'locked', e.roster_locked_at is not null,
        'confirmed', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = e.institution_id and k.status = 'CONFIRMED'),
        'pending', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = e.institution_id and k.status = 'PENDING'),
        'waiting', (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.institution_id = e.institution_id and k.status = 'WAITLISTED')) order by i.name)
      from quizbox_interschool.school_entries e join public.institutions i on i.id = e.institution_id where e.competition_id = c.id), '[]'::jsonb),
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'capacity', d.capacity,
        'confirmed', (select count(*) from quizbox_interschool.candidates k where k.division_id = d.id and k.status = 'CONFIRMED'),
        'pending', (select count(*) from quizbox_interschool.candidates k where k.division_id = d.id and k.status = 'PENDING')) order by d.position) from quizbox_interschool.divisions d where d.competition_id = c.id), '[]'::jsonb),
    'sources', coalesce((select jsonb_object_agg(s.source, s.n) from (select k.source, count(*) n from quizbox_interschool.candidates k where k.competition_id = c.id and k.status in ('PENDING', 'CONFIRMED') group by k.source) s), '{}'::jsonb),
    'views', coalesce((select jsonb_object_agg(coalesce(v.source, 'DIRECT'), v.n) from (select source, count(*) n from quizbox_interschool.events where competition_id = c.id and kind = 'view' group by source) v), '{}'::jsonb));
end $fn$;

-- What a signed-in person can register for: their class level, the divisions that fit, the schools they belong to and any registration they already have.
create or replace function public.interschool_join_options(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions; lv text; learner boolean; managed boolean;
begin
  perform quizbox_interschool.require_on();
  select * into c from quizbox_interschool.competitions where slug = lower(btrim(p_slug)) and status not in ('DRAFT', 'PENDING_APPROVAL');
  if c.id is null then return null; end if;
  select true, s.managed_by is not null into learner, managed from public.student_profiles s where s.user_id = auth.uid();
  lv := quizbox_interschool.level_of(auth.uid());
  return jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'rules', c.rules, 'registration', quizbox_interschool.registration_state(c), 'registration_mode', c.registration_mode,
    'learner', coalesce(learner, false), 'managed', coalesce(managed, false), 'level', lv, 'individual_allowed', c.entry_mode = 'INDIVIDUAL' and c.participation = 'OPEN',
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title) order by d.position) from quizbox_interschool.divisions d where d.competition_id = c.id and lv = any(d.level_codes)), '[]'::jsonb),
    'schools', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'verified_member', quizbox_interschool.learner_verified(auth.uid(), i.id),
        'can_enter', c.participation = 'OPEN' or exists (select 1 from quizbox_interschool.school_entries e where e.competition_id = c.id and e.institution_id = i.id and e.status in ('INVITED', 'REGISTERED', 'WAITLISTED'))) order by i.name)
      from public.institutions i where i.verified_at is not null and quizbox_interschool.school_learner(auth.uid(), i.id)), '[]'::jsonb),
    'mine', (select jsonb_build_object('status', k.status, 'division', d.title) from quizbox_interschool.candidates k join quizbox_interschool.divisions d on d.id = k.division_id
              where k.competition_id = c.id and k.user_id = auth.uid() and k.status in ('PENDING', 'CONFIRMED', 'WAITLISTED', 'DISQUALIFIED') limit 1));
end $fn$;

-- The public page: what anyone may know. Never questions, never learner names.
create or replace function public.interschool_public_get(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  if not (coalesce(quizbox_core.flag('flags.interschool'), false) and coalesce(quizbox_core.flag('flags.interschool_public'), false)) then return null; end if;
  select * into c from quizbox_interschool.competitions where slug = lower(btrim(p_slug)) and status in ('PUBLISHED', 'PAUSED', 'CLOSED', 'COMPLETED', 'CANCELLED') and published_at is not null;
  if c.id is null then return null; end if;
  return jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'description', c.description, 'status', c.status, 'participation', c.participation, 'entry_mode', c.entry_mode,
    'registration_mode', c.registration_mode, 'scale', c.scale, 'region', c.region, 'district', c.district, 'sponsor_name', c.sponsor_name, 'sponsor_logo_url', c.sponsor_logo_url, 'flyer_url', c.flyer_url,
    'host', (select i.name from public.institutions i where i.id = c.host_institution_id), 'rules', c.rules, 'prizes', c.prizes, 'funding', c.funding, 'school_scoring', c.school_scoring,
    'registration', quizbox_interschool.registration_state(c), 'registration_opens_at', c.registration_opens_at, 'registration_closes_at', c.registration_closes_at, 'opens_at', c.opens_at, 'ends_at', c.ends_at,
    'schools_registered', (select count(*) from quizbox_interschool.school_entries e where e.competition_id = c.id and e.status = 'REGISTERED'), 'max_schools', c.max_schools,
    'places_left', greatest(c.capacity - (select count(*) from quizbox_interschool.candidates k where k.competition_id = c.id and k.status in ('PENDING', 'CONFIRMED')), 0), 'max_per_school', c.max_per_school,
    'divisions', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'level_codes', d.level_codes,
        'subjects', coalesce((select jsonb_agg(distinct n.title) from quizbox_interschool.rounds r cross join lateral jsonb_array_elements(r.sections) s join public.curriculum_nodes n on n.id = (s.value ->> 'subject_id')::uuid where r.division_id = d.id), '[]'::jsonb),
        'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_no', r.round_no, 'title', r.title, 'opens_at', r.opens_at, 'closes_at', r.closes_at, 'question_count', r.question_count,
            'duration_seconds', r.duration_seconds, 'rule', r.rule, 'pass_percent', r.pass_percent, 'top_n', r.top_n) order by r.round_no) from quizbox_interschool.rounds r where r.division_id = d.id), '[]'::jsonb)) order by d.position)
      from quizbox_interschool.divisions d where d.competition_id = c.id), '[]'::jsonb),
    'listed', c.listed_at is not null);
end $fn$;

-- Discovery: only competitions an administrator has listed (the home page, Open to join and the promotional feed use this).
create or replace function public.interschool_public_list(p_limit integer default 12) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select case when coalesce(quizbox_core.flag('flags.interschool'), false) and coalesce(quizbox_core.flag('flags.interschool_public'), false) then
    coalesce((select jsonb_agg(row_to_json(t)) from (
      select c.slug, c.title, left(c.description, 200) as summary, c.sponsor_name, c.sponsor_logo_url, c.registration_closes_at, c.opens_at, c.ends_at, quizbox_interschool.registration_state(c) as registration,
             (select jsonb_agg(d.title order by d.position) from quizbox_interschool.divisions d where d.competition_id = c.id) as divisions
        from quizbox_interschool.competitions c
       where c.listed_at is not null and c.participation = 'OPEN' and c.status in ('PUBLISHED', 'PAUSED') and (c.ends_at is null or c.ends_at > now())
       order by c.listed_at desc limit least(greatest(coalesce(p_limit, 12), 1), 48)) t), '[]'::jsonb)
  else '[]'::jsonb end
$fn$;

-- Listing on public discovery is approved by an administrator.
create or replace function public.interschool_set_listed(p_id uuid, p_listed boolean) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id, true);
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if p_listed and (c.participation <> 'OPEN' or c.status not in ('PUBLISHED', 'PAUSED')) then raise exception 'IS_ONLY_OPEN_PUBLISHED_CAN_BE_LISTED' using errcode = '55000'; end if;
  update quizbox_interschool.competitions set listed_at = case when p_listed then now() end, listed_by = case when p_listed then auth.uid() end, updated_at = now() where id = c.id;
  perform quizbox_interschool.audit(case when p_listed then 'listed' else 'unlisted' end, c.id);
  return jsonb_build_object('ok', true, 'listed', p_listed);
end $fn$;

-- Visits and shares are counted by the server (a visitor may not be signed in).
create or replace function public.interschool_track(p_slug text, p_kind text, p_source text default null) returns void language sql security definer set search_path = '' as $fn$
  insert into quizbox_interschool.events(competition_id, kind, source)
  select c.id, p_kind, quizbox_interschool.source_of(p_source) from quizbox_interschool.competitions c
   where c.slug = lower(btrim(p_slug)) and c.published_at is not null and p_kind in ('view', 'share')
$fn$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'quizbox_interschool' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.interschool_school_search(text, text), public.interschool_invite(uuid, uuid[]), public.interschool_school_respond(uuid, uuid, boolean, text), public.interschool_register(text, uuid, uuid, text),
  public.interschool_nominate(uuid, uuid, uuid, uuid[]), public.interschool_confirm_candidate(uuid, boolean, text), public.interschool_withdraw(uuid, text), public.interschool_replace(uuid, uuid, text),
  public.interschool_lock_roster(uuid, uuid), public.interschool_school_home(), public.interschool_school_roster(uuid, uuid), public.interschool_school_learners(uuid, uuid, uuid, text), public.interschool_registrations(uuid),
  public.interschool_public_get(text), public.interschool_public_list(integer), public.interschool_set_listed(uuid, boolean), public.interschool_track(text, text, text), public.interschool_join_options(text) from public, anon, authenticated;
grant execute on function public.interschool_school_search(text, text), public.interschool_invite(uuid, uuid[]), public.interschool_school_respond(uuid, uuid, boolean, text), public.interschool_register(text, uuid, uuid, text),
  public.interschool_nominate(uuid, uuid, uuid, uuid[]), public.interschool_confirm_candidate(uuid, boolean, text), public.interschool_withdraw(uuid, text), public.interschool_replace(uuid, uuid, text),
  public.interschool_lock_roster(uuid, uuid), public.interschool_school_home(), public.interschool_school_roster(uuid, uuid), public.interschool_school_learners(uuid, uuid, uuid, text), public.interschool_registrations(uuid),
  public.interschool_set_listed(uuid, boolean), public.interschool_join_options(text) to authenticated;
grant execute on function public.interschool_public_get(text), public.interschool_public_list(integer) to authenticated, service_role;
grant execute on function public.interschool_track(text, text, text) to service_role;

commit;
notify pgrst, 'reload schema';
