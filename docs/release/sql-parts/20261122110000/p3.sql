-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_results(p_exam uuid, p_version uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); v public.mock_exam_versions; v_id uuid; assigned integer; res jsonb;
begin
  v_id := coalesce(p_version, e.current_version_id);
  if v_id is null then
    return jsonb_build_object('exam', jsonb_build_object('id', e.id, 'title', e.title, 'status', e.status), 'version', null, 'versions', '[]'::jsonb, 'summary', null, 'questions', '[]'::jsonb, 'participants', '[]'::jsonb);
  end if;
  select * into v from public.mock_exam_versions where id = v_id and exam_id = e.id;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select (select count(distinct t.membership_id) from public.mock_exam_assignments ma join public.assignments x on x.id = ma.assignment_id join public.assignment_targets t on t.assignment_id = x.id and t.status::text = 'active'
           where ma.exam_id = e.id and ma.version_id = v.id and (x.teacher_user_id = auth.uid() or public.qb_can_manage_class(x.class_id)))
       + (select count(*) from public.mock_exam_enrolments en where en.exam_id = e.id and en.version_id = v.id) into assigned;
  with a as (select * from quizbox_mock.attempt_rows(e.id) r where r.version_id = v.id),
  fin as (select * from a where state in ('submitted', 'expired') and score is not null),
  last as (select distinct on (source, participant_key) * from fin order by source, participant_key, started_at desc),
  pstat as (select count(distinct (source, participant_key))::integer as started, count(distinct (source, participant_key)) filter (where state in ('submitted', 'expired'))::integer as finished,
                   count(distinct (source, participant_key)) filter (where state = 'in_progress')::integer as in_progress from a),
  summ as (select count(*)::integer as n, round(avg(percentage), 1) as average, round((percentile_cont(0.5) within group (order by percentage))::numeric, 1) as median, max(percentage) as highest, min(percentage) as lowest from last),
  qs as (select vq.position, vq.question_id, vq.external_id, vq.question_text, vq.subject_code, vq.grade_code, vq.answer_type, vq.marks,
                count(rr.id)::integer as answered, count(rr.id) filter (where rr.is_correct)::integer as correct
           from public.mock_exam_version_questions vq left join (select r.attempt_id, r.question_id, r.id, r.is_correct from public.responses r join fin f on f.attempt_id = r.attempt_id) rr on rr.question_id = vq.question_id
          where vq.version_id = v.id group by vq.position, vq.question_id, vq.external_id, vq.question_text, vq.subject_code, vq.grade_code, vq.answer_type, vq.marks)
  select jsonb_build_object(
    'exam', jsonb_build_object('id', e.id, 'title', e.title, 'status', e.status, 'purpose', e.purpose, 'target_grade', e.target_grade),
    'version', jsonb_build_object('id', v.id, 'version_no', v.version_no, 'question_count', v.question_count, 'total_marks', v.total_marks, 'published_at', v.published_at),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'version_no', x.version_no) order by x.version_no desc) from public.mock_exam_versions x where x.exam_id = e.id), '[]'::jsonb),
    'summary', jsonb_build_object('assigned', assigned, 'started', (select started from pstat), 'finished', (select finished from pstat), 'in_progress', (select in_progress from pstat),
      'not_started', greatest(assigned - (select started from pstat), 0), 'completion_percent', case when assigned > 0 then round(100.0 * (select finished from pstat) / assigned, 1) end,
      'average_percent', (select average from summ), 'median_percent', (select median from summ), 'highest_percent', (select highest from summ), 'lowest_percent', (select lowest from summ), 'scored', (select n from summ)),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('position', q.position, 'question_id', q.question_id, 'external_id', q.external_id, 'question_text', left(q.question_text, 300), 'subject_code', q.subject_code,
        'grade_code', q.grade_code, 'answer_type', q.answer_type, 'marks', q.marks, 'answered', q.answered, 'correct', q.correct, 'correct_percent', case when q.answered > 0 then round(100.0 * q.correct / q.answered, 1) end) order by q.position) from qs q), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(p.j order by p.sort_name, p.started_at) from (
        select a.participant as sort_name, a.started_at, jsonb_build_object('attempt_id', a.attempt_id, 'source', a.source, 'group', a.group_label, 'class_id', a.class_id, 'participant_key', a.participant_key, 'participant', a.participant,
          'attempt_no', a.attempt_no, 'state', a.state, 'started_at', a.started_at, 'submitted_at', a.submitted_at, 'score', a.score, 'total_marks', a.total_marks, 'percent', a.percentage) as j from a
        union all
        select p2.full_name, null::timestamptz, jsonb_build_object('attempt_id', null, 'source', 'class', 'group', c.class_name, 'class_id', c.id, 'participant_key', m.student_user_id, 'participant', coalesce(p2.full_name, 'Learner'),
          'attempt_no', 0, 'state', 'not_started', 'started_at', null, 'submitted_at', null, 'score', null, 'total_marks', null, 'percent', null)
          from public.mock_exam_assignments ma join public.assignments x on x.id = ma.assignment_id join public.assignment_targets t on t.assignment_id = x.id and t.status::text = 'active'
          join public.class_memberships m on m.id = t.membership_id join public.classes c on c.id = x.class_id left join public.profiles p2 on p2.id = m.student_user_id
         where ma.exam_id = e.id and ma.version_id = v.id and (x.teacher_user_id = auth.uid() or public.qb_can_manage_class(x.class_id))
           and not exists (select 1 from a where a.source = 'class' and a.participant_key = m.student_user_id and a.class_id = c.id)) p), '[]'::jsonb)) into res;
  return res;
end $fn$;

-- The student-by-question review: one row per attempt and question of the chosen version, with the learner's answer, the correct answer, correctness and marks.
create or replace function quizbox_mock.result_rows(p_exam uuid, p_version uuid, p_class uuid, p_student uuid, p_question uuid, p_state text) returns table(r jsonb)
language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('attempt_id', a.attempt_id, 'group', a.group_label, 'participant', a.participant, 'participant_key', a.participant_key, 'attempt_no', a.attempt_no, 'state', a.state,
      'started_at', a.started_at, 'submitted_at', a.submitted_at, 'attempt_score', a.score, 'attempt_total', a.total_marks, 'attempt_percent', a.percentage,
      'position', vq.position, 'presented_order', aq.question_order, 'question_id', vq.question_id, 'external_id', vq.external_id, 'question_text', vq.question_text, 'subject_code', vq.subject_code, 'grade_code', vq.grade_code,
      'answer_type', vq.answer_type, 'answer', quizbox_mock.answer_text(vq, rr.selected_answer, rr.selected_value), 'correct_answer', quizbox_mock.correct_text(vq),
      'is_correct', case when rr.id is null then null else rr.is_correct end, 'marks_awarded', coalesce(rr.marks_awarded, 0), 'marks', vq.marks, 'answered', rr.id is not null)
  from quizbox_mock.attempt_rows(p_exam) a join public.mock_exam_version_questions vq on vq.version_id = a.version_id
  left join public.responses rr on rr.attempt_id = a.attempt_id and rr.question_id = vq.question_id
  left join public.assessment_questions aq on aq.assessment_id = a.assessment_id and aq.question_id = vq.question_id
  where a.version_id = p_version and (p_class is null or a.class_id = p_class) and (p_student is null or a.participant_key = p_student) and (p_question is null or vq.question_id = p_question)
    and (p_state is null or a.state = p_state)
  order by a.participant, a.started_at, vq.position
$fn$;
revoke all on function quizbox_mock.result_rows(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
