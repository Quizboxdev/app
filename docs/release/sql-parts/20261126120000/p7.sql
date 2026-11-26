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
