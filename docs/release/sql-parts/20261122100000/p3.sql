create or replace function quizbox_mock.totals(e public.mock_exams) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('desired', e.desired_total, 'allocated', coalesce((select sum(requested) from public.mock_exam_rounds where exam_id = e.id), 0)::integer,
    'selected', (select count(*) from public.mock_exam_questions where exam_id = e.id)::integer,
    'remaining_to_allocate', e.desired_total - coalesce((select sum(requested) from public.mock_exam_rounds where exam_id = e.id), 0)::integer,
    'remaining_to_select', coalesce((select sum(requested) from public.mock_exam_rounds where exam_id = e.id), 0)::integer - (select count(*) from public.mock_exam_questions where exam_id = e.id)::integer)
$fn$;

create or replace function quizbox_mock.exam_json(e public.mock_exams) returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('id', e.id, 'title', e.title, 'description', e.description, 'purpose', e.purpose, 'audience', e.audience, 'curriculum_id', e.curriculum_id, 'target_grade', e.target_grade,
    'desired_total', e.desired_total, 'time_limit_minutes', e.time_limit_minutes, 'attempts_allowed', e.attempts_allowed, 'shuffle_questions', e.shuffle_questions, 'instructions', e.instructions,
    'status', e.status, 'dirty', e.dirty, 'owner_kind', e.owner_kind, 'version_count', e.version_count, 'current_version_id', e.current_version_id,
    'current_version_no', (select v.version_no from public.mock_exam_versions v where v.id = e.current_version_id), 'created_at', e.created_at, 'updated_at', e.updated_at,
    'rounds', quizbox_mock.rounds_json(e), 'totals', quizbox_mock.totals(e))
$fn$;

-- Is the exam ready to publish? Codes only; the screen words them.
create or replace function quizbox_mock.readiness(e public.mock_exams) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare issues jsonb := '[]'; t jsonb := quizbox_mock.totals(e); r record; bad integer; dup integer;
begin
  if e.desired_total < quizbox_mock.num('mock_exams.min_questions', 5) then issues := issues || jsonb_build_object('code', 'TOO_FEW_QUESTIONS', 'count', e.desired_total); end if;
  if not exists (select 1 from public.mock_exam_rounds where exam_id = e.id) then issues := issues || jsonb_build_object('code', 'NO_ROUNDS'); end if;
  if (t ->> 'allocated')::integer <> e.desired_total then issues := issues || jsonb_build_object('code', 'NOT_FULLY_ALLOCATED', 'count', e.desired_total - (t ->> 'allocated')::integer); end if;
  for r in select rr.position, rr.requested, (select count(*) from public.mock_exam_questions q where q.round_id = rr.id)::integer as n from public.mock_exam_rounds rr where rr.exam_id = e.id order by rr.position loop
    if r.n <> r.requested then issues := issues || jsonb_build_object('code', 'ROUND_NOT_FILLED', 'round', r.position, 'count', r.requested - r.n); end if;
  end loop;
  select count(*) into bad from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = e.id and not public.qb_question_is_available(q);
  if bad > 0 then issues := issues || jsonb_build_object('code', 'QUESTION_UNAVAILABLE', 'count', bad); end if;
  select count(*) - count(distinct quizbox_mock.dup_key(q)) into dup from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = e.id;
  if dup > 0 then issues := issues || jsonb_build_object('code', 'DUPLICATE_QUESTIONS', 'count', dup); end if;
  return jsonb_build_object('ready', jsonb_array_length(issues) = 0, 'issues', issues, 'totals', t);
end $fn$;

revoke all on function quizbox_mock.freeze(), quizbox_mock.num(text, numeric), quizbox_mock.canon(text), quizbox_mock.grade_rank(text), quizbox_mock.stage(text), quizbox_mock.eligible(text, text),
  quizbox_mock.author_kind(), quizbox_mock.curriculum_ok(uuid), quizbox_mock.own_exam(uuid, boolean), quizbox_mock.dup_key(public.questions), quizbox_mock.taken(uuid), quizbox_mock.subject_label(uuid, text, text),
  quizbox_mock.rounds_json(public.mock_exams), quizbox_mock.totals(public.mock_exams), quizbox_mock.exam_json(public.mock_exams), quizbox_mock.readiness(public.mock_exams) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Author: status, curricula and the level/subject/topic menu
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_enabled() returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce(quizbox_core.flag('flags.mock_exams'), false)
$fn$;

create or replace function public.qb_mock_author_status() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare k text;
begin
  begin
    k := quizbox_mock.author_kind();
    return jsonb_build_object('enabled', true, 'can_author', true, 'kind', k, 'reason', null);
  exception when others then
    return jsonb_build_object('enabled', coalesce(quizbox_core.flag('flags.mock_exams'), false), 'can_author', false, 'kind', null, 'reason', case when SQLERRM ~ '^QB_[A-Z_]+$' then SQLERRM else 'QB_MOCK_AUTHOR_FORBIDDEN' end);
  end;
end $fn$;

create or replace function public.qb_mock_curricula() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare m uuid;
begin
  perform quizbox_mock.author_kind();
  select default_market_id into m from public.profiles where id = auth.uid();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'version', c.version) order by c.name, c.version)
    from public.curricula c join public.market_curricula mc on mc.curriculum_id = c.id and mc.active where c.status = 'ACTIVE' and (m is null or mc.market_id = m)), '[]'::jsonb);
end $fn$;

-- The levels a target year may draw from, oldest first, and nothing else.
create or replace function public.qb_mock_grades(p_target text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_mock.author_kind();
  return coalesce((select jsonb_agg(g order by quizbox_mock.grade_rank(g)) from unnest(array['B1','B2','B3','B4','B5','B6','B7','B8','B9','SHS1','SHS2','SHS3']) g where quizbox_mock.eligible(p_target, g)), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mock_subjects(p_curriculum uuid, p_grade text) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_mock.author_kind();
  if quizbox_mock.grade_rank(p_grade) is null then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('subject_code', s.subject_code, 'label', quizbox_mock.subject_label(p_curriculum, p_grade, s.subject_code), 'topics', s.n) order by quizbox_mock.subject_label(p_curriculum, p_grade, s.subject_code))
    from (select n.subject_code, count(*)::integer as n from public.curriculum_topics t join public.curriculum_nodes n on n.id = t.indicator_node_id
           where t.curriculum_id = p_curriculum and t.status = 'ACTIVE' and quizbox_mock.canon(coalesce(n.canonical_grade_code, n.grade_code)) = quizbox_mock.canon(p_grade) and n.subject_code is not null
           group by n.subject_code) s), '[]'::jsonb);
end $fn$;
