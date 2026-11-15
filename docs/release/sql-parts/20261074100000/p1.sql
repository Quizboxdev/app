-- QuizBox school directory: one accurate list of schools (region -> district -> school) that students and teachers pick from, with a Public / Private filter, and a back-office queue for schools that users add.
-- Ships OFF behind flags.school_directory. Flag off: every function here answers with nothing or QB_FEATURE_DISABLED, and nothing existing changes (public.institutions, competitions and the public stats are not touched).
--   school_directory                  the directory (approved schools plus the ones users added, waiting for staff). Closed to every browser; only the functions below read or write it.
--   student_profiles / teacher_profiles .school_directory_id   the school a person picked (nullable; school_name text stays as the display name for everything that already reads it)
--   qb_school_regions / qb_school_districts / qb_school_search  the pickers, with optional ownership (public / private) and level (primary / jhs / shs) filters
--   qb_school_submit                  a user adds a school that is not listed; it waits as 'pending' (the user can use it at once)
--   qb_school_set_mine                a student or teacher with no school yet picks one (a later change goes through the existing profile edit rules)
--   qb_school_admin_list / _decide / _update / _import   super admin only: the waiting queue with look-alikes, approve / reject / merge, corrections, and the CSV import
-- The directory is not the same as public.institutions (a school that runs classes and competitions on QuizBox). institution_id links the two later, when a school is actually used.
-- Names stay accurate because two schools cannot share one (region, district, name) key, a new name is checked against the list before it is accepted, and staff merge look-alikes instead of keeping both.
-- Additive and idempotent. Rollback: supabase/rollback/school_directory.sql (keeps the data).


insert into public.platform_settings(key, value, description)
select 'flags.school_directory', 'false'::jsonb, 'Students and teachers pick their school from the directory; users may add a missing school for staff approval'
where not exists (select 1 from public.platform_settings p where p.key = 'flags.school_directory' and p.scope_type = 'global');

-- Matching keys: letters and digits only, so "St. Mary's JHS" and "ST MARYS JHS" meet; district words such as Metropolitan / Municipal do not matter.
create or replace function public.qb_school_key(p_text text) returns text language sql immutable set search_path = '' as $fn$
  select regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '', 'g');
$fn$;
create or replace function public.qb_school_district_key(p_text text) returns text language sql immutable set search_path = '' as $fn$
  select regexp_replace(regexp_replace(lower(coalesce(p_text, '')), '\m(metropolitan|metro|municipal|district|assembly)\M', ' ', 'g'), '[^a-z0-9]+', '', 'g');
$fn$;
revoke all on function public.qb_school_key(text) from public, anon, authenticated;
revoke all on function public.qb_school_district_key(text) from public, anon, authenticated;

create table if not exists public.school_directory (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'GH' check (country_code ~ '^[A-Z]{2}$'),
  name text not null check (length(btrim(name)) between 3 and 200),
  name_key text not null check (name_key <> ''),
  ownership text check (ownership in ('public', 'private')),
  region text not null check (length(btrim(region)) between 2 and 60),
  district text not null check (length(btrim(district)) between 2 and 100),
  district_key text not null check (district_key <> ''),
  town text check (town is null or length(btrim(town)) between 2 and 100),
  levels text[] not null check (cardinality(levels) between 1 and 3 and levels <@ array['primary', 'jhs', 'shs']::text[]),
  gender text check (gender in ('mixed', 'boys', 'girls')),
  boarding text check (boarding in ('day', 'boarding', 'day_boarding')),
  category text check (category in ('A', 'B', 'C', 'D')),
  programs text[] not null default '{}',
  school_code text check (school_code is null or length(school_code) <= 40),
  curriculum text check (curriculum is null or length(curriculum) <= 120),
  status text not null default 'approved' check (status in ('pending', 'approved', 'rejected', 'merged')),
  needs_review boolean not null default false,
  source text check (source is null or length(source) <= 120),
  source_ref text check (source_ref is null or length(source_ref) <= 300),
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  merged_into uuid references public.school_directory(id) on delete set null,
  institution_id uuid references public.institutions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live school per key. Rejected and merged rows are history and may repeat.
create unique index if not exists school_directory_live_key on public.school_directory (country_code, region, district_key, name_key) where status in ('pending', 'approved');
create index if not exists school_directory_pick on public.school_directory (country_code, status, region, district, ownership);
create index if not exists school_directory_name on public.school_directory (lower(name) text_pattern_ops);
create index if not exists school_directory_pending on public.school_directory (status, submitted_at) where status = 'pending';
alter table public.school_directory enable row level security;
revoke all on public.school_directory from anon, authenticated;

alter table public.student_profiles add column if not exists school_directory_id uuid references public.school_directory(id) on delete set null;
alter table public.teacher_profiles add column if not exists school_directory_id uuid references public.school_directory(id) on delete set null;
create index if not exists student_profiles_school_directory on public.student_profiles (school_directory_id) where school_directory_id is not null;
create index if not exists teacher_profiles_school_directory on public.teacher_profiles (school_directory_id) where school_directory_id is not null;

create or replace function public.qb_school_directory_on() returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce(quizbox_core.flag('flags.school_directory'), false);
$fn$;
revoke all on function public.qb_school_directory_on() from public, anon, authenticated;

-- The 16 regions of Ghana; a school may only be listed in one of them.
create or replace function public.qb_school_regions_gh() returns text[] language sql immutable set search_path = '' as $fn$
  select array['Ahafo', 'Ashanti', 'Bono', 'Bono East', 'Central', 'Eastern', 'Greater Accra', 'North East', 'Northern', 'Oti', 'Savannah', 'Upper East', 'Upper West', 'Volta', 'Western', 'Western North'];
$fn$;
revoke all on function public.qb_school_regions_gh() from public, anon, authenticated;

-- Cleans a typed name: one space between words, no control characters, no markup or links.
create or replace function public.qb_school_clean_name(p_text text) returns text language plpgsql immutable set search_path = '' as $fn$
declare t text := btrim(regexp_replace(regexp_replace(coalesce(p_text, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g'));
begin
  if t ~* '(https?:|www\.|<|>|@)' then raise exception 'QB_SCHOOL_INVALID'; end if;
  return left(t, 200);
end $fn$;
revoke all on function public.qb_school_clean_name(text) from public, anon, authenticated;
