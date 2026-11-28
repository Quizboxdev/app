-- A score correction is for platform administrators only. The round is recomputed; once the next round has started, announced qualifications stay as they were.
create or replace function public.interschool_adjust_score(p_round uuid, p_candidate uuid, p_new_score numeric, p_reason text, p_dispute uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare x record; c quizbox_interschool.competitions; old record; started boolean;
begin
  perform quizbox_interschool.require_on();
  if not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  x := quizbox_interschool.round_ctx(p_round);
  select * into c from quizbox_interschool.competitions where id = x.competition_id for update;
  select * into old from quizbox_interschool.round_results where round_id = p_round and candidate_id = p_candidate;
  if (x.r).finalised_at is null or old.candidate_id is null then raise exception 'IS_ROUND_NOT_FINALISED' using errcode = '55000'; end if;
  if p_new_score is null or p_new_score < 0 or p_new_score > old.max_score then raise exception 'IS_SCORE_INVALID' using errcode = '22023'; end if;
  insert into quizbox_interschool.adjustments(round_id, candidate_id, old_score, new_score, reason, dispute_id, made_by) values (p_round, p_candidate, old.score, p_new_score, btrim(p_reason), p_dispute, auth.uid());
  started := exists (select 1 from quizbox_interschool.sittings s join quizbox_interschool.rounds y on y.id = s.round_id where y.division_id = (x.d).id and y.round_no > (x.r).round_no);
  perform quizbox_interschool.compute_round(p_round, started);
  -- totals carried into later finalised rounds follow the correction; their announced qualifiers stay
  perform quizbox_interschool.compute_round(y.id, true) from (select id from quizbox_interschool.rounds where division_id = (x.d).id and round_no > (x.r).round_no and finalised_at is not null order by round_no) y;
  perform quizbox_interschool.audit('score_adjusted', c.id, jsonb_build_object('round', p_round, 'candidate', p_candidate, 'old', old.score, 'new', p_new_score, 'reason', p_reason, 'qualifications_kept', started));
  return jsonb_build_object('ok', true, 'qualifications_kept', started);
end $fn$;

create or replace function public.interschool_disqualify(p_candidate uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k quizbox_interschool.candidates; c quizbox_interschool.competitions; r record;
begin
  select * into k from quizbox_interschool.candidates where id = p_candidate;
  c := quizbox_interschool.managed(k.competition_id, true);
  if c.organiser_kind = 'SPONSOR' and not quizbox_interschool.is_admin() then raise exception 'IS_NOT_AUTHORISED' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'IS_REASON_REQUIRED' using errcode = '22023'; end if;
  if k.status not in ('PENDING', 'CONFIRMED', 'WAITLISTED') then raise exception 'IS_INVALID_TRANSITION' using errcode = '55000'; end if;
  update quizbox_interschool.candidates set status = 'DISQUALIFIED', status_reason = btrim(p_reason), updated_at = now() where id = k.id;
  -- finalised rounds are recomputed without this learner; announced qualifications of others are kept
  for r in select id from quizbox_interschool.rounds where division_id = k.division_id and finalised_at is not null order by round_no loop perform quizbox_interschool.compute_round(r.id, true); end loop;
  perform quizbox_interschool.notify(k.user_id, 'Disqualified', c.title || ': ' || btrim(p_reason), '/interschool');
  perform quizbox_interschool.audit('disqualified', c.id, jsonb_build_object('candidate', k.id, 'reason', p_reason));
  return jsonb_build_object('ok', true);
end $fn$;

-- ───────────── views ─────────────
create or replace function quizbox_interschool.school_table(p_round uuid) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('institution_id', s.institution_id, 'school', i.name, 'rank', s.rank, 'score', s.score, 'total_score', s.total_score, 'present', s.present, 'entered', s.entered, 'eligible', s.eligible, 'qualified', s.qualified) order by s.rank nulls last, i.name), '[]'::jsonb)
    from quizbox_interschool.school_results s join public.institutions i on i.id = s.institution_id where s.round_id = p_round
$fn$;

-- A learner's own competitions: every round with what they can do now; scores appear only after a round is finalised.
create or replace function public.interschool_mine() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_interschool.require_on();
  return coalesce((select jsonb_agg(jsonb_build_object('candidate_id', k.id, 'status', k.status, 'status_reason', k.status_reason, 'competition', jsonb_build_object('id', c.id, 'slug', c.slug, 'title', c.title, 'status', c.status),
      'division', d.title, 'school', (select i.name from public.institutions i where i.id = k.institution_id), 'can_withdraw', k.status in ('PENDING', 'WAITLISTED') or (k.status = 'CONFIRMED' and not quizbox_interschool.roster_locked(c.id, k.institution_id)),
      'rounds', coalesce((select jsonb_agg(jsonb_build_object('round_id', r.id, 'round_no', r.round_no, 'title', r.title, 'question_count', r.question_count, 'duration_seconds', coalesce(st.seconds, r.duration_seconds), 'opens_at', st.opens, 'closes_at', st.closes,
            'state', case when s.submitted_at is not null or (s.id is not null and s.expires_at <= now()) then 'TAKEN' when s.id is not null and st.state = 'OPEN' then 'IN_PROGRESS' else st.state end,
            'opponent', (select i.name from quizbox_interschool.fixtures f join public.institutions i on i.id = case when f.home_institution = k.institution_id then f.away_institution else f.home_institution end where f.id = st.fixture),
            'result', case when r.finalised_at is not null then (select jsonb_build_object('score', y.score, 'max_score', y.max_score, 'percent', y.percent, 'rank', y.rank, 'qualified', y.qualified, 'absent', y.absent) from quizbox_interschool.round_results y where y.round_id = r.id and y.candidate_id = k.id) end) order by r.round_no)
          from quizbox_interschool.rounds r cross join lateral quizbox_interschool.sit_state(k, r.id) st left join quizbox_interschool.sittings s on s.round_id = r.id and s.candidate_id = k.id where r.division_id = k.division_id), '[]'::jsonb)) order by k.created_at desc)
    from quizbox_interschool.candidates k join quizbox_interschool.competitions c on c.id = k.competition_id join quizbox_interschool.divisions d on d.id = k.division_id
   where k.user_id = auth.uid() and k.status <> 'WITHDRAWN' and c.status not in ('DRAFT', 'PENDING_APPROVAL')), '[]'::jsonb);
end $fn$;
