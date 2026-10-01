begin;

create extension if not exists pgcrypto;

create table if not exists public.curricula (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  country text not null default 'Ghana',
  version text not null,
  source_name text,
  source_hash text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE','ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (code, version)
);

create table if not exists public.curriculum_nodes (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curricula(id) on delete restrict,
  parent_id uuid references public.curriculum_nodes(id) on delete restrict,
  node_type text not null check (node_type in ('education_level','grade','subject','strand','sub_strand','topic','subtopic','content_standard','learning_indicator','learning_objective')),
  code text not null,
  identity_key text not null,
  title text not null,
  source_terminology text not null,
  education_level text,
  grade_code text,
  source_grade_code text,
  canonical_grade_code text,
  subject_code text,
  sort_order integer not null default 0,
  source_file text,
  source_version text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (curriculum_id, identity_key)
);

create index if not exists curriculum_nodes_parent_idx on public.curriculum_nodes(parent_id, sort_order);
create index if not exists curriculum_nodes_filter_idx on public.curriculum_nodes(curriculum_id, education_level, grade_code, subject_code, node_type) where is_active;

create table if not exists public.content_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  source_hash text not null,
  imported_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'PREVIEW' check (status in ('PREVIEW','VALIDATED','IMPORTING','COMPLETED','FAILED')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  records_detected integer not null default 0,
  valid_records integer not null default 0,
  warning_records integer not null default 0,
  rejected_records integer not null default 0,
  inserted_records integer not null default 0,
  updated_records integer not null default 0,
  duplicates_skipped integer not null default 0,
  report jsonb not null default '{}'::jsonb,
  unique (source_hash)
);

create table if not exists public.question_import_staging (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references public.content_import_batches(id) on delete cascade,
  row_number integer not null,
  external_source_id text,
  normalized_payload jsonb not null,
  fingerprint text not null,
  classification text not null check (classification in ('valid','warning','rejected')),
  issues jsonb not null default '[]'::jsonb,
  imported_question_id uuid references public.questions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (import_batch_id, row_number)
);

create index if not exists question_import_staging_fingerprint_idx on public.question_import_staging(fingerprint);

alter table public.questions add column if not exists curriculum_id uuid references public.curricula(id) on delete restrict;
alter table public.questions add column if not exists curriculum_node_id uuid references public.curriculum_nodes(id) on delete restrict;
alter table public.questions add column if not exists import_batch_id uuid references public.content_import_batches(id) on delete set null;
alter table public.questions add column if not exists source_version text;
alter table public.questions add column if not exists version integer not null default 1;
alter table public.questions add column if not exists hint text;
alter table public.questions add column if not exists source_grade_code text;
alter table public.questions add column if not exists canonical_grade_code text;

-- QuizBox content workflow:
-- status = lifecycle (active/inactive/archived)
-- validation_status = editorial approval workflow
alter table public.questions
  alter column validation_status set default 'review';

update public.questions
set validation_status = 'review'
where validation_status is null;

create index if not exists questions_curriculum_filter_idx on public.questions(curriculum_id, curriculum_node_id, grade, subject_code, status, difficulty_code);
create index if not exists questions_import_batch_idx on public.questions(import_batch_id);
create index if not exists questions_search_idx on public.questions using gin (to_tsvector('english', coalesce(question_text, '')));

alter table public.classes add column if not exists curriculum_id uuid references public.curricula(id) on delete restrict;
alter table public.classes add column if not exists education_level text;
alter table public.classes add column if not exists subject_node_id uuid references public.curriculum_nodes(id) on delete restrict;

alter table public.assignments add column if not exists curriculum_node_ids uuid[] not null default '{}';
alter table public.assignments add column if not exists mode text not null default 'ASSESSMENT' check (mode in ('PRACTICE','ASSESSMENT'));
alter table public.assignments add column if not exists selection_mode text not null default 'AUTOMATIC' check (selection_mode in ('AUTOMATIC','MANUAL'));
alter table public.assignments add column if not exists closed_at timestamptz;
alter table public.assignments add column if not exists remediation_source_assignment_id uuid references public.assignments(id) on delete set null;
alter table public.assignments add column if not exists remediation_node_id uuid references public.curriculum_nodes(id) on delete set null;

create table if not exists public.assignment_question_versions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  question_version integer not null,
  display_order integer not null,
  marks numeric(8,2) not null default 1,
  created_at timestamptz not null default now(),
  unique (assignment_id, question_id),
  unique (assignment_id, display_order)
);

create table if not exists public.learning_events (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete restrict,
  class_id uuid references public.classes(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  response_id uuid not null references public.responses(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  curriculum_node_id uuid references public.curriculum_nodes(id) on delete restrict,
  mode text not null check (mode in ('PRACTICE','ASSESSMENT')),
  is_correct boolean,
  difficulty text,
  response_seconds integer not null default 0,
  hint_used boolean not null default false,
  attempt_number integer not null default 1,
  occurred_at timestamptz not null default now(),
  unique (response_id)
);

create index if not exists learning_events_student_node_idx on public.learning_events(student_user_id, curriculum_node_id, occurred_at desc);
create index if not exists learning_events_class_assignment_idx on public.learning_events(class_id, assignment_id, occurred_at desc);

create table if not exists public.mastery_records (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  curriculum_node_id uuid not null references public.curriculum_nodes(id) on delete restrict,
  mastery_score numeric(5,2) not null default 0 check (mastery_score between 0 and 100),
  proficiency_state text not null default 'Not Started' check (proficiency_state in ('Not Started','Learning','Developing','Proficient','Mastered','Needs Review')),
  confidence text not null default 'low' check (confidence in ('low','medium','high')),
  attempts_count integer not null default 0,
  recent_accuracy numeric(5,2) not null default 0,
  historical_accuracy numeric(5,2) not null default 0,
  difficulty_adjusted numeric(5,2) not null default 0,
  consistency numeric(5,2) not null default 0,
  independence numeric(5,2) not null default 0,
  last_practiced_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (student_user_id, curriculum_node_id)
);

create index if not exists mastery_records_student_idx on public.mastery_records(student_user_id, proficiency_state, mastery_score);

create table if not exists public.xp_transactions (
  id uuid primary key default gen_random_uuid(),
  student_user_id uuid not null references auth.users(id) on delete cascade,
  attempt_id uuid references public.attempts(id) on delete set null,
  reason text not null check (reason in ('CORRECT_ANSWER','ASSIGNMENT_COMPLETION','HIGH_PROFICIENCY','ADMIN_ADJUSTMENT')),
  points integer not null check (points <> 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (attempt_id, reason)
);

create index if not exists xp_transactions_student_idx on public.xp_transactions(student_user_id, created_at desc);

alter table public.curricula enable row level security;
alter table public.curriculum_nodes enable row level security;
alter table public.content_import_batches enable row level security;
alter table public.question_import_staging enable row level security;
alter table public.assignment_question_versions enable row level security;
alter table public.learning_events enable row level security;
alter table public.mastery_records enable row level security;
alter table public.xp_transactions enable row level security;

drop policy if exists curricula_authenticated_read on public.curricula;
create policy curricula_authenticated_read on public.curricula for select to authenticated using (status = 'ACTIVE' or public.qb_is_platform_admin());
drop policy if exists curriculum_nodes_authenticated_read on public.curriculum_nodes;
create policy curriculum_nodes_authenticated_read on public.curriculum_nodes for select to authenticated using (is_active or public.qb_is_platform_admin());
drop policy if exists import_batches_admin_only on public.content_import_batches;
create policy import_batches_admin_only on public.content_import_batches for all to authenticated using (public.qb_is_platform_admin()) with check (public.qb_is_platform_admin());
drop policy if exists staging_admin_only on public.question_import_staging;
create policy staging_admin_only on public.question_import_staging for all to authenticated using (public.qb_is_platform_admin()) with check (public.qb_is_platform_admin());
drop policy if exists assignment_question_teacher_read on public.assignment_question_versions;
create policy assignment_question_teacher_read on public.assignment_question_versions for select to authenticated using (
  exists (select 1 from public.assignments a where a.id = assignment_id and (a.teacher_user_id = auth.uid() or public.qb_is_platform_admin()))
);
drop policy if exists learning_events_owner_read on public.learning_events;
create policy learning_events_owner_read on public.learning_events for select to authenticated using (
  student_user_id = auth.uid() or public.qb_can_manage_class(class_id) or public.qb_is_platform_admin()
);
drop policy if exists mastery_owner_read on public.mastery_records;
create policy mastery_owner_read on public.mastery_records for select to authenticated using (
  student_user_id = auth.uid() or public.qb_is_platform_admin() or exists (
    select 1 from public.class_memberships cm join public.classes c on c.id = cm.class_id
    where cm.student_user_id = mastery_records.student_user_id and public.qb_can_manage_class(c.id)
  )
);
drop policy if exists xp_owner_read on public.xp_transactions;
create policy xp_owner_read on public.xp_transactions for select to authenticated using (student_user_id = auth.uid() or public.qb_is_platform_admin());

create or replace function public.qb_proficiency(p_percentage numeric)
returns text
language sql
immutable
as $$
  select case
    when p_percentage >= 80 then 'Highly Proficient'
    when p_percentage >= 68 then 'Proficient'
    when p_percentage >= 54 then 'Approaching Proficiency'
    when p_percentage >= 40 then 'Developing'
    else 'Emerging'
  end
$$;


create or replace function public.qb_join_class(p_join_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_class public.classes;
  v_student uuid;
  v_membership public.class_memberships;
begin

  select *
  into v_class
  from public.classes
  where upper(join_code) = upper(trim(p_join_code))
  limit 1;

  if v_class.id is null then
    raise exception 'INVALID_CLASS_CODE';
  end if;

  if v_class.status <> 'active'::public.qb_status then
    raise exception 'CLASS_NOT_ACTIVE';
  end if;

  if v_class.join_code_expires_at is not null
     and v_class.join_code_expires_at < now() then
    raise exception 'CLASS_CODE_EXPIRED';
  end if;

  v_student := public.qb_current_student_id();

  if v_student is null then
    raise exception 'STUDENT_PROFILE_REQUIRED';
  end if;

  insert into public.class_memberships(
    class_id,
    student_id,
    student_user_id,
    student_email,
    student_name,
    grade,
    status
  )
  select
    v_class.id,
    v_student,
    auth.uid(),
    p.email,
    p.full_name,
    v_class.grade,
    'active'::public.qb_status
  from public.profiles p
  where p.id = auth.uid()

  on conflict (class_id, student_id)
  do update
  set
    status = 'active'::public.qb_status,
    left_at = null

  returning * into v_membership;

  return jsonb_build_object(
    'membership_id', v_membership.id,
    'class_id', v_class.id,
    'class_name', v_class.class_name,
    'status', v_membership.status::text
  );

end
$$;


create or replace function public.qb_question_availability(
  p_curriculum_node_ids uuid[],
  p_grade text default null,
  p_subject_code text default null
)
returns table(
  curriculum_node_id uuid,
  approved_count bigint,
  easy_count bigint,
  medium_count bigint,
  hard_count bigint,
  multiple_choice_count bigint,
  true_false_count bigint
)
language sql
stable
security invoker
as $$
  select
    q.curriculum_node_id,

    count(*) filter (
      where q.status = 'active'::public.qb_status
        and lower(coalesce(q.validation_status, ''))
            in ('approved','validated')
    ) as approved_count,

    count(*) filter (
      where lower(coalesce(q.difficulty_code, q.difficulty_label, '')) = 'easy'
        and q.status = 'active'::public.qb_status
        and lower(coalesce(q.validation_status, ''))
            in ('approved','validated')
    ) as easy_count,

    count(*) filter (
      where lower(coalesce(q.difficulty_code, q.difficulty_label, '')) = 'medium'
        and q.status = 'active'::public.qb_status
        and lower(coalesce(q.validation_status, ''))
            in ('approved','validated')
    ) as medium_count,

    count(*) filter (
      where lower(coalesce(q.difficulty_code, q.difficulty_label, '')) = 'hard'
        and q.status = 'active'::public.qb_status
        and lower(coalesce(q.validation_status, ''))
            in ('approved','validated')
    ) as hard_count,

    count(*) filter (
      where lower(coalesce(q.answer_type, ''))
            in ('single_choice','multiple_choice')
        and q.status = 'active'::public.qb_status
        and lower(coalesce(q.validation_status, ''))
            in ('approved','validated')
    ) as multiple_choice_count,

    count(*) filter (
      where lower(coalesce(q.answer_type, '')) = 'true_false'
        and q.status = 'active'::public.qb_status
        and lower(coalesce(q.validation_status, ''))
            in ('approved','validated')
    ) as true_false_count

  from public.questions q

  where q.curriculum_node_id = any(p_curriculum_node_ids)
    and (
      p_grade is null
      or q.grade::text = p_grade
    )
    and (
      p_subject_code is null
      or q.subject_code = p_subject_code
    )

  group by q.curriculum_node_id
$$;


create or replace function public.qb_student_xp()
returns table(
  total_xp bigint,
  level integer,
  current_level_xp integer,
  next_level_xp integer
)
language sql
stable
security invoker
as $$
  with totals as (
    select
      coalesce(sum(points), 0)::bigint as xp
    from public.xp_transactions
    where student_user_id = auth.uid()
  ),
  levels as (
    select
      xp,
      floor(sqrt(xp / 100.0))::integer + 1 as lvl
    from totals
  )
  select
    xp as total_xp,
    lvl as level,
    (
      xp - ((lvl - 1) * (lvl - 1) * 100)
    )::integer as current_level_xp,
    (
      (lvl * lvl * 100)
      - ((lvl - 1) * (lvl - 1) * 100)
    )::integer as next_level_xp
  from levels
$$;


grant select on
  public.curricula,
  public.curriculum_nodes,
  public.mastery_records,
  public.xp_transactions
to authenticated;

grant execute on function public.qb_proficiency(numeric)
to authenticated;

grant execute on function public.qb_join_class(text)
to authenticated;

grant execute on function public.qb_question_availability(uuid[], text, text)
to authenticated;

grant execute on function public.qb_student_xp()
to authenticated;

commit;
