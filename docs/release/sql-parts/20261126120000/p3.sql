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
