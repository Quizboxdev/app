-- Topics of one level and subject with how many approved questions each can still give this exam (questions already in it, and their duplicates, are not counted).
create or replace function public.qb_mock_topics(p_curriculum uuid, p_grade text, p_subject text, p_exam uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare v_taken uuid[] := '{}'; v_tenant uuid := public.qb_public_tenant_id();
begin
  perform quizbox_mock.author_kind();
  if p_exam is not null then
    perform quizbox_mock.own_exam(p_exam);
    v_taken := quizbox_mock.taken(p_exam);
  end if;
  return coalesce((select jsonb_agg(x.j order by x.sort_order, x.title) from (
    select t.sort_order, t.title, jsonb_build_object('topic_id', t.id, 'title', t.title, 'strand', quizbox_topic.ancestor_title(n.id, 'strand'), 'sub_strand', quizbox_topic.ancestor_title(n.id, 'sub_strand'),
      'indicator_code', n.code, 'available', a.total, 'available_to_add', a.free, 'easy', a.easy, 'medium', a.medium, 'hard', a.hard,
      'in_exam', exists (select 1 from public.mock_exam_rounds r where r.exam_id = p_exam and r.topic_id = t.id)) as j
    from public.curriculum_topics t join public.curriculum_nodes n on n.id = t.indicator_node_id
    cross join lateral (select count(*)::integer as total, count(*) filter (where not (e.question_id = any (v_taken)))::integer as free,
        count(*) filter (where e.level = 'easy')::integer as easy, count(*) filter (where e.level = 'medium')::integer as medium, count(*) filter (where e.level = 'hard')::integer as hard
        from quizbox_topic.listable_questions(t.id, v_tenant, false) e) a
    where t.curriculum_id = p_curriculum and t.status = 'ACTIVE' and n.subject_code = p_subject and quizbox_mock.canon(coalesce(n.canonical_grade_code, n.grade_code)) = quizbox_mock.canon(p_grade)
    limit 300) x), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The exam itself
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_exam_create(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare k text := quizbox_mock.author_kind(); e public.mock_exams; v_min integer := quizbox_mock.num('mock_exams.min_questions', 5)::integer; v_max integer := quizbox_mock.num('mock_exams.max_questions', 100)::integer; v_total integer;
begin
  if jsonb_typeof(p) is distinct from 'object' or coalesce(p ->> 'desired_total', '') !~ '^[0-9]{1,3}$' then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  v_total := (p ->> 'desired_total')::integer;
  if v_total < v_min or v_total > v_max then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  if not quizbox_mock.curriculum_ok((p ->> 'curriculum_id')::uuid) then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  begin
    insert into public.mock_exams(owner_user_id, owner_kind, title, description, purpose, audience, curriculum_id, target_grade, desired_total, time_limit_minutes, attempts_allowed, shuffle_questions, instructions)
    values (auth.uid(), k, btrim(coalesce(p ->> 'title', '')), btrim(coalesce(p ->> 'description', '')), coalesce(nullif(p ->> 'purpose', ''), 'practice'), btrim(coalesce(p ->> 'audience', '')),
            (p ->> 'curriculum_id')::uuid, quizbox_mock.canon(p ->> 'target_grade'), v_total, coalesce(nullif(p ->> 'time_limit_minutes', '')::integer, 60), coalesce(nullif(p ->> 'attempts_allowed', '')::integer, 1),
            coalesce((p ->> 'shuffle_questions')::boolean, false), btrim(coalesce(p ->> 'instructions', '')))
    returning * into e;
  exception when check_violation or invalid_text_representation then raise exception 'QB_MOCK_INVALID' using errcode = '22023';
  end;
  perform quizbox_core.audit('mock_exam.create', 'mock_exams', e.id, jsonb_build_object('target_grade', e.target_grade));
  return quizbox_mock.exam_json(e);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'QB_MOCK_INVALID' using errcode = '22023';
end $fn$;

create or replace function public.qb_mock_exam_update(p_exam uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam, true); n public.mock_exams; v_total integer; v_target text; v_alloc integer;
begin
  if e.status = 'archived' then raise exception 'QB_MOCK_ARCHIVED' using errcode = '55000'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  v_total := coalesce(nullif(p ->> 'desired_total', '')::integer, e.desired_total);
  v_target := quizbox_mock.canon(coalesce(nullif(p ->> 'target_grade', ''), e.target_grade));
  if v_total < quizbox_mock.num('mock_exams.min_questions', 5) or v_total > quizbox_mock.num('mock_exams.max_questions', 100) then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  select coalesce(sum(requested), 0)::integer into v_alloc from public.mock_exam_rounds where exam_id = e.id;
  if v_total < v_alloc then raise exception 'QB_MOCK_BELOW_ALLOCATED' using errcode = '22023'; end if;
  if p ? 'curriculum_id' and (p ->> 'curriculum_id')::uuid is distinct from e.curriculum_id and v_alloc > 0 then raise exception 'QB_MOCK_CURRICULUM_LOCKED' using errcode = '55000'; end if;
  if p ? 'curriculum_id' and (p ->> 'curriculum_id')::uuid is distinct from e.curriculum_id and not quizbox_mock.curriculum_ok((p ->> 'curriculum_id')::uuid) then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  if v_target is distinct from e.target_grade and exists (select 1 from public.mock_exam_rounds r where r.exam_id = e.id and not quizbox_mock.eligible(v_target, r.grade_code)) then raise exception 'QB_MOCK_ROUNDS_INELIGIBLE' using errcode = '22023'; end if;
  begin
    update public.mock_exams set title = btrim(coalesce(p ->> 'title', title)), description = btrim(coalesce(p ->> 'description', description)), purpose = coalesce(nullif(p ->> 'purpose', ''), purpose),
      audience = btrim(coalesce(p ->> 'audience', audience)), curriculum_id = coalesce(nullif(p ->> 'curriculum_id', '')::uuid, curriculum_id), target_grade = v_target, desired_total = v_total,
      time_limit_minutes = coalesce(nullif(p ->> 'time_limit_minutes', '')::integer, time_limit_minutes), attempts_allowed = coalesce(nullif(p ->> 'attempts_allowed', '')::integer, attempts_allowed),
      shuffle_questions = coalesce((p ->> 'shuffle_questions')::boolean, shuffle_questions), instructions = btrim(coalesce(p ->> 'instructions', instructions)), dirty = true, updated_at = now()
     where id = e.id returning * into n;
  exception when check_violation or invalid_text_representation then raise exception 'QB_MOCK_INVALID' using errcode = '22023';
  end;
  return quizbox_mock.exam_json(n);
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'QB_MOCK_INVALID' using errcode = '22023';
end $fn$;

create or replace function public.qb_mock_exam_list() returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
begin
  perform quizbox_mock.author_kind();
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'purpose', e.purpose, 'target_grade', e.target_grade, 'status', e.status, 'dirty', e.dirty, 'desired_total', e.desired_total,
      'selected', (select count(*) from public.mock_exam_questions q where q.exam_id = e.id), 'version_count', e.version_count, 'updated_at', e.updated_at) order by e.updated_at desc)
    from public.mock_exams e where e.owner_user_id = auth.uid()), '[]'::jsonb);
end $fn$;
