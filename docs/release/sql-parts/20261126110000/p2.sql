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
