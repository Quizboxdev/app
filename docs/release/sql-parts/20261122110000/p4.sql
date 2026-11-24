create or replace function public.qb_mock_result_rows(p_exam uuid, p_version uuid default null, p_class uuid default null, p_student uuid default null, p_question uuid default null, p_state text default null,
  p_limit integer default 200, p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); v_id uuid := coalesce(p_version, e.current_version_id); v_cap integer := quizbox_mock.num('mock_exams.export_row_limit', 50000)::integer;
begin
  if p_state is not null and p_state not in ('submitted', 'in_progress', 'expired') then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  if v_id is null or not exists (select 1 from public.mock_exam_versions where id = v_id and exam_id = e.id) then return jsonb_build_object('total', 0, 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('total', (select count(*) from quizbox_mock.result_rows(e.id, v_id, p_class, p_student, p_question, p_state)),
    'rows', coalesce((select jsonb_agg(x.r) from (select r from quizbox_mock.result_rows(e.id, v_id, p_class, p_student, p_question, p_state) limit least(greatest(coalesce(p_limit, 200), 1), v_cap) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end $fn$;

-- The export dataset in the shape the admin export route already formats (columns, rows, total, truncated). Times are UTC "YYYY-MM-DD HH24:MI:SS" so Excel gets real dates. Audited.
create or replace function public.qb_mock_export(p_exam uuid, p_version uuid default null, p_class uuid default null, p_student uuid default null, p_question uuid default null, p_state text default null,
  p_limit integer default 50000) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); v public.mock_exam_versions; v_cap integer := quizbox_mock.num('mock_exams.export_row_limit', 50000)::integer; v_limit integer; v_total integer; v_rows jsonb;
  ts text := 'YYYY-MM-DD HH24:MI:SS';
begin
  if p_state is not null and p_state not in ('submitted', 'in_progress', 'expired') then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  select * into v from public.mock_exam_versions where id = coalesce(p_version, e.current_version_id) and exam_id = e.id;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  v_limit := least(greatest(coalesce(p_limit, v_cap), 1), v_cap);
  select count(*) into v_total from quizbox_mock.result_rows(e.id, v.id, p_class, p_student, p_question, p_state);
  select coalesce(jsonb_agg(jsonb_build_array(e.title, v.version_no, e.purpose, v.target_grade, x.r ->> 'group', x.r ->> 'participant', (x.r ->> 'attempt_no')::integer, x.r ->> 'state',
      to_char((x.r ->> 'started_at')::timestamptz at time zone 'UTC', ts), to_char((x.r ->> 'submitted_at')::timestamptz at time zone 'UTC', ts), (x.r ->> 'attempt_score')::numeric, (x.r ->> 'attempt_total')::numeric,
      (x.r ->> 'attempt_percent')::numeric, (x.r ->> 'position')::integer, coalesce(x.r ->> 'external_id', x.r ->> 'question_id'), x.r ->> 'subject_code', x.r ->> 'grade_code', x.r ->> 'question_text',
      x.r ->> 'answer', x.r ->> 'correct_answer', case when x.r -> 'is_correct' = 'null'::jsonb then null else (x.r ->> 'is_correct')::boolean end, (x.r ->> 'marks_awarded')::numeric, (x.r ->> 'marks')::numeric)), '[]'::jsonb)
    into v_rows from (select r from quizbox_mock.result_rows(e.id, v.id, p_class, p_student, p_question, p_state) limit v_limit) x;
  perform quizbox_core.audit('mock_exam.export', 'mock_exams', e.id, jsonb_build_object('version', v.version_no, 'rows', least(v_total, v_limit), 'total', v_total));
  return jsonb_build_object('dataset', 'mock_exam_results', 'label', 'Mock exam results: ' || e.title || ' (version ' || v.version_no || ')',
    'columns', jsonb_build_array('Exam', 'Version', 'Purpose', 'Target level', 'Group', 'Participant', 'Attempt', 'Attempt state', 'Started (UTC)', 'Submitted (UTC)', 'Attempt score', 'Attempt total marks', 'Attempt percent',
      'Question no.', 'Question ID', 'Subject', 'Level', 'Question text', 'Student answer', 'Correct answer', 'Correct', 'Marks awarded', 'Marks available'),
    'rows', v_rows, 'total', v_total, 'truncated', v_total > v_limit);
end $fn$;

revoke all on function public.qb_mock_exam_health(uuid), public.qb_mock_class_options(), public.qb_mock_assign_class(uuid, uuid, timestamptz, timestamptz, uuid[]), public.qb_mock_exam_assignments(uuid),
  public.qb_mock_results(uuid, uuid), public.qb_mock_result_rows(uuid, uuid, uuid, uuid, uuid, text, integer, integer), public.qb_mock_export(uuid, uuid, uuid, uuid, uuid, text, integer) from public, anon;
grant execute on function public.qb_mock_exam_health(uuid), public.qb_mock_class_options(), public.qb_mock_assign_class(uuid, uuid, timestamptz, timestamptz, uuid[]), public.qb_mock_exam_assignments(uuid),
  public.qb_mock_results(uuid, uuid), public.qb_mock_result_rows(uuid, uuid, uuid, uuid, uuid, text, integer, integer), public.qb_mock_export(uuid, uuid, uuid, uuid, uuid, text, integer) to authenticated, service_role;
