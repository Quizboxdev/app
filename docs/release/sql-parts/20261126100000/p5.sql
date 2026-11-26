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
