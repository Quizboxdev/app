-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Review and publish
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_exam_review(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam);
begin
  return jsonb_build_object('exam', quizbox_mock.exam_json(e), 'readiness', quizbox_mock.readiness(e),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('position', x.pos, 'round', x.rpos, 'question_id', x.id, 'question_text', x.question_text, 'answer_type', x.at, 'marks', x.marks, 'grade_code', x.grade_code,
        'subject_code', x.subject_code, 'topic_title', x.title, 'picked_by', x.picked_by, 'available', x.ok) order by x.pos)
      from (select row_number() over (order by r.position, s.seq)::integer as pos, r.position as rpos, q.id, q.question_text, coalesce(q.answer_type, 'SINGLE_CHOICE') as at, q.marks, r.grade_code, r.subject_code, t.title, s.picked_by,
                   public.qb_question_is_available(q) as ok
              from public.mock_exam_questions s join public.mock_exam_rounds r on r.id = s.round_id join public.questions q on q.id = s.question_id join public.curriculum_topics t on t.id = r.topic_id where s.exam_id = e.id) x), '[]'::jsonb),
    'scoring', jsonb_build_object('total_marks', coalesce((select sum(q.marks) from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = e.id), 0),
      'answer_types', coalesce((select jsonb_object_agg(a.at, a.n) from (select coalesce(q.answer_type, 'SINGLE_CHOICE') as at, count(*)::integer as n from public.mock_exam_questions s join public.questions q on q.id = s.question_id where s.exam_id = e.id group by 1) a), '{}'::jsonb),
      'time_limit_minutes', e.time_limit_minutes, 'attempts_allowed', e.attempts_allowed, 'shuffle_questions', e.shuffle_questions));
end $fn$;

create or replace function public.qb_mock_exam_publish(p_exam uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); rd jsonb; v public.mock_exam_versions; v_no integer; v_marks numeric; v_n integer; v_hash text;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if e.version_count > 0 and not e.dirty then raise exception 'QB_MOCK_NO_CHANGES' using errcode = '55000'; end if;
  rd := quizbox_mock.readiness(e);
  if not (rd ->> 'ready')::boolean then raise exception 'QB_MOCK_NOT_READY: %', rd -> 'issues' -> 0 ->> 'code' using errcode = '55000'; end if;
  v_no := e.version_count + 1;
  select count(*)::integer, coalesce(sum(q.marks), 0), md5(string_agg(q.id::text || ':' || coalesce(q.version, 1)::text, ',' order by r.position, s.seq))
    into v_n, v_marks, v_hash from public.mock_exam_questions s join public.mock_exam_rounds r on r.id = s.round_id join public.questions q on q.id = s.question_id where s.exam_id = e.id;
  insert into public.mock_exam_versions(exam_id, version_no, published_by, title, description, purpose, audience, curriculum_id, target_grade, question_count, total_marks, time_limit_minutes, attempts_allowed,
                                        shuffle_questions, instructions, rounds, content_hash)
  values (e.id, v_no, auth.uid(), e.title, e.description, e.purpose, e.audience, e.curriculum_id, e.target_grade, v_n, v_marks, e.time_limit_minutes, e.attempts_allowed, e.shuffle_questions, e.instructions,
          (select coalesce(jsonb_agg(x - 'id' - 'available' - 'available_to_add' - 'shortfall' order by (x ->> 'position')::integer), '[]'::jsonb) from jsonb_array_elements(quizbox_mock.rounds_json(e)) x), v_hash)
  returning * into v;
  insert into public.mock_exam_version_questions(version_id, position, round_position, question_id, question_version, topic_id, grade_code, subject_code, curriculum_node_id, external_id, source_type, source_version, curriculum_reference,
      question_text, option_a, option_b, option_c, option_d, correct_answer, explanation, answer_type, answer_spec, question_content, marks)
  select v.id, row_number() over (order by r.position, s.seq)::integer, r.position, q.id, q.version, r.topic_id, r.grade_code, r.subject_code, q.curriculum_node_id, q.external_question_id, q.source_type, q.source_version, q.curriculum_reference,
         q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.explanation, q.answer_type, q.answer_spec, q.question_content, q.marks
    from public.mock_exam_questions s join public.mock_exam_rounds r on r.id = s.round_id join public.questions q on q.id = s.question_id where s.exam_id = e.id;
  update public.mock_exams set status = 'published', dirty = false, current_version_id = v.id, version_count = v_no, updated_at = now() where id = e.id returning * into e;
  perform quizbox_core.audit('mock_exam.publish', 'mock_exams', e.id, jsonb_build_object('version', v_no, 'questions', v_n));
  return jsonb_build_object('version_id', v.id, 'version_no', v_no, 'question_count', v_n, 'exam', quizbox_mock.exam_json(e));
end $fn$;

revoke all on function public.qb_mock_enabled(), public.qb_mock_author_status(), public.qb_mock_curricula(), public.qb_mock_grades(text), public.qb_mock_subjects(uuid, text), public.qb_mock_topics(uuid, text, text, uuid),
  public.qb_mock_exam_create(jsonb), public.qb_mock_exam_update(uuid, jsonb), public.qb_mock_exam_list(), public.qb_mock_exam_get(uuid), public.qb_mock_exam_delete(uuid), public.qb_mock_exam_archive(uuid),
  public.qb_mock_round_save(uuid, uuid, text, text, uuid, integer), public.qb_mock_round_delete(uuid, uuid), public.qb_mock_round_pick(uuid, uuid), public.qb_mock_round_clear(uuid, uuid),
  public.qb_mock_round_candidates(uuid, uuid, integer, integer), public.qb_mock_round_set_questions(uuid, uuid, uuid[]), public.qb_mock_exam_review(uuid), public.qb_mock_exam_publish(uuid) from public, anon;
grant execute on function public.qb_mock_enabled(), public.qb_mock_author_status(), public.qb_mock_curricula(), public.qb_mock_grades(text), public.qb_mock_subjects(uuid, text), public.qb_mock_topics(uuid, text, text, uuid),
  public.qb_mock_exam_create(jsonb), public.qb_mock_exam_update(uuid, jsonb), public.qb_mock_exam_list(), public.qb_mock_exam_get(uuid), public.qb_mock_exam_delete(uuid), public.qb_mock_exam_archive(uuid),
  public.qb_mock_round_save(uuid, uuid, text, text, uuid, integer), public.qb_mock_round_delete(uuid, uuid), public.qb_mock_round_pick(uuid, uuid), public.qb_mock_round_clear(uuid, uuid),
  public.qb_mock_round_candidates(uuid, uuid, integer, integer), public.qb_mock_round_set_questions(uuid, uuid, uuid[]), public.qb_mock_exam_review(uuid), public.qb_mock_exam_publish(uuid) to authenticated, service_role;
