-- QuizBox institution, academic level, and access policy extension

create type public.school_stage as enum ('JHS', 'SHS');
create type public.institution_role as enum ('student', 'teacher', 'admin', 'owner');
create type public.access_scope as enum ('current_level', 'previous_levels', 'current_stage', 'all_jhs', 'all_shs', 'all_available');

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  region text,
  district text,
  ownership_type text,
  status public.qb_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.institution_memberships (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.institution_role not null,
  status public.qb_status not null default 'active',
  joined_at timestamptz not null default now(),
  unique(institution_id, user_id, role)
);

create table public.academic_levels (
  code text primary key,
  stage public.school_stage not null,
  label text not null,
  sequence_no integer not null unique,
  is_active boolean not null default true
);

insert into public.academic_levels (code, stage, label, sequence_no) values
  ('B7', 'JHS', 'JHS 1', 7),
  ('B8', 'JHS', 'JHS 2', 8),
  ('B9', 'JHS', 'JHS 3', 9),
  ('SHS1', 'SHS', 'SHS 1', 10),
  ('SHS2', 'SHS', 'SHS 2', 11),
  ('SHS3', 'SHS', 'SHS 3', 12)
on conflict (code) do nothing;

create table public.student_level_history (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  from_level text references public.academic_levels(code),
  to_level text not null references public.academic_levels(code),
  academic_year text,
  promotion_status text not null default 'promoted',
  promoted_by uuid references public.profiles(id) on delete set null,
  promoted_at timestamptz not null default now(),
  notes text
);

create table public.student_access_policies (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student_profiles(id) on delete cascade,
  scope public.access_scope not null default 'current_stage',
  allowed_stages public.school_stage[] not null default array['JHS']::public.school_stage[],
  allowed_levels text[] not null default array[]::text[],
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

alter table public.teacher_profiles add column if not exists institution_id uuid references public.institutions(id) on delete set null;
alter table public.student_profiles add column if not exists institution_id uuid references public.institutions(id) on delete set null;
alter table public.classes add column if not exists institution_id uuid references public.institutions(id) on delete set null;
alter table public.subject_catalog add column if not exists stage public.school_stage not null default 'JHS';
alter table public.questions add column if not exists level_code text;

update public.questions set level_code = grade::text where level_code is null;

alter table public.institutions enable row level security;
alter table public.institution_memberships enable row level security;
alter table public.academic_levels enable row level security;
alter table public.student_level_history enable row level security;
alter table public.student_access_policies enable row level security;

create policy academic_levels_authenticated_read on public.academic_levels
  for select to authenticated using (is_active = true);

create policy institutions_member_read on public.institutions
  for select using (
    exists (
      select 1 from public.institution_memberships m
      where m.institution_id = institutions.id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy institution_memberships_self_read on public.institution_memberships
  for select using (user_id = auth.uid());

create policy student_level_history_self_read on public.student_level_history
  for select using (
    exists (
      select 1 from public.student_profiles s
      where s.id = student_level_history.student_id
        and s.user_id = auth.uid()
    )
  );

create policy student_access_policies_self_read on public.student_access_policies
  for select using (
    exists (
      select 1 from public.student_profiles s
      where s.id = student_access_policies.student_id
        and s.user_id = auth.uid()
    )
  );

create index institutions_name_idx on public.institutions(name);
create index institution_memberships_user_idx on public.institution_memberships(user_id, status);
create index student_level_history_student_idx on public.student_level_history(student_id, promoted_at desc);
create index student_access_policies_student_idx on public.student_access_policies(student_id, expires_at);