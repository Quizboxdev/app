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
