-- Results of one finalised round, according to who is asking: organisers and administrators see everything; a school sees the school table and its own learners.
create or replace function public.interschool_results(p_round uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare x record; c quizbox_interschool.competitions; manager boolean; admin boolean; mine uuid[]; all_learners boolean;
begin
  perform quizbox_interschool.require_on();
  x := quizbox_interschool.round_ctx(p_round);
  select * into c from quizbox_interschool.competitions where id = x.competition_id;
  manager := c.id is not null and quizbox_interschool.can_manage(c); admin := quizbox_interschool.is_admin();
  select coalesce(array_agg(s), '{}') into mine from quizbox_interschool.my_schools() s;
  -- a sponsor who organises sees school results and figures, never a list of learners
  all_learners := admin or (coalesce(manager, false) and c.organiser_kind <> 'SPONSOR');
  if c.id is null or not (manager or exists (select 1 from quizbox_interschool.school_entries e where e.competition_id = c.id and e.institution_id = any(mine))
      or exists (select 1 from quizbox_interschool.candidates k where k.competition_id = c.id and k.user_id = auth.uid() and k.status = 'CONFIRMED')) then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if (x.r).finalised_at is null then return jsonb_build_object('finalised', false); end if;
  return jsonb_build_object('finalised', true, 'competition', c.title, 'division', (x.d).title, 'round', (x.r).title, 'rule', (x.r).rule, 'schools', quizbox_interschool.school_table(p_round),
    'learners', coalesce((select jsonb_agg(jsonb_build_object('candidate_id', y.candidate_id, 'name', case when admin or k.institution_id = any(mine) then p.full_name else quizbox_interschool.short_name(p.id) end,
          'school', i.name, 'score', y.score, 'max_score', y.max_score, 'percent', y.percent, 'total_score', y.total_score, 'rank', y.rank, 'qualified', y.qualified, 'absent', y.absent, 'seconds', round(y.duration_ms / 1000.0)) order by y.rank nulls last, p.full_name)
        from quizbox_interschool.round_results y join quizbox_interschool.candidates k on k.id = y.candidate_id join public.profiles p on p.id = k.user_id left join public.institutions i on i.id = y.institution_id
       where y.round_id = p_round and (all_learners or k.institution_id = any(mine) or k.user_id = auth.uid())), '[]'::jsonb),
    'fixtures', coalesce((select jsonb_agg(jsonb_build_object('home', h.name, 'away', a.name, 'home_score', f.home_score, 'away_score', f.away_score, 'winner', w.name, 'note', f.note, 'status', f.status) order by f.match_no)
        from quizbox_interschool.fixtures f join public.institutions h on h.id = f.home_institution left join public.institutions a on a.id = f.away_institution left join public.institutions w on w.id = f.winner_institution where f.round_id = p_round), '[]'::jsonb));
end $fn$;

-- The public scoreboard: school tables and the leading learners by short name, one per finalised round of each division.
create or replace function public.interschool_public_results(p_slug text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  if not (coalesce(quizbox_core.flag('flags.interschool'), false) and coalesce(quizbox_core.flag('flags.interschool_public'), false)) then return '[]'::jsonb; end if;
  select * into c from quizbox_interschool.competitions where slug = lower(btrim(p_slug)) and published_at is not null and status <> 'CANCELLED';
  return coalesce((select jsonb_agg(jsonb_build_object('division', d.title, 'round_no', r.round_no, 'round', r.title, 'schools', quizbox_interschool.school_table(r.id),
      'leaders', coalesce((select jsonb_agg(jsonb_build_object('rank', z.rank, 'name', z.name, 'school', z.school, 'percent', z.percent) order by z.rank) from (
          select y.rank, quizbox_interschool.short_name(k.user_id) as name, i.name as school, y.percent from quizbox_interschool.round_results y join quizbox_interschool.candidates k on k.id = y.candidate_id
            left join public.institutions i on i.id = y.institution_id
           where y.round_id = r.id and y.rank <= 10 and not exists (select 1 from public.student_profiles s where s.user_id = k.user_id and s.managed_by is not null) order by y.rank limit 10) z), '[]'::jsonb)) order by d.position, r.round_no desc)
    from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id = r.division_id where d.competition_id = c.id and r.finalised_at is not null), '[]'::jsonb);
end $fn$;

-- Fixtures, disputes and round state for the organiser's screen.
create or replace function public.interschool_operations(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c quizbox_interschool.competitions;
begin
  c := quizbox_interschool.managed(p_id);
  return jsonb_build_object(
    'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_id', r.id, 'division_id', d.id, 'division', d.title, 'round_no', r.round_no, 'title', r.title, 'format', r.format, 'rule', r.rule, 'opens_at', r.opens_at, 'closes_at', r.closes_at,
        'finalised_at', r.finalised_at, 'started', (select count(*) from quizbox_interschool.sittings s where s.round_id = r.id), 'submitted', (select count(*) from quizbox_interschool.sittings s where s.round_id = r.id and s.submitted_at is not null),
        'fixtures', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'home', h.name, 'away', a.name, 'scheduled_at', f.scheduled_at, 'closes_at', f.closes_at, 'status', f.status, 'group_no', f.group_no, 'winner', w.name, 'home_score', f.home_score, 'away_score', f.away_score, 'note', f.note) order by f.match_no)
            from quizbox_interschool.fixtures f join public.institutions h on h.id = f.home_institution left join public.institutions a on a.id = f.away_institution left join public.institutions w on w.id = f.winner_institution where f.round_id = r.id), '[]'::jsonb)) order by d.position, r.round_no)
      from quizbox_interschool.rounds r join quizbox_interschool.divisions d on d.id = r.division_id where d.competition_id = c.id), '[]'::jsonb),
    'disputes', case when c.organiser_kind = 'SPONSOR' and not quizbox_interschool.is_admin() then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'round_id', q.round_id, 'candidate_id', q.candidate_id, 'school', i.name, 'reason', q.reason, 'status', q.status, 'resolution', q.resolution, 'created_at', q.created_at) order by q.status, q.created_at desc)
      from quizbox_interschool.disputes q left join public.institutions i on i.id = q.institution_id where q.competition_id = c.id), '[]'::jsonb) end);
end $fn$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'quizbox_interschool' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.interschool_generate_fixtures(uuid, text, integer), public.interschool_add_fixture(uuid, uuid, uuid, timestamptz, timestamptz, jsonb, integer), public.interschool_change_fixture(uuid, timestamptz, timestamptz, boolean, text),
  public.interschool_start(uuid), public.interschool_save(uuid, jsonb), public.interschool_submit(uuid, jsonb), public.interschool_finalise_round(uuid, boolean), public.interschool_qualify(uuid, uuid[], boolean, text), public.interschool_announce_round(uuid),
  public.interschool_raise_dispute(uuid, text, uuid), public.interschool_resolve_dispute(uuid, boolean, text), public.interschool_adjust_score(uuid, uuid, numeric, text, uuid), public.interschool_disqualify(uuid, text),
  public.interschool_mine(), public.interschool_results(uuid), public.interschool_public_results(text), public.interschool_operations(uuid) from public, anon, authenticated;
