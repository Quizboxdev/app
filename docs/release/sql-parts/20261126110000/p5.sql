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
