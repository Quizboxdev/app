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
