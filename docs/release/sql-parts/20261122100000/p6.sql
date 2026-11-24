-- Chooses the missing questions of a round from its own topic (difficulty split, one per concept first), never one already in the exam or a duplicate of one. If the topic cannot supply them
-- QB_TOPIC_SHORT is raised and nothing changes.
create or replace function public.qb_mock_round_pick(p_exam uuid, p_round uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); r public.mock_exam_rounds; need integer; pass integer := 0; picked jsonb; qid uuid; v_title text; v_tenant uuid := public.qb_public_tenant_id(); added integer := 0;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  select * into r from public.mock_exam_rounds where id = p_round and exam_id = e.id for update;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select title into v_title from public.curriculum_topics where id = r.topic_id;
  loop
    pass := pass + 1;
    select r.requested - count(*) into need from public.mock_exam_questions where round_id = r.id;
    exit when need <= 0;
    if pass > 3 then raise exception 'QB_TOPIC_SHORT: % cannot supply % more different questions', v_title, need; end if;
    picked := quizbox_topic.pick_for_topic(r.topic_id, v_title, need, null, v_tenant, false, quizbox_mock.taken(e.id));
    for qid in select value::uuid from jsonb_array_elements_text(picked -> 'picked') loop
      insert into public.mock_exam_questions(exam_id, round_id, question_id, picked_by)
      select e.id, r.id, q.id, 'auto' from public.questions q where q.id = qid
         and not exists (select 1 from public.mock_exam_questions s join public.questions q2 on q2.id = s.question_id where s.exam_id = e.id and quizbox_mock.dup_key(q2) = quizbox_mock.dup_key(q));
      if found then added := added + 1; end if;
    end loop;
  end loop;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return jsonb_build_object('added', added, 'exam', quizbox_mock.exam_json(e));
end $fn$;

create or replace function public.qb_mock_round_clear(p_exam uuid, p_round uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if not exists (select 1 from public.mock_exam_rounds where id = p_round and exam_id = e.id) then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  delete from public.mock_exam_questions where round_id = p_round;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return quizbox_mock.exam_json(e);
end $fn$;

-- The eligible questions of a round's topic, for choosing by hand. Questions the full availability check refuses are not listed.
create or replace function public.qb_mock_round_candidates(p_exam uuid, p_round uuid, p_limit integer default 60, p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); r public.mock_exam_rounds; v_tenant uuid := public.qb_public_tenant_id(); v_taken uuid[] := quizbox_mock.taken(p_exam);
begin
  select * into r from public.mock_exam_rounds where id = p_round and exam_id = e.id;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(x.j order by x.ord) from (
    select row_number() over (order by q.id) as ord, jsonb_build_object('id', q.id, 'question_text', left(q.question_text, 400), 'answer_type', coalesce(q.answer_type, 'SINGLE_CHOICE'), 'marks', q.marks, 'level', l.level,
      'in_round', exists (select 1 from public.mock_exam_questions s where s.round_id = r.id and s.question_id = q.id),
      'blocked', q.id = any (v_taken) and not exists (select 1 from public.mock_exam_questions s where s.round_id = r.id and s.question_id = q.id)) as j
    from quizbox_topic.listable_questions(r.topic_id, v_tenant, false) l join public.questions q on q.id = l.question_id
    where public.qb_question_is_available(q) order by q.id limit least(greatest(coalesce(p_limit, 60), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb);
end $fn$;

-- Replaces the round's questions with exactly these ones, chosen by hand. Each must belong to the round's topic, be available, and not repeat (or duplicate) a question elsewhere in the exam.
create or replace function public.qb_mock_round_set_questions(p_exam uuid, p_round uuid, p_question_ids uuid[]) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); r public.mock_exam_rounds; qid uuid; v_tenant uuid := public.qb_public_tenant_id(); keys text[] := '{}'; k text; q public.questions;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  select * into r from public.mock_exam_rounds where id = p_round and exam_id = e.id for update;
  if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  p_question_ids := coalesce(p_question_ids, '{}');
  if cardinality(p_question_ids) > r.requested then raise exception 'QB_MOCK_QUESTION_INVALID: % chosen, only % wanted in this round', cardinality(p_question_ids), r.requested using errcode = '22023'; end if;
  delete from public.mock_exam_questions where round_id = r.id;
  select coalesce(array_agg(quizbox_mock.dup_key(q2)), '{}') into keys from public.mock_exam_questions s join public.questions q2 on q2.id = s.question_id where s.exam_id = e.id;
  foreach qid in array p_question_ids loop
    select * into q from public.questions where id = qid;
    if q.id is null or not exists (select 1 from quizbox_topic.listable_questions(r.topic_id, v_tenant, false) l where l.question_id = qid) or not public.qb_question_is_available(q) then raise exception 'QB_MOCK_QUESTION_INVALID' using errcode = '22023'; end if;
    k := quizbox_mock.dup_key(q);
    if k = any (keys) then raise exception 'QB_MOCK_QUESTION_INVALID: a question is repeated or duplicates another in this exam' using errcode = '22023'; end if;
    keys := keys || k;
    insert into public.mock_exam_questions(exam_id, round_id, question_id, picked_by) values (e.id, r.id, qid, 'manual');
  end loop;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return quizbox_mock.exam_json(e);
end $fn$;
