-- Subject list and practice builders that stay fast with tens of thousands of questions.
-- Why: public.qb_question_is_available(q) re-validates a question's whole content and its market attribution every time it is called (about 4 ms each).
-- The subject list, topic progress and the two practice builders called it for EVERY question of the learner's grade, so a grade with about 9,000
-- questions took 40 seconds and the app's time limit cut the request off: the learner saw an endless loading placeholder instead of their subjects.
-- Now: counts and candidate pools use qb_question_is_listable (plain column checks: active, approved, owner/tenant rules), and the full
-- qb_question_is_available check runs only on the questions actually chosen for a set (a few more than the set needs), so what a learner is given is
-- exactly what it was before. The subject list may count a question the full check would still refuse (one whose stored content is malformed); the
-- builders skip such a question and say so honestly (short set), or refuse with QB_PRACTICE_NO_QUESTIONS if none of the candidates pass.
-- Replaces qb_practice_menu (20261018110000), qb_start_quick_practice (20261018100000), qb_topic_progress and qb_start_study_session (20261019140000)
-- with identical signatures and output shapes. Additive helper: qb_question_is_listable. Rollback: supabase/rollback/fast_subject_list.sql.
begin;

create or replace function public.qb_question_is_listable(q public.questions) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated')
     and (q.tenant_id is null or q.tenant_id = public.qb_public_tenant_id() or public.qb_is_tenant_member(q.tenant_id) or public.qb_is_platform_admin())
$fn$;
revoke all on function public.qb_question_is_listable(public.questions) from public, anon, authenticated;

create or replace function public.qb_practice_menu(p_grade text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare sp public.student_profiles; g text; m uuid; r text;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id, upper(role::text) into m, r from public.profiles where id = auth.uid();
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
  elsif r in ('TEACHER', 'ADMIN', 'OWNER') then
    -- Staff use the same builder; they choose the grade they are working on.
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then
      return jsonb_build_object('grade', null, 'subjects', '[]'::jsonb, 'grades', coalesce((
        select jsonb_agg(x order by x) from (select distinct upper(coalesce(n.canonical_grade_code, n.grade_code)) as x
          from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
         where n.is_active and n.node_type = 'subject' and coalesce(n.canonical_grade_code, n.grade_code) is not null and (m is null or mc.market_id = m)) y), '[]'::jsonb));
    end if;
  else
    raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501';
  end if;
  return jsonb_build_object('grade', g, 'subjects', coalesce((
    with recursive down(id, subject_id, topic_id, node_type, depth) as (
      select n.id, n.id, null::uuid, n.node_type, 0
        from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
       where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m)
      union all
      select c.id, d.subject_id, case when c.node_type = 'sub_strand' then c.id else d.topic_id end, c.node_type, d.depth + 1
        from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 8),
    avail as (
      select d.subject_id, d.topic_id, count(q.id)::integer as n
        from down d join public.questions q on q.curriculum_node_id = d.id
       where d.node_type = 'learning_indicator' and d.topic_id is not null
         and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_listable(q)
         and coalesce(q.source_type, '') not like 'DEV\_%'
       group by d.subject_id, d.topic_id),
    subj as (
      select s.id, s.title, s.subject_code, sum(a.n)::integer as total,
             jsonb_agg(jsonb_build_object('id', t.id, 'title', public.qb_topic_label(t.id), 'strand', case when public.qb_label_is_code(st.title) then '' else coalesce(st.title, '') end, 'available', a.n) order by st.sort_order, t.sort_order, t.title) as topics
        from avail a join public.curriculum_nodes s on s.id = a.subject_id
        join public.curriculum_nodes t on t.id = a.topic_id left join public.curriculum_nodes st on st.id = t.parent_id and st.node_type = 'strand'
       group by s.id, s.title, s.subject_code)
    select jsonb_agg(jsonb_build_object('id', id, 'name', title, 'subject_code', subject_code, 'available', total, 'topics', topics) order by title) from subj), '[]'::jsonb));
end $fn$;

create or replace function public.qb_start_quick_practice(p_topic_ids uuid[], p_count integer default 10, p_grade text default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare sp public.student_profiles; g text; m uuid; r text; subj public.curriculum_nodes; v_assessment public.assessments; v_available integer; v_used integer;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_topic_ids is null or cardinality(p_topic_ids) not between 1 and 40 then raise exception 'QB_PRACTICE_TOPICS_REQUIRED'; end if;
  if p_count is null or p_count not between 3 and 30 then raise exception 'QB_PRACTICE_COUNT_INVALID'; end if;
  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id, upper(role::text) into m, r from public.profiles where id = auth.uid();
  -- A learner who has used the free allowance and has no active subscription is sent to subscribe (the app redirects on this code).
  if sp.id is not null and public.qb_free_allowance_exhausted(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED'; end if;
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
  elsif r in ('TEACHER', 'ADMIN', 'OWNER') then
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then raise exception 'QB_PRACTICE_GRADE_REQUIRED'; end if;
  else
    raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501';
  end if;

  create temporary table qb_quick_pool on commit drop as
  with recursive down(id, subject_id, topic_id, node_type, depth) as (
    select n.id, n.id, null::uuid, n.node_type, 0
      from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
     where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m)
    union all
    select c.id, d.subject_id, case when c.node_type = 'sub_strand' then c.id else d.topic_id end, c.node_type, d.depth + 1
      from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 8)
  select q.id as question_id, q.version, d.subject_id, d.topic_id,
         row_number() over (partition by d.topic_id order by random()) as rn
    from down d join public.questions q on q.curriculum_node_id = d.id
   where d.node_type = 'learning_indicator' and d.topic_id = any (p_topic_ids)
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_listable(q)
     and coalesce(q.source_type, '') not like 'DEV\_%';

  -- Every ticked topic must be one this learner is allowed to practise, and all must belong to one subject.
  if (select count(distinct topic_id) from qb_quick_pool) = 0 then raise exception 'QB_PRACTICE_NO_QUESTIONS'; end if;
  if (select count(distinct subject_id) from qb_quick_pool) <> 1 then raise exception 'QB_PRACTICE_ONE_SUBJECT'; end if;
  select s.* into subj from public.curriculum_nodes s where s.id = (select subject_id from qb_quick_pool limit 1);

  -- The full availability check is expensive, so it runs only on a few more candidates than the set needs, not on the whole pool.
  create temporary table qb_quick_pick on commit drop as
  -- (The check is written as a per-row subquery so the database cannot apply it to the whole questions table before choosing the candidates.)
  select c.question_id from (select question_id, rn from qb_quick_pool order by rn, random() limit p_count * 3 + 10) c
   where (select public.qb_question_is_available(q) from public.questions q where q.id = c.question_id)
   order by c.rn, random() limit p_count;
  select count(*) into v_used from qb_quick_pick;
  if v_used = 0 then raise exception 'QB_PRACTICE_NO_QUESTIONS'; end if;

  insert into public.assessments(assessment_type, owner_role, owner_user_id, subject_code, subject_name, grade, grade_code, question_count, difficulty,
                                 time_limit_minutes, max_attempts, allow_resume, auto_submit, pass_percent, expires_at, instructions, tenant_id, reference_type)
  values ('PRACTICE', (case when sp.id is not null then 'student' when r = 'TEACHER' then 'teacher' else 'admin' end)::public.qb_role, auth.uid(), coalesce(subj.subject_code, subj.title), subj.title,
          case when exists (select 1 from pg_catalog.pg_enum e where e.enumtypid = 'public.qb_grade'::regtype and e.enumlabel = g) then g::public.qb_grade else null end,
          g, v_used, 'mixed', greatest(5, v_used * 2), 1, true, true, 40, now() + interval '3 days',
          'Your own practice set.', public.qb_public_tenant_id(), 'SELF_PRACTICE')
  returning * into v_assessment;

  insert into public.assessment_questions(assessment_id, question_id, question_order, question_text_snapshot, option_a_snapshot, option_b_snapshot, option_c_snapshot,
                                          option_d_snapshot, correct_answer_snapshot, marks_snapshot, question_content_snapshot, answer_type_snapshot, answer_spec_snapshot)
  select v_assessment.id, q.id, row_number() over (order by random()), q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.marks,
         q.question_content, q.answer_type, q.answer_spec
    from qb_quick_pick p join public.questions q on q.id = p.question_id;

  return jsonb_build_object('assessment_id', v_assessment.id, 'subject', subj.title, 'question_count', v_used, 'requested', p_count, 'short', v_used < p_count);
end $fn$;

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
         and public.qb_question_is_listable(q) and coalesce(q.source_type, '') not like 'DEV\_%'),
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
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_listable(q)
     and coalesce(q.source_type, '') not like 'DEV\_%';

  if (select count(*) from qb_study_pool) = 0 then raise exception 'QB_PRACTICE_NO_QUESTIONS'; end if;
  select s.* into subj from public.curriculum_nodes s where s.id = (select subject_id from qb_study_pool limit 1);

  -- Unseen first, then the ones the learner got wrong, then the ones they got right; spread across difficulty so one session still climbs from easy to hard.
  create temporary table qb_study_pick on commit drop as
  select c.question_id, c.diff_rank, c.seen_rank
    from (select question_id, diff_rank, seen_rank from qb_study_pool order by seen_rank, random() limit p_count * 3 + 10) c
   where (select public.qb_question_is_available(q) from public.questions q where q.id = c.question_id)
   order by c.seen_rank, random() limit p_count;
  select count(*), count(*) filter (where seen_rank = 0) into v_used, v_new from qb_study_pick;
  if v_used = 0 then raise exception 'QB_PRACTICE_NO_QUESTIONS'; end if;

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

revoke all on function public.qb_practice_menu(text), public.qb_start_quick_practice(uuid[], integer, text), public.qb_topic_progress(uuid[]), public.qb_start_study_session(uuid, integer, text) from public, anon;
grant execute on function public.qb_practice_menu(text), public.qb_start_quick_practice(uuid[], integer, text), public.qb_topic_progress(uuid[]), public.qb_start_study_session(uuid, integer, text) to authenticated;

commit;
