-- Mock exams, part 2 of 3: delivery to a class, and results. Needs 20261122100000_mock_exams_authoring.sql.
--   qb_mock_assign_class   assigns the exam's CURRENT PUBLISHED VERSION to a class the author teaches, through the one existing publisher (qb_publish_assignment, MANUAL mode), so students take it in
--                          their normal assignments and the existing engine does the attempts, late rules, time limit and scoring. The link (mock_exam_assignments) records which version went to which class.
--                          Refused when a question has changed or been withdrawn since the version was published (the engine would copy the live question); the author publishes the next version instead.
--   qb_mock_results        participation, completion and score statistics, per-question results and the participant list, for the exam's owner only.
--   qb_mock_result_rows    one row per attempt and question (the student-by-question review), filterable, paged.
--   qb_mock_export         the same rows as an export dataset (CSV or Excel is built by the server route), limited, audited.
-- A teacher sees only attempts on assignments they own or manage. Marketplace attempts (next migration) appear as "Buyer 1, 2, ..." with no name, email or school.
-- Additive. Rollback: supabase/rollback/mock_exams_delivery.sql.
-- Errors: QB_MOCK_NOT_PUBLISHED, QB_MOCK_CLASS_ONLY_TEACHERS, QB_MOCK_CLASS_FORBIDDEN, QB_MOCK_CLASS_LEVEL_MISMATCH, QB_MOCK_VERSION_STALE, QB_MOCK_DATES_INVALID, QB_MOCK_ARCHIVED, QB_NOT_FOUND.
begin;

create table if not exists public.mock_exam_assignments (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.mock_exams(id) on delete restrict,
  version_id uuid not null references public.mock_exam_versions(id) on delete restrict,
  assignment_id uuid not null unique references public.assignments(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists mock_exam_assignments_exam on public.mock_exam_assignments(exam_id, created_at desc);

-- One row per purchase that opened a private copy of a version for a buyer (filled by the marketplace migration; results read it).
create table if not exists public.mock_exam_enrolments (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.mock_exams(id) on delete restrict,
  version_id uuid not null references public.mock_exam_versions(id) on delete restrict,
  student_user_id uuid not null references public.profiles(id) on delete restrict,
  purchase_id uuid not null unique,
  assessment_id uuid not null unique references public.assessments(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists mock_exam_enrolments_exam on public.mock_exam_enrolments(exam_id, created_at);
alter table public.mock_exam_assignments enable row level security; alter table public.mock_exam_enrolments enable row level security;
revoke all on public.mock_exam_assignments, public.mock_exam_enrolments from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- How many questions of a version no longer match the live question (edited, so a new version number) or are no longer available.
create or replace function quizbox_mock.stale(p_version uuid) returns integer language sql stable security definer set search_path = '' as $fn$
  select count(*)::integer from public.mock_exam_version_questions vq left join public.questions q on q.id = vq.question_id
   where vq.version_id = p_version and (q.id is null or q.version is distinct from vq.question_version or not coalesce(public.qb_question_is_available(q), false))
$fn$;

-- A learner's answer and the correct answer as readable text, for the review and the export.
create or replace function quizbox_mock.option_text(vq public.mock_exam_version_questions, p_letter text) returns text language sql immutable set search_path = '' as $fn$
  select case upper(coalesce(p_letter, '')) when 'A' then vq.option_a when 'B' then vq.option_b when 'C' then vq.option_c when 'D' then vq.option_d end
$fn$;
create or replace function quizbox_mock.answer_text(vq public.mock_exam_version_questions, p_letter text, p_value jsonb) returns text language sql immutable set search_path = '' as $fn$
  select case
    when upper(coalesce(vq.answer_type, 'SINGLE_CHOICE')) in ('SINGLE_CHOICE', 'TRUE_FALSE') then case when p_letter is null then null else upper(p_letter) || coalesce(': ' || quizbox_mock.option_text(vq, p_letter), '') end
    when upper(vq.answer_type) = 'MULTIPLE_CHOICE' then (select string_agg(upper(o) || coalesce(': ' || quizbox_mock.option_text(vq, o), ''), '; ' order by o) from jsonb_array_elements_text(coalesce(p_value -> 'options', '[]'::jsonb)) o)
    when upper(vq.answer_type) = 'FRACTION' then case when p_value is null then null else (p_value ->> 'numerator') || '/' || (p_value ->> 'denominator') end
    else p_value ->> 'value' end
$fn$;
create or replace function quizbox_mock.correct_text(vq public.mock_exam_version_questions) returns text language sql immutable set search_path = '' as $fn$
  select case
    when upper(coalesce(vq.answer_type, 'SINGLE_CHOICE')) in ('SINGLE_CHOICE', 'TRUE_FALSE') then vq.correct_answer || coalesce(': ' || quizbox_mock.option_text(vq, vq.correct_answer), '')
    when upper(vq.answer_type) = 'MULTIPLE_CHOICE' then (select string_agg(upper(o) || coalesce(': ' || quizbox_mock.option_text(vq, o), ''), '; ' order by o) from jsonb_array_elements_text(coalesce(vq.answer_spec -> 'correct_options', '[]'::jsonb)) o)
    when upper(vq.answer_type) = 'FRACTION' then (vq.answer_spec ->> 'numerator') || '/' || (vq.answer_spec ->> 'denominator')
    else coalesce(vq.answer_spec ->> 'value', vq.answer_spec ->> 'canonical', vq.answer_spec #>> '{accepted,0}') end
$fn$;

-- Every attempt the caller may see for an exam: class attempts on assignments they own or manage (with the learner's name), and marketplace attempts without any identity.
create or replace function quizbox_mock.attempt_rows(p_exam uuid) returns table(attempt_id uuid, source text, group_label text, class_id uuid, participant_key uuid, participant text, attempt_no integer, state text,
  started_at timestamptz, submitted_at timestamptz, score numeric, total_marks numeric, percentage numeric, assessment_id uuid, version_id uuid)
language sql stable security definer set search_path = '' as $fn$
  select a.id, 'class'::text, c.class_name, x.class_id, a.student_user_id, coalesce(p.full_name, 'Learner'),
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, ma.version_id
    from public.mock_exam_assignments ma join public.assignments x on x.id = ma.assignment_id join public.attempts a on a.assignment_id = x.id
    join public.classes c on c.id = x.class_id left join public.profiles p on p.id = a.student_user_id
   where ma.exam_id = p_exam and (x.teacher_user_id = auth.uid() or public.qb_can_manage_class(x.class_id))
  union all
  select a.id, 'market'::text, 'Marketplace', null::uuid, a.student_user_id, 'Buyer ' || (dense_rank() over (order by en.created_at, en.id))::text,
         (row_number() over (partition by a.student_user_id, a.assessment_id order by a.started_at))::integer, a.status::text, a.started_at, a.submitted_at, a.score, a.total_marks, a.percentage, a.assessment_id, en.version_id
    from public.mock_exam_enrolments en join public.attempts a on a.assessment_id = en.assessment_id
   where en.exam_id = p_exam
$fn$;

revoke all on function quizbox_mock.stale(uuid), quizbox_mock.option_text(public.mock_exam_version_questions, text), quizbox_mock.answer_text(public.mock_exam_version_questions, text, jsonb),
  quizbox_mock.correct_text(public.mock_exam_version_questions), quizbox_mock.attempt_rows(uuid) from public, anon, authenticated;

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

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_mock_results(p_exam uuid, p_version uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); v public.mock_exam_versions; v_id uuid; assigned integer; res jsonb;
begin
  v_id := coalesce(p_version, e.current_version_id);
  if v_id is null then
    return jsonb_build_object('exam', jsonb_build_object('id', e.id, 'title', e.title, 'status', e.status), 'version', null, 'versions', '[]'::jsonb, 'summary', null, 'questions', '[]'::jsonb, 'participants', '[]'::jsonb);
  end if;
  select * into v from public.mock_exam_versions where id = v_id and exam_id = e.id;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  select (select count(distinct t.membership_id) from public.mock_exam_assignments ma join public.assignments x on x.id = ma.assignment_id join public.assignment_targets t on t.assignment_id = x.id and t.status::text = 'active'
           where ma.exam_id = e.id and ma.version_id = v.id and (x.teacher_user_id = auth.uid() or public.qb_can_manage_class(x.class_id)))
       + (select count(*) from public.mock_exam_enrolments en where en.exam_id = e.id and en.version_id = v.id) into assigned;
  with a as (select * from quizbox_mock.attempt_rows(e.id) r where r.version_id = v.id),
  fin as (select * from a where state in ('submitted', 'expired') and score is not null),
  last as (select distinct on (source, participant_key) * from fin order by source, participant_key, started_at desc),
  pstat as (select count(distinct (source, participant_key))::integer as started, count(distinct (source, participant_key)) filter (where state in ('submitted', 'expired'))::integer as finished,
                   count(distinct (source, participant_key)) filter (where state = 'in_progress')::integer as in_progress from a),
  summ as (select count(*)::integer as n, round(avg(percentage), 1) as average, round((percentile_cont(0.5) within group (order by percentage))::numeric, 1) as median, max(percentage) as highest, min(percentage) as lowest from last),
  qs as (select vq.position, vq.question_id, vq.external_id, vq.question_text, vq.subject_code, vq.grade_code, vq.answer_type, vq.marks,
                count(rr.id)::integer as answered, count(rr.id) filter (where rr.is_correct)::integer as correct
           from public.mock_exam_version_questions vq left join (select r.attempt_id, r.question_id, r.id, r.is_correct from public.responses r join fin f on f.attempt_id = r.attempt_id) rr on rr.question_id = vq.question_id
          where vq.version_id = v.id group by vq.position, vq.question_id, vq.external_id, vq.question_text, vq.subject_code, vq.grade_code, vq.answer_type, vq.marks)
  select jsonb_build_object(
    'exam', jsonb_build_object('id', e.id, 'title', e.title, 'status', e.status, 'purpose', e.purpose, 'target_grade', e.target_grade),
    'version', jsonb_build_object('id', v.id, 'version_no', v.version_no, 'question_count', v.question_count, 'total_marks', v.total_marks, 'published_at', v.published_at),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'version_no', x.version_no) order by x.version_no desc) from public.mock_exam_versions x where x.exam_id = e.id), '[]'::jsonb),
    'summary', jsonb_build_object('assigned', assigned, 'started', (select started from pstat), 'finished', (select finished from pstat), 'in_progress', (select in_progress from pstat),
      'not_started', greatest(assigned - (select started from pstat), 0), 'completion_percent', case when assigned > 0 then round(100.0 * (select finished from pstat) / assigned, 1) end,
      'average_percent', (select average from summ), 'median_percent', (select median from summ), 'highest_percent', (select highest from summ), 'lowest_percent', (select lowest from summ), 'scored', (select n from summ)),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('position', q.position, 'question_id', q.question_id, 'external_id', q.external_id, 'question_text', left(q.question_text, 300), 'subject_code', q.subject_code,
        'grade_code', q.grade_code, 'answer_type', q.answer_type, 'marks', q.marks, 'answered', q.answered, 'correct', q.correct, 'correct_percent', case when q.answered > 0 then round(100.0 * q.correct / q.answered, 1) end) order by q.position) from qs q), '[]'::jsonb),
    'participants', coalesce((select jsonb_agg(p.j order by p.sort_name, p.started_at) from (
        select a.participant as sort_name, a.started_at, jsonb_build_object('attempt_id', a.attempt_id, 'source', a.source, 'group', a.group_label, 'class_id', a.class_id, 'participant_key', a.participant_key, 'participant', a.participant,
          'attempt_no', a.attempt_no, 'state', a.state, 'started_at', a.started_at, 'submitted_at', a.submitted_at, 'score', a.score, 'total_marks', a.total_marks, 'percent', a.percentage) as j from a
        union all
        select p2.full_name, null::timestamptz, jsonb_build_object('attempt_id', null, 'source', 'class', 'group', c.class_name, 'class_id', c.id, 'participant_key', m.student_user_id, 'participant', coalesce(p2.full_name, 'Learner'),
          'attempt_no', 0, 'state', 'not_started', 'started_at', null, 'submitted_at', null, 'score', null, 'total_marks', null, 'percent', null)
          from public.mock_exam_assignments ma join public.assignments x on x.id = ma.assignment_id join public.assignment_targets t on t.assignment_id = x.id and t.status::text = 'active'
          join public.class_memberships m on m.id = t.membership_id join public.classes c on c.id = x.class_id left join public.profiles p2 on p2.id = m.student_user_id
         where ma.exam_id = e.id and ma.version_id = v.id and (x.teacher_user_id = auth.uid() or public.qb_can_manage_class(x.class_id))
           and not exists (select 1 from a where a.source = 'class' and a.participant_key = m.student_user_id and a.class_id = c.id)) p), '[]'::jsonb)) into res;
  return res;
end $fn$;

-- The student-by-question review: one row per attempt and question of the chosen version, with the learner's answer, the correct answer, correctness and marks.
create or replace function quizbox_mock.result_rows(p_exam uuid, p_version uuid, p_class uuid, p_student uuid, p_question uuid, p_state text) returns table(r jsonb)
language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('attempt_id', a.attempt_id, 'group', a.group_label, 'participant', a.participant, 'participant_key', a.participant_key, 'attempt_no', a.attempt_no, 'state', a.state,
      'started_at', a.started_at, 'submitted_at', a.submitted_at, 'attempt_score', a.score, 'attempt_total', a.total_marks, 'attempt_percent', a.percentage,
      'position', vq.position, 'presented_order', aq.question_order, 'question_id', vq.question_id, 'external_id', vq.external_id, 'question_text', vq.question_text, 'subject_code', vq.subject_code, 'grade_code', vq.grade_code,
      'answer_type', vq.answer_type, 'answer', quizbox_mock.answer_text(vq, rr.selected_answer, rr.selected_value), 'correct_answer', quizbox_mock.correct_text(vq),
      'is_correct', case when rr.id is null then null else rr.is_correct end, 'marks_awarded', coalesce(rr.marks_awarded, 0), 'marks', vq.marks, 'answered', rr.id is not null)
  from quizbox_mock.attempt_rows(p_exam) a join public.mock_exam_version_questions vq on vq.version_id = a.version_id
  left join public.responses rr on rr.attempt_id = a.attempt_id and rr.question_id = vq.question_id
  left join public.assessment_questions aq on aq.assessment_id = a.assessment_id and aq.question_id = vq.question_id
  where a.version_id = p_version and (p_class is null or a.class_id = p_class) and (p_student is null or a.participant_key = p_student) and (p_question is null or vq.question_id = p_question)
    and (p_state is null or a.state = p_state)
  order by a.participant, a.started_at, vq.position
$fn$;
revoke all on function quizbox_mock.result_rows(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;

create or replace function public.qb_mock_result_rows(p_exam uuid, p_version uuid default null, p_class uuid default null, p_student uuid default null, p_question uuid default null, p_state text default null,
  p_limit integer default 200, p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); v_id uuid := coalesce(p_version, e.current_version_id); v_cap integer := quizbox_mock.num('mock_exams.export_row_limit', 50000)::integer;
begin
  if p_state is not null and p_state not in ('submitted', 'in_progress', 'expired') then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  if v_id is null or not exists (select 1 from public.mock_exam_versions where id = v_id and exam_id = e.id) then return jsonb_build_object('total', 0, 'rows', '[]'::jsonb); end if;
  return jsonb_build_object('total', (select count(*) from quizbox_mock.result_rows(e.id, v_id, p_class, p_student, p_question, p_state)),
    'rows', coalesce((select jsonb_agg(x.r) from (select r from quizbox_mock.result_rows(e.id, v_id, p_class, p_student, p_question, p_state) limit least(greatest(coalesce(p_limit, 200), 1), v_cap) offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb));
end $fn$;

-- The export dataset in the shape the admin export route already formats (columns, rows, total, truncated). Times are UTC "YYYY-MM-DD HH24:MI:SS" so Excel gets real dates. Audited.
create or replace function public.qb_mock_export(p_exam uuid, p_version uuid default null, p_class uuid default null, p_student uuid default null, p_question uuid default null, p_state text default null,
  p_limit integer default 50000) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare e public.mock_exams := quizbox_mock.own_exam(p_exam); v public.mock_exam_versions; v_cap integer := quizbox_mock.num('mock_exams.export_row_limit', 50000)::integer; v_limit integer; v_total integer; v_rows jsonb;
  ts text := 'YYYY-MM-DD HH24:MI:SS';
begin
  if p_state is not null and p_state not in ('submitted', 'in_progress', 'expired') then raise exception 'QB_MOCK_INVALID' using errcode = '22023'; end if;
  select * into v from public.mock_exam_versions where id = coalesce(p_version, e.current_version_id) and exam_id = e.id;
  if v.id is null then raise exception 'QB_NOT_FOUND' using errcode = 'P0002'; end if;
  v_limit := least(greatest(coalesce(p_limit, v_cap), 1), v_cap);
  select count(*) into v_total from quizbox_mock.result_rows(e.id, v.id, p_class, p_student, p_question, p_state);
  select coalesce(jsonb_agg(jsonb_build_array(e.title, v.version_no, e.purpose, v.target_grade, x.r ->> 'group', x.r ->> 'participant', (x.r ->> 'attempt_no')::integer, x.r ->> 'state',
      to_char((x.r ->> 'started_at')::timestamptz at time zone 'UTC', ts), to_char((x.r ->> 'submitted_at')::timestamptz at time zone 'UTC', ts), (x.r ->> 'attempt_score')::numeric, (x.r ->> 'attempt_total')::numeric,
      (x.r ->> 'attempt_percent')::numeric, (x.r ->> 'position')::integer, coalesce(x.r ->> 'external_id', x.r ->> 'question_id'), x.r ->> 'subject_code', x.r ->> 'grade_code', x.r ->> 'question_text',
      x.r ->> 'answer', x.r ->> 'correct_answer', case when x.r -> 'is_correct' = 'null'::jsonb then null else (x.r ->> 'is_correct')::boolean end, (x.r ->> 'marks_awarded')::numeric, (x.r ->> 'marks')::numeric)), '[]'::jsonb)
    into v_rows from (select r from quizbox_mock.result_rows(e.id, v.id, p_class, p_student, p_question, p_state) limit v_limit) x;
  perform quizbox_core.audit('mock_exam.export', 'mock_exams', e.id, jsonb_build_object('version', v.version_no, 'rows', least(v_total, v_limit), 'total', v_total));
  return jsonb_build_object('dataset', 'mock_exam_results', 'label', 'Mock exam results: ' || e.title || ' (version ' || v.version_no || ')',
    'columns', jsonb_build_array('Exam', 'Version', 'Purpose', 'Target level', 'Group', 'Participant', 'Attempt', 'Attempt state', 'Started (UTC)', 'Submitted (UTC)', 'Attempt score', 'Attempt total marks', 'Attempt percent',
      'Question no.', 'Question ID', 'Subject', 'Level', 'Question text', 'Student answer', 'Correct answer', 'Correct', 'Marks awarded', 'Marks available'),
    'rows', v_rows, 'total', v_total, 'truncated', v_total > v_limit);
end $fn$;

revoke all on function public.qb_mock_exam_health(uuid), public.qb_mock_class_options(), public.qb_mock_assign_class(uuid, uuid, timestamptz, timestamptz, uuid[]), public.qb_mock_exam_assignments(uuid),
  public.qb_mock_results(uuid, uuid), public.qb_mock_result_rows(uuid, uuid, uuid, uuid, uuid, text, integer, integer), public.qb_mock_export(uuid, uuid, uuid, uuid, uuid, text, integer) from public, anon;
grant execute on function public.qb_mock_exam_health(uuid), public.qb_mock_class_options(), public.qb_mock_assign_class(uuid, uuid, timestamptz, timestamptz, uuid[]), public.qb_mock_exam_assignments(uuid),
  public.qb_mock_results(uuid, uuid), public.qb_mock_result_rows(uuid, uuid, uuid, uuid, uuid, text, integer, integer), public.qb_mock_export(uuid, uuid, uuid, uuid, uuid, text, integer) to authenticated, service_role;

commit;
