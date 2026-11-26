create or replace function quizbox_interschool.make_fixture(p_round uuid, p_home uuid, p_away uuid, p_from timestamptz, p_to timestamptz, p_group integer, p_match integer, p_sections jsonb default null, p_duration integer default null)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare x record; f uuid; schools uuid[]; c quizbox_interschool.competitions;
begin
  x := quizbox_interschool.round_ctx(p_round);
  select * into c from quizbox_interschool.competitions where id = x.competition_id;
  if (x.r).format = 'FIELD' then raise exception 'IS_ROUND_HAS_NO_FIXTURES' using errcode = '55000'; end if;
  if (x.r).finalised_at is not null then raise exception 'IS_ROUND_FINALISED' using errcode = '55000'; end if;
  if p_from < (x.r).opens_at or p_to > (x.r).closes_at or p_to <= p_from then raise exception 'IS_FIXTURE_OUTSIDE_ROUND' using errcode = '22023'; end if;
  if p_home is null or p_home = p_away then raise exception 'IS_FIXTURE_SCHOOLS_INVALID' using errcode = '22023'; end if;
  schools := array_remove(array[p_home, p_away], null);
  if exists (select 1 from unnest(schools) s where not exists (select 1 from quizbox_interschool.school_entries e where e.competition_id = c.id and e.institution_id = s and e.status = 'REGISTERED')) then
    raise exception 'IS_SCHOOL_NOT_REGISTERED' using errcode = '55000'; end if;
  if quizbox_interschool.fixture_clash(p_round, null, schools, p_from, p_to) is not null then raise exception 'IS_FIXTURE_CLASH' using errcode = '55000'; end if;
  insert into quizbox_interschool.fixtures(round_id, group_no, match_no, home_institution, away_institution, scheduled_at, closes_at, duration_seconds, sections, status, winner_institution, note)
  values (p_round, p_group, p_match, p_home, p_away, p_from, p_to, p_duration, p_sections, 'SCHEDULED', null, case when p_away is null then 'bye' end) returning id into f;
  if p_sections is not null then
    perform quizbox_interschool.section_report((x.d).level_codes, p_sections);
    perform quizbox_interschool.freeze_paper(p_round, f, (x.d).level_codes, p_sections);
  end if;
  if p_away is null then
    perform quizbox_interschool.notify_school(p_home, 'Bye this round', c.title || ': your school has a bye in ' || (x.r).title || '.', '/interschool/school/' || c.id);
  else
    perform quizbox_interschool.notify_school(p_home, 'Fixture scheduled', c.title || ' (' || (x.d).title || '): ' || (x.r).title || ' fixture on ' || to_char(p_from at time zone 'UTC', 'DD Mon HH24:MI') || ' GMT.', '/interschool/school/' || c.id);
    perform quizbox_interschool.notify_school(p_away, 'Fixture scheduled', c.title || ' (' || (x.d).title || '): ' || (x.r).title || ' fixture on ' || to_char(p_from at time zone 'UTC', 'DD Mon HH24:MI') || ' GMT.', '/interschool/school/' || c.id);
  end if;
  return f;
end $fn$;

-- Pairs schools for a knockout round. With an uneven number the first schools in the seeded order receive byes, so the next round has a power of two.
create or replace function quizbox_interschool.knockout_pairs(p_round uuid, p_schools uuid[]) returns integer language plpgsql security definer set search_path = '' as $fn$
declare r quizbox_interschool.rounds; n integer := coalesce(cardinality(p_schools), 0); size integer := 1; byes integer; j integer; m integer := 0;
begin
  select * into r from quizbox_interschool.rounds where id = p_round;
  if n < 2 then return 0; end if;
  while size < n loop size := size * 2; end loop;
  byes := size - n;
  for j in 1..byes loop m := m + 1; perform quizbox_interschool.make_fixture(p_round, p_schools[j], null, r.opens_at, r.closes_at, null, m); end loop;
  -- the rest (always an even number): first against last
  for j in 1..(n - byes) / 2 loop m := m + 1; perform quizbox_interschool.make_fixture(p_round, p_schools[byes + j], p_schools[n + 1 - j], r.opens_at, r.closes_at, null, m); end loop;
  return m;
end $fn$;

create or replace function public.interschool_generate_fixtures(p_division uuid, p_method text, p_groups integer default 1) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare d quizbox_interschool.divisions; c quizbox_interschool.competitions; method text := upper(coalesce(p_method, '')); schools uuid[]; round_ids uuid[]; n integer; made integer := 0;
  g integer; grp uuid[]; size integer; day integer; i integer; a uuid; b uuid; r quizbox_interschool.rounds; ring uuid[]; need integer;
begin
  select * into d from quizbox_interschool.divisions where id = p_division;
  c := quizbox_interschool.managed(d.competition_id, true);
  if c.status not in ('PUBLISHED', 'PAUSED', 'CLOSED') then raise exception 'IS_PUBLISH_FIRST' using errcode = '55000'; end if;
  if method not in ('ROUND_ROBIN', 'GROUP', 'KNOCKOUT') then raise exception 'IS_METHOD_INVALID' using errcode = '22023'; end if;
  select array_agg(x.id order by x.round_no) into round_ids from quizbox_interschool.rounds x where x.division_id = d.id and x.format = method and x.finalised_at is null;
  if round_ids is null then raise exception 'IS_NO_ROUND_FOR_METHOD' using errcode = '55000'; end if;
  -- a stable draw for this division (repeatable, not alphabetical)
  select array_agg(s order by md5(s::text || d.id::text)) into schools from quizbox_interschool.playing_schools(d.id) s;
  n := coalesce(cardinality(schools), 0);
  if n < 2 then raise exception 'IS_NOT_ENOUGH_SCHOOLS' using errcode = '55000'; end if;
  if method = 'KNOCKOUT' then round_ids := round_ids[1:1]; end if;
  if exists (select 1 from quizbox_interschool.sittings s where s.round_id = any(round_ids)) then raise exception 'IS_ROUND_ALREADY_STARTED' using errcode = '55000'; end if;
  delete from quizbox_interschool.papers where fixture_id in (select id from quizbox_interschool.fixtures where round_id = any(round_ids));
  delete from quizbox_interschool.fixtures where round_id = any(round_ids);
  if method = 'KNOCKOUT' then
    -- after an earlier round, only the schools that qualified from it are drawn
    select * into r from quizbox_interschool.rounds where id = round_ids[1];
    if r.round_no > 1 then
      select array_agg(s.institution_id order by s.rank, s.institution_id) into schools from quizbox_interschool.school_results s join quizbox_interschool.rounds p on p.id = s.round_id
       where p.division_id = d.id and p.round_no = r.round_no - 1 and p.finalised_at is not null and s.qualified;
      if coalesce(cardinality(schools), 0) < 2 then raise exception 'IS_PREVIOUS_ROUND_NOT_FINALISED' using errcode = '55000'; end if;
    end if;
    made := quizbox_interschool.knockout_pairs(round_ids[1], schools);
  else
    size := case when method = 'GROUP' then greatest(coalesce(p_groups, 1), 1) else 1 end;
    if n / size < 2 then raise exception 'IS_TOO_MANY_GROUPS' using errcode = '22023'; end if;
    need := (ceil(n::numeric / size))::integer; need := case when need % 2 = 0 then need - 1 else need end;
    if cardinality(round_ids) < need then raise exception 'IS_NOT_ENOUGH_ROUNDS' using errcode = '55000', detail = need::text; end if;
    for g in 1..size loop
      select array_agg(schools[x] order by x) into grp from generate_series(g, n, size) x;
      ring := grp; if cardinality(ring) % 2 = 1 then ring := ring || array[null::uuid]; end if;
      for day in 1..cardinality(ring) - 1 loop
        select * into r from quizbox_interschool.rounds where id = round_ids[day];
        for i in 1..cardinality(ring) / 2 loop
          a := ring[i]; b := ring[cardinality(ring) - i + 1];
          if a is null then a := b; b := null; end if;
          made := made + 1;
          perform quizbox_interschool.make_fixture(r.id, a, b, r.opens_at, r.closes_at, case when method = 'GROUP' then g end, made);
        end loop;
        -- circle method: the first school stays, the rest rotate one place
        ring := array[ring[1]] || array[ring[cardinality(ring)]] || ring[2:cardinality(ring) - 1];
      end loop;
    end loop;
  end if;
  perform quizbox_interschool.audit('fixtures_generated', c.id, jsonb_build_object('division', d.id, 'method', method, 'fixtures', made));
  return jsonb_build_object('ok', true, 'fixtures', made);
end $fn$;
