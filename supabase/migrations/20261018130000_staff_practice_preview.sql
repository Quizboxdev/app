-- Staff practice preview. Attempts are for learners (qb_start_attempt requires a student profile), so a teacher or admin who builds a practice set
-- with the quick builder could not open it. This read-only function returns the set's questions WITH answers and explanations, only to the staff
-- member who built it, so they can check content or teach from it. It records nothing and never touches learner attempts or scores.
begin;

create or replace function public.qb_staff_practice_preview(p_assessment uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare a public.assessments; r text;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select upper(role::text) into r from public.profiles where id = auth.uid();
  if r is null or r not in ('TEACHER', 'ADMIN', 'OWNER') then raise exception 'QB_STAFF_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.assessments where id = p_assessment;
  if a.id is null or a.owner_user_id is distinct from auth.uid() then raise exception 'QB_ASSESSMENT_NOT_FOUND'; end if;
  return jsonb_build_object('assessment_id', a.id, 'subject', a.subject_name, 'grade', a.grade_code, 'question_count', a.question_count,
    'questions', coalesce((select jsonb_agg(jsonb_build_object('n', aq.question_order, 'question', aq.question_text_snapshot,
        'a', aq.option_a_snapshot, 'b', aq.option_b_snapshot, 'c', aq.option_c_snapshot, 'd', aq.option_d_snapshot,
        'correct', aq.correct_answer_snapshot, 'answer_type', aq.answer_type_snapshot, 'content', aq.question_content_snapshot,
        'explanation', q.explanation) order by aq.question_order)
      from public.assessment_questions aq left join public.questions q on q.id = aq.question_id where aq.assessment_id = a.id), '[]'::jsonb));
end $fn$;

revoke all on function public.qb_staff_practice_preview(uuid) from public, anon;
grant execute on function public.qb_staff_practice_preview(uuid) to authenticated;

commit;
