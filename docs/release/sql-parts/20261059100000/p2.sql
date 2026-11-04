-- Copy questions into a draft from one or more subjects: p_sections = [{subject, quota, topic_ids?}]. 1 to 8 subjects, 1 to 100 questions in all per pull.
create or replace function public.challenge_pull_bank_sections(p_id uuid, p_sections jsonb, p_grade text default null, p_stage integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare
  c public.challenge_campaigns; sp public.student_profiles; g text; m uuid; sec jsonb; seen uuid[] := '{}'; subj_id uuid; v_n integer; v_total integer := 0; v_found integer;
  have integer; v_used integer; v_sections jsonb;
begin
  c := public.qb_challenge_owned(p_id);
  if c.status <> 'DRAFT' then raise exception 'ONLY_DRAFT_EDITABLE' using errcode = '55000'; end if;
  if p_stage not between 1 and c.stage_count then raise exception 'INVALID_QUESTIONS' using errcode = '22023'; end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'array' then raise exception 'BANK_PICK_INVALID' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_sections);
  if v_n < 1 or v_n > 8 then raise exception 'BANK_PICK_INVALID' using errcode = '22023'; end if;
  for sec in select value from jsonb_array_elements(p_sections) loop
    if jsonb_typeof(sec) <> 'object' or coalesce(sec ->> 'subject', '') !~ '^[0-9a-fA-F-]{36}$' or coalesce(sec ->> 'quota', '') !~ '^[0-9]{1,3}$' or (sec ->> 'quota')::integer < 1 then raise exception 'BANK_PICK_INVALID' using errcode = '22023'; end if;
    subj_id := (sec ->> 'subject')::uuid;
    if subj_id = any (seen) then raise exception 'BANK_PICK_INVALID' using errcode = '22023'; end if;
    if jsonb_typeof(sec -> 'topic_ids') = 'array' and jsonb_array_length(sec -> 'topic_ids') > 40 then raise exception 'BANK_PICK_INVALID' using errcode = '22023'; end if;
    seen := seen || subj_id; v_total := v_total + (sec ->> 'quota')::integer;
  end loop;
  if v_total not between 1 and 100 then raise exception 'BANK_PICK_INVALID' using errcode = '22023'; end if;

  select * into sp from public.student_profiles where user_id = auth.uid();
  select default_market_id into m from public.profiles where id = auth.uid();
  if sp.id is not null then
    g := upper(coalesce(nullif(sp.grade_code, ''), sp.grade::text));
    if g = 'B10' then g := 'SHS1'; end if;
  else
    g := upper(nullif(btrim(coalesce(p_grade, '')), ''));
    if g is null then raise exception 'BANK_GRADE_REQUIRED' using errcode = '22023'; end if;
  end if;
  if v_n > 1 and quizbox_topic.class_level(g, null) not in ('PRIMARY', 'JHS') then raise exception 'BANK_COMBINED_LEVEL_NOT_ALLOWED' using errcode = '22023'; end if;
  select count(*) into v_found from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
   where n.id = any (seen) and n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m);
  if v_found <> cardinality(seen) then raise exception 'BANK_SUBJECT_UNAVAILABLE' using errcode = '22023'; end if;

  create temporary table qb_cb_sections on commit drop as
  select (s.value ->> 'subject')::uuid as subject_id, (s.value ->> 'quota')::integer as quota, s.ordinality::integer as pos,
         case when jsonb_typeof(s.value -> 'topic_ids') = 'array' and jsonb_array_length(s.value -> 'topic_ids') > 0
              then array(select jsonb_array_elements_text(s.value -> 'topic_ids'))::uuid[] end as topic_ids
    from jsonb_array_elements(p_sections) with ordinality as s(value, ordinality);

  -- Usable questions only: approved, listable, not a development question, a single-choice question with four options, and not already in this draft.
  create temporary table qb_cb_pool on commit drop as
  with recursive down(id, subject_id, topic_id, node_type, depth) as (
    select n.id, n.id, null::uuid, n.node_type, 0
      from public.curriculum_nodes n join public.market_curricula mc on mc.curriculum_id = n.curriculum_id and mc.active
     where n.is_active and n.node_type = 'subject' and upper(coalesce(n.canonical_grade_code, n.grade_code)) = g and (m is null or mc.market_id = m) and n.id = any (seen)
    union all
    select ch.id, d.subject_id, case when ch.node_type = 'sub_strand' then ch.id else d.topic_id end, ch.node_type, d.depth + 1
      from down d join public.curriculum_nodes ch on ch.parent_id = d.id where ch.is_active and d.depth < 8)
  select q.id as question_id, d.subject_id, d.topic_id, row_number() over (partition by d.subject_id, d.topic_id order by random()) as rn
    from down d join qb_cb_sections sc on sc.subject_id = d.subject_id
    join public.questions q on q.curriculum_node_id = d.id
   where d.node_type = 'learning_indicator' and d.topic_id is not null and (sc.topic_ids is null or d.topic_id = any (sc.topic_ids))
     and q.status::text = 'active' and lower(coalesce(q.validation_status, '')) in ('approved', 'validated') and public.qb_question_is_listable(q)
     and q.answer_type = 'SINGLE_CHOICE' and q.option_c is not null and q.option_d is not null and upper(q.correct_answer) in ('A', 'B', 'C', 'D')
     and coalesce(q.source_type, '') not like 'DEV\_%'
     and not exists (select 1 from public.challenge_questions cq where cq.campaign_id = p_id and cq.source_question_id = q.id);

  -- Round-robin across a subject's topics. Candidates (a few more than the quota) are fixed in their own statement; only then is the full check run on them.
  create temporary table qb_cb_cand on commit drop as
  with ranked as (select p.question_id, p.subject_id, row_number() over (partition by p.subject_id order by p.rn, random()) as sr from qb_cb_pool p)
  select k.question_id, k.subject_id, k.sr, sc.quota, sc.pos from ranked k join qb_cb_sections sc on sc.subject_id = k.subject_id where k.sr <= sc.quota * 3 + 10;
  create temporary table qb_cb_pick on commit drop as
  with ok as (select x.* from qb_cb_cand x where (select public.qb_question_is_available(q) from public.questions q where q.id = x.question_id)),
  numbered as (select o.*, row_number() over (partition by o.subject_id order by o.sr) as n from ok o)
  select question_id, subject_id, pos from numbered where n <= quota;
  select count(*) into v_used from qb_cb_pick;

  select coalesce(max(position), 0) into have from public.challenge_questions where campaign_id = p_id;
  if have + v_used > 300 then raise exception 'BANK_CAMPAIGN_FULL' using errcode = '22023'; end if;
  insert into public.challenge_questions(campaign_id, position, question_text, options, correct_index, explanation, source_question_id, stage_no)
  select p_id, have + row_number() over (order by random()), q.question_text, jsonb_build_array(q.option_a, q.option_b, q.option_c, q.option_d), ascii(upper(q.correct_answer)) - 65, q.explanation, q.id, p_stage
    from qb_cb_pick k join public.questions q on q.id = k.question_id;

  select jsonb_agg(jsonb_build_object('subject', s.title, 'requested', sc.quota, 'given', (select count(*) from qb_cb_pick k where k.subject_id = sc.subject_id)::integer) order by sc.pos)
    into v_sections from qb_cb_sections sc join public.curriculum_nodes s on s.id = sc.subject_id;
  perform public.qb_challenge_audit('challenge_bank_pulled', p_id, jsonb_build_object('added', v_used, 'sections', v_sections, 'stage', p_stage));
  return jsonb_build_object('ok', true, 'added', v_used, 'total', have + v_used, 'requested', v_total, 'sections', v_sections);
end $fn$;
