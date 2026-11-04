create or replace function public.qb_start_mixed_practice(p_sections jsonb, p_grade text default null, p_order text default 'MIXED') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  sp public.student_profiles; g text; m uuid; r text; v_assessment public.assessments; v_used integer; v_total integer := 0; v_n integer; sec jsonb; seen uuid[] := '{}'; subj_id uuid; v_subjects uuid[];
  v_found integer; v_title text; v_code text; v_sections jsonb;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then raise exception 'QB_BLUEPRINT_INVALID'; end if;
  v_n := jsonb_array_length(p_sections);
  if v_n < 1 or v_n > 8 then raise exception 'QB_BLUEPRINT_SECTIONS_INVALID'; end if;
  if p_order not in ('MIXED', 'BY_SUBJECT') then raise exception 'QB_BLUEPRINT_INVALID'; end if;
  for sec in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(sec) <> 'object' or coalesce(sec ->> 'subject', '') !~ '^[0-9a-fA-F-]{36}$' or coalesce(sec ->> 'quota', '') !~ '^[0-9]{1,2}$' or (sec ->> 'quota')::integer < 1 then raise exception 'QB_BLUEPRINT_INVALID'; end if;
    subj_id := (sec ->> 'subject')::uuid;
    if subj_id = any (seen) then raise exception 'QB_BLUEPRINT_DUPLICATE_SUBJECT'; end if;
    if jsonb_typeof(sec -> 'topic_ids') = 'array' and jsonb_array_length(sec -> 'topic_ids') > 40 then raise exception 'QB_PRACTICE_TOPICS_REQUIRED'; end if;
    seen := seen || subj_id; v_total := v_total + (sec ->> 'quota')::integer;
  end loop;
  if v_total not between 3 and 30 then raise exception 'QB_PRACTICE_COUNT_INVALID'; end if;
  v_subjects := seen;

  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id, upper(role::text) into m, r from public.profiles where id = auth.uid();
  if sp.id is not null and public.qb_free_allowance_exhausted(auth.uid()) then raise exception 'QB_FREE_ALLOWANCE_EXHAUSTED'; end if;
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
    if g = 'B10' then g := 'SHS1'; end if;   -- legacy code for SHS 1, the same alias the access rules already apply
  elsif r in ('TEACHER', 'ADMIN', 'OWNER') then
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then raise exception 'QB_PRACTICE_GRADE_REQUIRED'; end if;
  else
    raise exception 'QB_STUDENT_REQUIRED' using errcode = '42501';
  end if;
  -- Mixing subjects is for Primary and JHS only.
  if v_n > 1 and quizbox_topic.class_level(g, null) not in ('PRIMARY', 'JHS') then raise exception 'QB_COMBINED_LEVEL_NOT_ALLOWED'; end if;

  -- Every chosen subject must be one of this learner's subjects.
  select count(*) into v_found from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
   where n.id = any (v_subjects) and n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m);
  if v_found <> cardinality(v_subjects) then raise exception 'QB_PRACTICE_SUBJECT_UNAVAILABLE'; end if;

  create temporary table qb_mix_sections on commit drop as
  select (s.value ->> 'subject')::uuid as subject_id, (s.value ->> 'quota')::integer as quota, s.ordinality::integer as pos,
         case when jsonb_typeof(s.value -> 'topic_ids') = 'array' and jsonb_array_length(s.value -> 'topic_ids') > 0
              then array(select jsonb_array_elements_text(s.value -> 'topic_ids'))::uuid[] end as topic_ids
    from jsonb_array_elements(p_sections) with ordinality as s(value, ordinality);

  create temporary table qb_mix_pool on commit drop as
  with recursive down(id, subject_id, topic_id, node_type, depth) as (
    select n.id, n.id, null::uuid, n.node_type, 0
      from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
     where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m) and n.id = any (v_subjects)
    union all
    select c.id, d.subject_id, case when c.node_type = 'sub_strand' then c.id else d.topic_id end, c.node_type, d.depth + 1
      from down d join public.curriculum_nodes c on c.parent_id = d.id where c.is_active and d.depth < 8)
  select q.id as question_id, d.subject_id, d.topic_id, row_number() over (partition by d.subject_id, d.topic_id order by random()) as rn
    from down d join qb_mix_sections sc on sc.subject_id = d.subject_id
    join public.questions q on q.curriculum_node_id = d.id
   where d.node_type = 'learning_indicator' and d.topic_id is not null and (sc.topic_ids is null or d.topic_id = any (sc.topic_ids))
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_listable(q)
     and coalesce(q.source_type, '') not like 'DEV\_%';

  -- Within a subject the questions are taken round-robin across its topics (one from each before a second from any). The candidates (a few more than each subject's
  -- quota) are fixed in a statement of their own, and only then is the expensive full availability check run on them: written as one statement the database applies
  -- the check to the whole pool first (it cannot apply the quota cut-off, which depends on a join, before it).
  create temporary table qb_mix_cand on commit drop as
  with ranked as (select p.question_id, p.subject_id, row_number() over (partition by p.subject_id order by p.rn, random()) as sr from qb_mix_pool p)
  select k.question_id, k.subject_id, k.sr, sc.quota, sc.pos from ranked k join qb_mix_sections sc on sc.subject_id = k.subject_id where k.sr <= sc.quota * 3 + 10;
  create temporary table qb_mix_pick on commit drop as
  with ok as (select c.* from qb_mix_cand c where (select public.qb_question_is_available(q) from public.questions q where q.id = c.question_id)),
  numbered as (select o.*, row_number() over (partition by o.subject_id order by o.sr) as n from ok o)
  select question_id, subject_id, pos from numbered where n <= quota;
  select count(*) into v_used from qb_mix_pick;
  if v_used = 0 then raise exception 'QB_PRACTICE_NO_QUESTIONS'; end if;

  select jsonb_agg(jsonb_build_object('subject', s.title, 'requested', sc.quota, 'given', (select count(*) from qb_mix_pick k where k.subject_id = sc.subject_id)::integer) order by sc.pos),
         case when v_n = 1 then min(s.title) else 'Mixed practice' end, case when v_n = 1 then min(coalesce(s.subject_code, s.title)) else 'MIXED' end
    into v_sections, v_title, v_code
    from qb_mix_sections sc join public.curriculum_nodes s on s.id = sc.subject_id;

  insert into public.assessments(assessment_type, owner_role, owner_user_id, subject_code, subject_name, grade, grade_code, question_count, difficulty,
                                 time_limit_minutes, max_attempts, allow_resume, auto_submit, pass_percent, expires_at, instructions, tenant_id, reference_type)
  values ('PRACTICE', (case when sp.id is not null then 'student' when r = 'TEACHER' then 'teacher' else 'admin' end)::public.qb_role, auth.uid(), v_code, v_title,
          case when exists (select 1 from pg_catalog.pg_enum e where e.enumtypid = 'public.qb_grade'::regtype and e.enumlabel = g) then g::public.qb_grade else null end,
          g, v_used, 'mixed', greatest(5, v_used * 2), 1, true, true, 40, now() + interval '3 days',
          'Your own practice set.', public.qb_public_tenant_id(), 'SELF_PRACTICE')
  returning * into v_assessment;

  insert into public.assessment_questions(assessment_id, question_id, question_order, question_text_snapshot, option_a_snapshot, option_b_snapshot, option_c_snapshot,
                                          option_d_snapshot, correct_answer_snapshot, marks_snapshot, question_content_snapshot, answer_type_snapshot, answer_spec_snapshot)
  select v_assessment.id, q.id,
         row_number() over (order by case when p_order = 'BY_SUBJECT' then p.pos else 0 end, random()),
         q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.marks, q.question_content, q.answer_type, q.answer_spec
    from qb_mix_pick p join public.questions q on q.id = p.question_id;

  return jsonb_build_object('assessment_id', v_assessment.id, 'subject', v_title, 'question_count', v_used, 'requested', v_total, 'short', v_used < v_total, 'sections', v_sections);
end $fn$;
