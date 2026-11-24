-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Health and class assignment
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_exam_health(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam);
begin
  return jsonb_build_object('version_no', (select version_no from public.mock_exam_versions where id = e.current_version_id), 'stale_questions', case when e.current_version_id is null then 0 else quizbox_mock.stale(e.current_version_id) end);
end $fn$;

-- The classes this author teaches, with their level, so the screen can show only those that fit the exam.
create or replace function public.qb_mock_class_options() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_mock.author_kind();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'class_name', c.class_name, 'grade_label', c.grade_label, 'grade_code', coalesce(nullif(c.grade_code, ''), c.grade::text),
      'stage', quizbox_topic.class_level(coalesce(nullif(c.grade_code, ''), c.grade::text), c.education_level),
      'learners', (select count(*) from public.class_memberships m where m.class_id = c.id and m.status::text = 'active')) order by c.class_name)
    from public.classes c where c.teacher_user_id = auth.uid() and c.status::text = 'active'), '[]'::jsonb);
end $fn$;

create or replace function public.qb_mock_assign_class(p_exam uuid, p_class uuid, p_start timestamptz default now(), p_due timestamptz default null, p_targets uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); v public.mock_exam_versions; c public.classes; published jsonb; v_nodes uuid[]; v_ids uuid[]; v_stale integer;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if e.owner_kind = 'sponsor' then raise exception 'QB_MOCK_CLASS_ONLY_TEACHERS' using errcode = '42501'; end if;
  if e.current_version_id is null then raise exception 'QB_MOCK_NOT_PUBLISHED' using errcode = '55000'; end if;
  select * into v from public.mock_exam_versions where id = e.current_version_id;
  select * into c from public.classes where id = p_class;
  if c.id is null or not (c.teacher_user_id = auth.uid() or public.qb_can_manage_class(c.id)) then raise exception 'QB_MOCK_CLASS_FORBIDDEN' using errcode = '42501'; end if;
  if quizbox_topic.class_level(coalesce(nullif(c.grade_code, ''), c.grade::text), c.education_level) is distinct from quizbox_mock.stage(v.target_grade) then raise exception 'QB_MOCK_CLASS_LEVEL_MISMATCH' using errcode = '22023'; end if;
  if p_due is not null and p_due <= coalesce(p_start, now()) then raise exception 'QB_MOCK_DATES_INVALID' using errcode = '22023'; end if;
  v_stale := quizbox_mock.stale(v.id);
  if v_stale > 0 then raise exception 'QB_MOCK_VERSION_STALE: % question(s) changed or were withdrawn since version % was published', v_stale, v.version_no using errcode = '55000'; end if;
  select array_agg(vq.question_id order by vq.position), array_agg(distinct vq.curriculum_node_id) filter (where vq.curriculum_node_id is not null) into v_ids, v_nodes from public.mock_exam_version_questions vq where vq.version_id = v.id;
  published := public.qb_publish_assignment(c.id, v.title, left(concat_ws(E'\n', nullif(v.description, ''), nullif(v.instructions, '')), 1000), v_nodes, v.question_count, null, 'MANUAL', v_ids, 'ASSESSMENT',
                                            v.attempts_allowed, v.time_limit_minutes, coalesce(p_start, now()), p_due, p_targets, null, null);
  insert into public.mock_exam_assignments(exam_id, version_id, assignment_id, class_id, created_by) values (e.id, v.id, (published ->> 'assignment_id')::uuid, c.id, auth.uid());
  perform quizbox_core.audit('mock_exam.assign', 'mock_exams', e.id, jsonb_build_object('class', c.id, 'version', v.version_no, 'assignment', published ->> 'assignment_id'));
  return published || jsonb_build_object('version_no', v.version_no, 'exam_id', e.id);
end $fn$;

create or replace function public.qb_mock_exam_assignments(p_exam uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('assignment_id', ma.assignment_id, 'class_id', ma.class_id, 'class_name', c.class_name, 'version_no', v.version_no, 'due_at', x.due_at, 'status', x.status::text,
      'learners', (select count(*) from public.assignment_targets t where t.assignment_id = x.id and t.status::text = 'active'), 'created_at', ma.created_at) order by ma.created_at desc)
    from public.mock_exam_assignments ma join public.assignments x on x.id = ma.assignment_id join public.classes c on c.id = ma.class_id join public.mock_exam_versions v on v.id = ma.version_id
    where ma.exam_id = e.id and (x.teacher_user_id = auth.uid() or public.qb_can_manage_class(x.class_id))), '[]'::jsonb);
end $fn$;
