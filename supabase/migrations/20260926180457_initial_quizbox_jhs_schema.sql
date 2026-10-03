-- QuizBox JHS initial Supabase schema
-- Target: Supabase Postgres

create extension if not exists "pgcrypto";

create type public.qb_role as enum ('student', 'teacher', 'admin', 'sponsor');
create type public.qb_grade as enum ('B7', 'B8', 'B9');
create type public.qb_status as enum ('active', 'inactive', 'archived');
create type public.assignment_status as enum ('draft', 'published', 'closed');
create type public.recipient_mode as enum ('class', 'selected');
create type public.attempt_status as enum ('in_progress', 'submitted', 'expired');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.qb_role not null,
  full_name text not null,
  email text not null unique,
  phone text,
  country text not null default 'Ghana',
  region text,
  school_name text,
  status public.qb_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.teacher_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  school_name text not null,
  region text,
  country text not null default 'Ghana',
  status public.qb_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  grade public.qb_grade not null,
  school_name text,
  region text,
  country text not null default 'Ghana',
  status public.qb_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subject_catalog (
  id uuid primary key default gen_random_uuid(),
  subject_code text not null,
  subject_name text not null,
  grade public.qb_grade not null,
  grade_label text not null,
  question_count integer not null default 0 check (question_count >= 0),
  bank_status text not null default 'coming_soon',
  display_order integer not null default 999,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subject_code, grade)
);

create table public.question_sources (
  id uuid primary key default gen_random_uuid(),
  source_code text not null unique,
  subject_code text not null,
  grade public.qb_grade not null,
  source_name text not null,
  source_type text not null default 'workbook',
  storage_path text,
  status public.qb_status not null default 'active',
  imported_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.question_sources(id) on delete set null,
  external_question_id text,
  subject_code text not null,
  subject_name text not null,
  grade public.qb_grade not null,
  strand_no text,
  strand_name text,
  substrand_no text,
  substrand_name text,
  difficulty_code text,
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_answer text not null check (correct_answer in ('A', 'B', 'C', 'D')),
  explanation text,
  status public.qb_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  class_name text not null,
  school_name text,
  grade public.qb_grade not null,
  grade_label text not null,
  academic_year text,
  term text,
  teacher_id uuid not null references public.teacher_profiles(id) on delete restrict,
  teacher_user_id uuid not null references public.profiles(id) on delete restrict,
  status public.qb_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.class_memberships (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  student_user_id uuid not null references public.profiles(id) on delete cascade,
  student_email text not null,
  student_name text not null,
  grade public.qb_grade not null,
  status public.qb_status not null default 'active',
  joined_at timestamptz not null default now(),
  approved_at timestamptz,
  unique(class_id, student_id)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  assessment_type text not null default 'assignment',
  owner_role public.qb_role not null,
  owner_user_id uuid not null references public.profiles(id) on delete restrict,
  subject_code text not null,
  subject_name text not null,
  grade public.qb_grade not null,
  question_count integer not null check (question_count > 0),
  difficulty text not null default 'mixed',
  strand_no text,
  substrand_no text,
  time_limit_minutes integer not null default 20,
  max_attempts integer not null default 1,
  allow_resume boolean not null default true,
  auto_submit boolean not null default true,
  pass_percent numeric(5,2) not null default 50,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  question_order integer not null check (question_order > 0),
  unique(assessment_id, question_order),
  unique(assessment_id, question_id)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.teacher_profiles(id) on delete restrict,
  teacher_user_id uuid not null references public.profiles(id) on delete restrict,
  subject_code text not null,
  subject_name text not null,
  grade public.qb_grade not null,
  title text not null,
  recipient_mode public.recipient_mode not null default 'class',
  question_count integer not null check (question_count > 0),
  difficulty text not null default 'mixed',
  strand_no text,
  substrand_no text,
  due_at timestamptz,
  time_limit_minutes integer not null default 20,
  attempts_allowed integer not null default 1,
  instructions text,
  status public.assignment_status not null default 'draft',
  created_at timestamptz not null default now(),
  published_at timestamptz
);

create table public.assignment_targets (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  membership_id uuid not null references public.class_memberships(id) on delete cascade,
  status public.qb_status not null default 'active',
  created_at timestamptz not null default now(),
  unique(assignment_id, student_id)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  assessment_id uuid not null references public.assessments(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  student_user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  expires_at timestamptz,
  score numeric(8,2),
  total_marks numeric(8,2),
  percentage numeric(5,2),
  status public.attempt_status not null default 'in_progress',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_answer text check (selected_answer in ('A', 'B', 'C', 'D')),
  correct_answer text check (correct_answer in ('A', 'B', 'C', 'D')),
  is_correct boolean,
  marks_awarded numeric(8,2) not null default 0,
  response_seconds integer not null default 0,
  answered_at timestamptz not null default now(),
  unique(attempt_id, question_id)
);

create table public.gradebook (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null unique,
  assessment_id uuid not null references public.assessments(id) on delete restrict,
  attempt_id uuid not null unique references public.attempts(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  student_user_id uuid not null references public.profiles(id) on delete cascade,
  student_email text not null,
  student_name text not null,
  score numeric(8,2) not null,
  total_marks numeric(8,2) not null,
  percentage numeric(5,2) not null,
  status text not null default 'final',
  graded_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid references public.profiles(id) on delete cascade,
  recipient_profile_id uuid,
  recipient_email text,
  recipient_role public.qb_role not null,
  type text not null,
  title text not null,
  message text not null,
  entity_type text,
  entity_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text not null,
  school_name text,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role public.qb_role,
  action text not null,
  entity_type text,
  entity_id uuid,
  status text not null default 'pass',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index questions_subject_grade_idx on public.questions(subject_code, grade) where status = 'active';
create index classes_teacher_idx on public.classes(teacher_user_id, status);
create index memberships_student_idx on public.class_memberships(student_user_id, status);
create index assignments_class_idx on public.assignments(class_id, status);
create index targets_student_idx on public.assignment_targets(student_id, status);
create index attempts_student_idx on public.attempts(student_user_id, status);
create index gradebook_class_idx on public.gradebook(class_id, graded_at desc);
create index notifications_recipient_idx on public.notifications(recipient_user_id, read_at, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.teacher_profiles enable row level security;
alter table public.student_profiles enable row level security;
alter table public.subject_catalog enable row level security;
alter table public.question_sources enable row level security;
alter table public.questions enable row level security;
alter table public.classes enable row level security;
alter table public.class_memberships enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_targets enable row level security;
alter table public.attempts enable row level security;
alter table public.responses enable row level security;
alter table public.gradebook enable row level security;
alter table public.notifications enable row level security;
alter table public.support_tickets enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_self_select on public.profiles for select using (id = auth.uid());
create policy profiles_self_update on public.profiles for update using (id = auth.uid());

create policy teacher_self on public.teacher_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy student_self on public.student_profiles for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy catalog_authenticated_read on public.subject_catalog for select to authenticated using (is_active = true);
create policy questions_authenticated_read on public.questions for select to authenticated using (status = 'active');

create policy classes_teacher_owner on public.classes for all
  using (teacher_user_id = auth.uid())
  with check (teacher_user_id = auth.uid());

create policy classes_student_member_read on public.classes for select
  using (
    exists (
      select 1 from public.class_memberships m
      where m.class_id = classes.id
        and m.student_user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy memberships_teacher_read on public.class_memberships for select
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_memberships.class_id
        and c.teacher_user_id = auth.uid()
    )
  );

create policy memberships_student_self on public.class_memberships for select
  using (student_user_id = auth.uid());

create policy assignments_teacher_owner on public.assignments for all
  using (teacher_user_id = auth.uid())
  with check (teacher_user_id = auth.uid());

create policy assignments_student_target_read on public.assignments for select
  using (
    status = 'published'
    and exists (
      select 1
      from public.assignment_targets t
      join public.class_memberships m on m.id = t.membership_id
      where t.assignment_id = assignments.id
        and m.student_user_id = auth.uid()
        and t.status = 'active'
        and m.status = 'active'
    )
  );

create policy attempts_student_self on public.attempts for all
  using (student_user_id = auth.uid())
  with check (student_user_id = auth.uid());

create policy gradebook_teacher_read on public.gradebook for select
  using (
    exists (
      select 1 from public.classes c
      where c.id = gradebook.class_id
        and c.teacher_user_id = auth.uid()
    )
  );

create policy gradebook_student_read on public.gradebook for select
  using (student_user_id = auth.uid());

create policy notifications_self on public.notifications for all
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

create policy support_insert_authenticated on public.support_tickets for insert
  with check (requester_user_id = auth.uid() or requester_user_id is null);

create policy audit_self_read on public.audit_logs for select
  using (actor_user_id = auth.uid());