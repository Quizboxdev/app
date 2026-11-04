-- Preview for the teacher: the split and what each topic can supply, without choosing questions for the learner to see.
create or replace function public.qb_blueprint_plan(p_class_id uuid, p_sections jsonb, p_difficulty text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
begin
  return quizbox_topic.blueprint_plan(p_class_id, p_sections, p_difficulty) - 'question_ids' - 'node_ids' - 'shares';
end $fn$;

create or replace function public.qb_publish_blueprint_assignment(
  p_class_id uuid, p_title text, p_description text, p_sections jsonb, p_difficulty text default null,
  p_mode text default 'ASSESSMENT', p_attempts_allowed integer default 1, p_time_limit_minutes integer default 30,
  p_start_at timestamptz default now(), p_due_at timestamptz default null, p_target_student_ids uuid[] default null
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare plan jsonb; published jsonb; aid uuid;
begin
  plan := quizbox_topic.blueprint_plan(p_class_id, p_sections, p_difficulty);
  published := public.qb_publish_assignment(p_class_id, p_title, p_description,
    array(select jsonb_array_elements_text(plan -> 'node_ids'))::uuid[], (plan ->> 'total')::integer, null, 'MANUAL',
    array(select jsonb_array_elements_text(plan -> 'question_ids'))::uuid[], p_mode, p_attempts_allowed, p_time_limit_minutes,
    p_start_at, p_due_at, p_target_student_ids, null, null);
  aid := (published ->> 'assignment_id')::uuid;
  insert into public.assignment_topics(assignment_id, topic_id, question_share)
  select aid, (s ->> 'topic_id')::uuid, (s ->> 'share')::integer from jsonb_array_elements(plan -> 'shares') s;
  insert into public.assignment_sections(assignment_id, position, subject, quota)
  select aid, (s ->> 'position')::integer, s ->> 'subject', (s ->> 'quota')::integer from jsonb_array_elements(plan -> 'sections') s;
  return published || jsonb_build_object('sections', plan -> 'sections');
end $fn$;

-- A learner's own result by subject and by topic, with the weakest topics, for any assessment. Unanswered questions count as not correct.
-- A question's subject is its own subject; its topic is its registered topic (a question without one is counted in the subject only).
create or replace function public.qb_attempt_breakdown(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare a public.attempts; result jsonb;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into a from public.attempts where id = p_attempt;
  if a.id is null or a.student_user_id is distinct from auth.uid() then raise exception 'ATTEMPT_NOT_FOUND' using errcode = '42501'; end if;
  with qs as (
    select aq.question_id, coalesce(nullif(btrim(q.subject_code), ''), 'Other') as subject, l.topic_id, t.title as topic_title,
           coalesce((select bool_or(coalesce(r.is_correct, false)) from public.responses r where r.attempt_id = a.id and r.question_id = aq.question_id), false) as correct
      from public.assessment_questions aq join public.questions q on q.id = aq.question_id
      left join public.question_topic_links l on l.question_id = q.id left join public.curriculum_topics t on t.id = l.topic_id
     where aq.assessment_id = a.assessment_id),
  subj as (select subject, count(*)::integer as total, count(*) filter (where correct)::integer as correct from qs group by subject),
  tops as (select subject, topic_id, topic_title, count(*)::integer as total, count(*) filter (where correct)::integer as correct from qs where topic_id is not null group by subject, topic_id, topic_title)
  select jsonb_build_object(
    'attempt_id', a.id,
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('subject', s.subject, 'position', (select sc.position from public.assignment_sections sc where sc.assignment_id = a.assignment_id and sc.subject = s.subject), 'total', s.total, 'correct', s.correct, 'percent', round(100.0 * s.correct / s.total),
        'topics', coalesce((select jsonb_agg(jsonb_build_object('topic_id', t.topic_id, 'title', t.topic_title, 'total', t.total, 'correct', t.correct, 'percent', round(100.0 * t.correct / t.total)) order by round(100.0 * t.correct / t.total), t.topic_title)
                              from tops t where t.subject = s.subject), '[]'::jsonb))
        order by round(100.0 * s.correct / s.total), s.subject) from subj s), '[]'::jsonb),
    'weakest', coalesce((select jsonb_agg(jsonb_build_object('subject', w.subject, 'topic_id', w.topic_id, 'title', w.topic_title, 'correct', w.correct, 'total', w.total, 'percent', round(100.0 * w.correct / w.total)))
                         from (select * from tops order by (correct::numeric / total), total desc, topic_title limit 3) w where w.correct < w.total), '[]'::jsonb)) into result;
  return result;
end $fn$;

revoke all on function quizbox_topic.class_level(text, text), quizbox_topic.listable_questions(uuid, uuid, boolean), quizbox_topic.pick_for_topic(uuid, text, integer, text, uuid, boolean, uuid[]),
  quizbox_topic.blueprint_plan(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.qb_teacher_topics(uuid, text), public.qb_blueprint_plan(uuid, jsonb, text),
  public.qb_publish_blueprint_assignment(uuid, text, text, jsonb, text, text, integer, integer, timestamptz, timestamptz, uuid[]), public.qb_attempt_breakdown(uuid) from public, anon;
grant execute on function public.qb_teacher_topics(uuid, text), public.qb_blueprint_plan(uuid, jsonb, text),
  public.qb_publish_blueprint_assignment(uuid, text, text, jsonb, text, text, integer, integer, timestamptz, timestamptz, uuid[]), public.qb_attempt_breakdown(uuid) to authenticated;
