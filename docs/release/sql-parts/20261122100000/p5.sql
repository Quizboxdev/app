create or replace function public.qb_mock_exam_get(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam);
begin
  return quizbox_mock.exam_json(e) || jsonb_build_object('versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version_no', v.version_no, 'published_at', v.published_at, 'question_count', v.question_count, 'total_marks', v.total_marks) order by v.version_no desc)
    from public.mock_exam_versions v where v.exam_id = e.id), '[]'::jsonb));
end $fn$;

-- A draft that was never published and has nothing taking it can be removed; anything else is archived, never deleted.
create or replace function public.qb_mock_exam_delete(p_exam uuid) returns void language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if e.version_count > 0 then raise exception 'QB_MOCK_NOT_DELETABLE' using errcode = '55000'; end if;
  delete from public.mock_exams where id = e.id;
  perform quizbox_core.audit('mock_exam.delete', 'mock_exams', e.id, '{}'::jsonb);
end $fn$;

create or replace function public.qb_mock_exam_archive(p_exam uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if e.status = 'archived' then return quizbox_mock.exam_json(e); end if;
  update public.mock_exams set status = 'archived', archived_at = now(), updated_at = now() where id = e.id returning * into e;
  perform quizbox_core.audit('mock_exam.archive', 'mock_exams', e.id, '{}'::jsonb);
  return quizbox_mock.exam_json(e);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Rounds
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_round_save(p_exam uuid, p_round uuid, p_grade text, p_subject text, p_topic uuid, p_requested integer) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); r public.mock_exam_rounds; g text := quizbox_mock.canon(p_grade); others integer; ok boolean; n integer; keep bigint[];
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if p_requested is null or p_requested < 1 or p_requested > 100 then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  if p_requested > quizbox_mock.num('mock_exams.max_per_topic', 10) then raise exception 'QB_MOCK_TOPIC_CAP: a topic can give at most % questions to one exam', quizbox_mock.num('mock_exams.max_per_topic', 10)::integer using errcode = '22023'; end if;
  if not quizbox_mock.eligible(e.target_grade, g) then raise exception 'QB_MOCK_LEVEL_NOT_ELIGIBLE' using errcode = '22023'; end if;
  select exists (select 1 from public.curriculum_topics t join public.curriculum_nodes nn on nn.id = t.indicator_node_id
                  where t.id = p_topic and t.status = 'ACTIVE' and t.curriculum_id = e.curriculum_id and nn.subject_code = p_subject and quizbox_mock.canon(coalesce(nn.canonical_grade_code, nn.grade_code)) = g) into ok;
  if not ok then raise exception 'QB_MOCK_TOPIC_INVALID' using errcode = '22023'; end if;
  select coalesce(sum(requested), 0)::integer into others from public.mock_exam_rounds where exam_id = e.id and id is distinct from p_round;
  if others + p_requested > e.desired_total then raise exception 'QB_MOCK_OVER_ALLOCATED: % of % questions are already allocated, so at most % can be added', others, e.desired_total, e.desired_total - others using errcode = '22023'; end if;
  begin
    if p_round is null then
      if (select count(*) from public.mock_exam_rounds where exam_id = e.id) >= quizbox_mock.num('mock_exams.max_rounds', 30) then raise exception 'QB_MOCK_TOO_MANY_ROUNDS' using errcode = '22023'; end if;
      insert into public.mock_exam_rounds(exam_id, position, grade_code, subject_code, topic_id, requested)
      values (e.id, coalesce((select max(position) from public.mock_exam_rounds where exam_id = e.id), 0) + 1, g, p_subject, p_topic, p_requested) returning * into r;
    else
      select * into r from public.mock_exam_rounds where id = p_round and exam_id = e.id for update;
      if r.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
      if r.topic_id <> p_topic then delete from public.mock_exam_questions where round_id = r.id; end if;
      update public.mock_exam_rounds set grade_code = g, subject_code = p_subject, topic_id = p_topic, requested = p_requested where id = r.id returning * into r;
      select count(*) into n from public.mock_exam_questions where round_id = r.id;
      if n > p_requested then   -- fewer questions wanted: keep the first ones chosen
        select array_agg(seq) into keep from (select seq from public.mock_exam_questions where round_id = r.id order by seq limit p_requested) k;
        delete from public.mock_exam_questions where round_id = r.id and not (seq = any (keep));
      end if;
    end if;
  exception when unique_violation then raise exception 'QB_MOCK_TOPIC_IN_USE' using errcode = '22023';
  end;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return quizbox_mock.exam_json(e);
end $fn$;

create or replace function public.qb_mock_round_delete(p_exam uuid, p_round uuid) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true);
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  delete from public.mock_exam_rounds where id = p_round and exam_id = e.id;
  if not found then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  update public.mock_exam_rounds set position = x.rn from (select id, row_number() over (order by position)::integer as rn from public.mock_exam_rounds where exam_id = e.id) x where public.mock_exam_rounds.id = x.id and public.mock_exam_rounds.position <> x.rn;
  update public.mock_exams set dirty = true, updated_at = now() where id = e.id returning * into e;
  return quizbox_mock.exam_json(e);
end $fn$;
