-- Topic study mode (tracker T4). A learner picks ONE topic and works through its questions in learning order (easy, then medium, then hard), seeing
-- the explanation after every answer (the existing practice feedback already returns it). Questions the learner has not seen come first, then ones they
-- got wrong, then ones they got right, so repeated sessions keep moving through the topic instead of repeating it.
--   qb_topic_progress(topic_ids)                    per topic: how many approved questions exist, how many the learner has answered, how many correctly
--   qb_start_study_session(topic, count, grade)     builds the ordered set; the same grade, market and free-allowance rules as the quick builder
-- A "topic" here is what the practice builder lists (a sub-strand). Study sessions count as self-built practice for the free allowance.
begin;

create or replace function public.qb_topic_progress(p_topic_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_topic_ids is null or cardinality(p_topic_ids) > 80 then raise exception 'QB_PRACTICE_TOPICS_REQUIRED'; end if;
  return coalesce((
    with recursive down(id, topic_id, node_type, depth) as (
      select n.id, n.id, n.node_type, 0 from public.curriculum_nodes n where n.id = any (p_topic_ids) and n.is_active and n.node_type = 'sub_strand'
      union all
      select c.id, d.topic_id, c.node_type, d.depth + 1 from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 6),
    qs as (
      select d.topic_id, q.id as question_id from down d join public.questions q on q.curriculum_node_id = d.id
       where d.node_type = 'learning_indicator' and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated')
         and public.qb_question_is_available(q) and coalesce(q.source_type, '') not like 'DEV\_%'),
    mine as (
      select r.question_id, bool_or(coalesce(r.is_correct, false)) as ever_correct
        from public.responses r join public.attempts a on a.id = r.attempt_id where a.student_user_id = auth.uid() group by r.question_id)
    select jsonb_agg(jsonb_build_object('topic_id', t.topic_id, 'total', t.total, 'answered', t.answered, 'correct', t.correct) order by t.topic_id)
      from (select qs.topic_id, count(*)::integer as total, count(mine.question_id)::integer as answered, count(*) filter (where mine.ever_correct)::integer as correct
              from qs left join mine on mine.question_id = qs.question_id group by qs.topic_id) t), '[]'::jsonb);
end $fn$;

create or replace function public.qb_start_study_session(p_topic uuid, p_count integer default 12, p_grade text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare sp public.student_profiles; g text; m uuid; r text; subj public.curriculum_nodes; v_assessment public.assessments; v_used integer; v_new integer;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_topic is null then raise exception 'QB_PRACTICE_TOPICS_REQUIRED'; end if;
  if p_count is null or p_count not between 3 and 30 then raise exception 'QB_PRACTICE_COUNT_INVALID'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id, upper(role::text) into m, r from public.profiles where id = auth.uid();
  if sp.id is not null and public.qb_free_allowance_exhausted(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED'; end if;
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
  elsif r in ('TEACHER', 'ADMIN', 'OWNER') then
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then raise exception 'QB_PRACTICE_GRADE_REQUIRED'; end if;
  else
    raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501';
  end if;

  create temporary table qb_study_pool on commit drop as
  with recursive down(id, subject_id, in_topic, node_type, depth) as (
    select n.id, n.id, false, n.node_type, 0
      from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
     where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m)
    union all
    select c.id, d.subject_id, d.in_topic or (c.id = p_topic and c.node_type = 'sub_strand'), c.node_type, d.depth + 1
      from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 8)
  select q.id as question_id, q.version, d.subject_id,
         case lower(coalesce(q.difficulty_label, '')) when 'easy' then 1 when 'medium' then 2 when 'hard' then 3 else 2 end as diff_rank,
         case when exists (select 1 from public.responses rr join public.attempts aa on aa.id = rr.attempt_id where aa.student_user_id = auth.uid() and rr.question_id = q.id and coalesce(rr.is_correct, false)) then 2
              when exists (select 1 from public.responses rr join public.attempts aa on aa.id = rr.attempt_id where aa.student_user_id = auth.uid() and rr.question_id = q.id) then 1
              else 0 end as seen_rank
    from down d join public.questions q on q.curriculum_node_id = d.id
   where d.node_type = 'learning_indicator' and d.in_topic
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_available(q)
     and coalesce(q.source_type, '') not like 'DEV\_%';

  if (select count(*) from qb_study_pool) = 0 then raise exception 'QB_PRACTICE_NO_QUESTIONS'; end if;
  select s.* into subj from public.curriculum_nodes s where s.id = (select subject_id from qb_study_pool limit 1);

  -- Unseen first, then the ones the learner got wrong, then the ones they got right; spread across difficulty so one session still climbs from easy to hard.
  create temporary table qb_study_pick on commit drop as
  select question_id, diff_rank, seen_rank from qb_study_pool order by seen_rank, random() limit p_count;
  select count(*), count(*) filter (where seen_rank = 0) into v_used, v_new from qb_study_pick;

  insert into public.assessments(assessment_type, owner_role, owner_user_id, subject_code, subject_name, grade, grade_code, question_count, difficulty,
                                 time_limit_minutes, max_attempts, allow_resume, auto_submit, pass_percent, expires_at, instructions, tenant_id, reference_type)
  values ('PRACTICE', (case when sp.id is not null then 'student' when r = 'TEACHER' then 'teacher' else 'admin' end)::public.qb_role, auth.uid(), coalesce(subj.subject_code, subj.title), subj.title,
          case when exists (select 1 from pg_catalog.pg_enum e where e.enumtypid = 'public.qb_grade'::regtype and e.enumlabel = g) then g::public.qb_grade else null end,
          g, v_used, 'mixed', greatest(10, v_used * 3), 1, true, true, 40, now() + interval '3 days',
          'Study session: questions go from easier to harder. Read the explanation after each answer.', public.qb_public_tenant_id(), 'SELF_PRACTICE')
  returning * into v_assessment;

  insert into public.assessment_questions(assessment_id, question_id, question_order, question_text_snapshot, option_a_snapshot, option_b_snapshot, option_c_snapshot,
                                          option_d_snapshot, correct_answer_snapshot, marks_snapshot, question_content_snapshot, answer_type_snapshot, answer_spec_snapshot)
  select v_assessment.id, q.id, row_number() over (order by p.diff_rank, random()), q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.marks,
         q.question_content, q.answer_type, q.answer_spec
    from qb_study_pick p join public.questions q on q.id = p.question_id;

  return jsonb_build_object('assessment_id', v_assessment.id, 'subject', subj.title, 'question_count', v_used, 'requested', p_count, 'short', v_used < p_count, 'new_questions', v_new);
end $fn$;

revoke all on function public.qb_topic_progress(uuid[]), public.qb_start_study_session(uuid, integer, text) from public, anon;
grant execute on function public.qb_topic_progress(uuid[]), public.qb_start_study_session(uuid, integer, text) to authenticated;

commit;
