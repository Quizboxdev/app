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
