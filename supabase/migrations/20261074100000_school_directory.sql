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
begin;

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

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- The pickers. Counts follow the Public / Private and level filters, so the lists narrow as people choose.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_school_regions(p_country text default 'GH', p_ownership text default null, p_level text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '28000'; end if;
  if not public.qb_school_directory_on() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('region', s.region, 'schools', s.n) order by s.region)
    from (select d.region, count(*)::integer as n from public.school_directory d
           where d.country_code = upper(coalesce(p_country, 'GH')) and d.status = 'approved'
             and (nullif(p_ownership, '') is null or d.ownership = p_ownership)
             and (nullif(p_level, '') is null or d.levels @> array[p_level]::text[])
           group by d.region) s), '[]'::jsonb);
end $fn$;

create or replace function public.qb_school_districts(p_region text, p_country text default 'GH', p_ownership text default null, p_level text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '28000'; end if;
  if not public.qb_school_directory_on() then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('district', s.district, 'schools', s.n) order by s.district)
    from (select d.district, count(*)::integer as n from public.school_directory d
           where d.country_code = upper(coalesce(p_country, 'GH')) and d.status = 'approved' and d.region = p_region
             and (nullif(p_ownership, '') is null or d.ownership = p_ownership)
             and (nullif(p_level, '') is null or d.levels @> array[p_level]::text[])
           group by d.district) s), '[]'::jsonb);
end $fn$;

-- Schools in a district (or a region, when typing a name), by Public / Private, by level, by typed text. The caller's own waiting submissions are included and marked.
create or replace function public.qb_school_search(p_region text, p_district text default null, p_ownership text default null, p_level text default null, p_query text default null, p_limit integer default 60, p_country text default 'GH') returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare lim integer := least(greatest(coalesce(p_limit, 60), 1), 200); q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '28000'; end if;
  if not public.qb_school_directory_on() then return '[]'::jsonb; end if;
  if nullif(btrim(coalesce(p_region, '')), '') is null then raise exception 'QB_SCHOOL_REGION_REQUIRED'; end if;
  if p_district is null and q is null then raise exception 'QB_SCHOOL_DISTRICT_REQUIRED'; end if;
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from (
    select d.id, d.name, d.ownership, d.levels, d.town, d.district, d.region, (d.status = 'pending') as pending
      from public.school_directory d
     where d.country_code = upper(coalesce(p_country, 'GH')) and d.region = p_region
       and (d.status = 'approved' or (d.status = 'pending' and d.submitted_by = auth.uid()))
       and (nullif(p_district, '') is null or d.district = p_district)
       and (nullif(p_ownership, '') is null or d.ownership = p_ownership)
       and (nullif(p_level, '') is null or d.levels @> array[p_level]::text[])
       and (q is null or d.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by d.name limit lim) s), '[]'::jsonb);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- A user adds a school that is not listed. It waits for staff, and the user can use it straight away. An existing look-alike is returned instead of a second copy.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_school_submit(p_region text, p_district text, p_name text, p_ownership text default null, p_levels text[] default null, p_town text default null, p_country text default 'GH') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); v_name text; v_district text := btrim(coalesce(p_district, '')); v_town text := nullif(btrim(coalesce(p_town, '')), ''); v_country text := upper(coalesce(p_country, 'GH'));
        v_levels text[]; v_known boolean; ex public.school_directory; rec public.school_directory; waiting integer;
begin
  if uid is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '28000'; end if;
  if not public.qb_school_directory_on() then raise exception 'QB_FEATURE_DISABLED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('qb_school_submit:' || uid::text, 0));
  v_name := public.qb_school_clean_name(p_name);
  if length(v_name) < 3 or length(v_district) < 2 or v_country <> 'GH' or not (p_region = any (public.qb_school_regions_gh())) then raise exception 'QB_SCHOOL_INVALID'; end if;
  if p_ownership is not null and p_ownership not in ('public', 'private') then raise exception 'QB_SCHOOL_INVALID'; end if;
  select array(select distinct x from unnest(coalesce(p_levels, '{}')) x where x in ('primary', 'jhs', 'shs') order by x) into v_levels;
  if cardinality(v_levels) = 0 then raise exception 'QB_SCHOOL_LEVEL_REQUIRED'; end if;
  if v_town is not null and length(v_town) not between 2 and 100 then raise exception 'QB_SCHOOL_INVALID'; end if;

  select * into ex from public.school_directory d
   where d.country_code = v_country and d.region = p_region and d.district_key = public.qb_school_district_key(v_district) and d.name_key = public.qb_school_key(v_name) and d.status in ('approved', 'pending') limit 1;
  if ex.id is not null then return jsonb_build_object('id', ex.id, 'status', ex.status, 'existing', true, 'name', ex.name); end if;

  select count(*)::integer into waiting from public.school_directory where submitted_by = uid and status = 'pending';
  if waiting >= 5 then raise exception 'QB_RATE_LIMITED'; end if;
  -- A district the directory does not know yet is accepted, but staff are told to look at it.
  select exists (select 1 from public.school_directory d where d.country_code = v_country and d.region = p_region and d.district_key = public.qb_school_district_key(v_district) and d.status = 'approved') into v_known;
  insert into public.school_directory(country_code, name, name_key, ownership, region, district, district_key, town, levels, status, needs_review, source, submitted_by, submitted_at)
  values (v_country, v_name, public.qb_school_key(v_name), p_ownership, p_region, left(v_district, 100), public.qb_school_district_key(v_district), v_town, v_levels, 'pending', not v_known, 'user', uid, now())
  returning * into rec;
  return jsonb_build_object('id', rec.id, 'status', 'pending', 'existing', false, 'name', rec.name);
end $fn$;

-- A student or teacher with no directory school yet picks one. The first link is free (it can confirm a school they typed earlier); a later change is a profile edit with its own limits.
create or replace function public.qb_school_set_mine(p_school uuid) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare uid uuid := auth.uid(); s public.school_directory; n integer := 0; m integer := 0;
begin
  if uid is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '28000'; end if;
  if not public.qb_school_directory_on() then raise exception 'QB_FEATURE_DISABLED'; end if;
  select * into s from public.school_directory where id = p_school;
  if s.id is null or not (s.status = 'approved' or (s.status = 'pending' and s.submitted_by = uid)) then raise exception 'QB_NOT_FOUND'; end if;
  if exists (select 1 from public.student_profiles where user_id = uid and school_directory_id is not null and school_directory_id <> s.id)
     or exists (select 1 from public.teacher_profiles where user_id = uid and school_directory_id is not null and school_directory_id <> s.id) then raise exception 'QB_SCHOOL_ALREADY_SET'; end if;
  update public.student_profiles set school_directory_id = s.id, school_name = s.name, updated_at = now() where user_id = uid; get diagnostics n = row_count;
  update public.teacher_profiles set school_directory_id = s.id, school_name = s.name, updated_at = now() where user_id = uid; get diagnostics m = row_count;
  if n + m = 0 then raise exception 'QB_NOT_FOUND'; end if;
  update public.profiles set school_name = s.name where id = uid;
  return jsonb_build_object('school_id', s.id, 'name', s.name, 'pending', s.status = 'pending');
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Back office (super admin only)
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
create or replace function public.qb_school_admin_list(p_status text default 'pending', p_query text default null, p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare lim integer := least(greatest(coalesce(p_limit, 50), 1), 200); skip_n integer := greatest(coalesce(p_offset, 0), 0); q text := nullif(btrim(coalesce(p_query, '')), ''); total integer; result jsonb;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_status not in ('pending', 'approved', 'rejected', 'merged') then raise exception 'QB_INVALID_ACTION'; end if;
  select count(*)::integer into total from public.school_directory d
   where d.status = p_status and (q is null or d.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' or d.district ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%');
  select coalesce(jsonb_agg(r order by r.sort_at desc, r.name), '[]'::jsonb) into result from (
    select d.id, d.name, d.ownership, d.region, d.district, d.town, d.levels, d.status, d.needs_review, d.source, d.submitted_at, d.decided_at, d.decision_note, d.merged_into,
           coalesce(d.submitted_at, d.created_at) as sort_at,
           (select p.full_name from public.profiles p where p.id = d.submitted_by) as submitter_name,
           (select p.email from public.profiles p where p.id = d.submitted_by) as submitter_email,
           ((select count(*) from public.student_profiles sp where sp.school_directory_id = d.id) + (select count(*) from public.teacher_profiles tp where tp.school_directory_id = d.id))::integer as users_linked,
           case when d.status = 'pending' then coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'ownership', a.ownership, 'district', a.district, 'town', a.town) order by a.name)
                from (select x.* from public.school_directory x where x.status = 'approved' and x.country_code = d.country_code and x.region = d.region and x.id <> d.id
                         and (x.name_key = d.name_key or (x.district_key = d.district_key and (x.name_key like left(d.name_key, 8) || '%' or d.name_key like left(x.name_key, 8) || '%')))
                       order by (x.district_key = d.district_key) desc, x.name limit 6) a), '[]'::jsonb) else '[]'::jsonb end as similar
      from public.school_directory d
     where d.status = p_status and (q is null or d.name ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' or d.district ilike '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
     order by coalesce(d.submitted_at, d.created_at) desc, d.name limit lim offset skip_n) r;
  return jsonb_build_object('total', total, 'rows', result,
    'counts', (select coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb) from (select status, count(*)::integer as n from public.school_directory group by status) c));
end $fn$;

-- Applies staff corrections (name, district, town, ownership, levels) to a row; recomputes the matching keys; refuses a result that would duplicate another live school.
create or replace function public.qb_school_apply_fix(p_id uuid, p_fix jsonb) returns public.school_directory
language plpgsql security definer set search_path = '' as $fn$
declare s public.school_directory; v_name text; v_district text; v_town text; v_owner text; v_levels text[]; f jsonb := coalesce(p_fix, '{}'::jsonb);
begin
  select * into s from public.school_directory where id = p_id for update;
  if s.id is null then raise exception 'QB_NOT_FOUND'; end if;
  v_name := case when f ? 'name' then public.qb_school_clean_name(f ->> 'name') else s.name end;
  v_district := case when f ? 'district' then left(btrim(f ->> 'district'), 100) else s.district end;
  v_town := case when f ? 'town' then nullif(left(btrim(coalesce(f ->> 'town', '')), 100), '') else s.town end;
  v_owner := case when f ? 'ownership' then nullif(f ->> 'ownership', '') else s.ownership end;
  if length(v_name) < 3 or length(v_district) < 2 or (v_town is not null and length(v_town) < 2) or (v_owner is not null and v_owner not in ('public', 'private')) then raise exception 'QB_SCHOOL_INVALID'; end if;
  if f ? 'levels' then
    select array(select distinct x from jsonb_array_elements_text(f -> 'levels') x where x in ('primary', 'jhs', 'shs') order by x) into v_levels;
    if cardinality(v_levels) = 0 then raise exception 'QB_SCHOOL_LEVEL_REQUIRED'; end if;
  else v_levels := s.levels; end if;
  if s.status in ('pending', 'approved') and exists (select 1 from public.school_directory d where d.id <> s.id and d.status in ('pending', 'approved') and d.country_code = s.country_code and d.region = s.region
        and d.district_key = public.qb_school_district_key(v_district) and d.name_key = public.qb_school_key(v_name)) then raise exception 'QB_SCHOOL_DUPLICATE'; end if;
  update public.school_directory set name = v_name, name_key = public.qb_school_key(v_name), district = v_district, district_key = public.qb_school_district_key(v_district), town = v_town, ownership = v_owner, levels = v_levels, updated_at = now()
   where id = s.id returning * into s;
  return s;
end $fn$;
revoke all on function public.qb_school_apply_fix(uuid, jsonb) from public, anon, authenticated;

create or replace function public.qb_school_admin_decide(p_id uuid, p_decision text, p_note text default null, p_merge_into uuid default null, p_fix jsonb default null) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.school_directory; t public.school_directory; v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), ''); linked integer := 0; k integer := 0;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_decision not in ('approve', 'reject', 'merge') then raise exception 'QB_INVALID_ACTION'; end if;
  select * into s from public.school_directory where id = p_id for update;
  if s.id is null then raise exception 'QB_NOT_FOUND'; end if;
  if s.status <> 'pending' then raise exception 'QB_INVALID_TRANSITION'; end if;
  if p_decision = 'approve' then
    if p_fix is not null then s := public.qb_school_apply_fix(s.id, p_fix); end if;
    update public.school_directory set status = 'approved', needs_review = false, decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now() where id = s.id;
    update public.student_profiles set school_name = s.name where school_directory_id = s.id;
    update public.teacher_profiles set school_name = s.name where school_directory_id = s.id;
  elsif p_decision = 'reject' then
    if v_note is null or length(v_note) < 5 then raise exception 'QB_REASON_REQUIRED'; end if;
    update public.school_directory set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now() where id = s.id;
    -- People who used it keep the name they see but must pick again from the list.
    update public.student_profiles set school_directory_id = null where school_directory_id = s.id; get diagnostics k = row_count; linked := linked + k;
    update public.teacher_profiles set school_directory_id = null where school_directory_id = s.id; get diagnostics k = row_count; linked := linked + k;
  else
    select * into t from public.school_directory where id = p_merge_into for update;
    if t.id is null or t.id = s.id or t.status <> 'approved' then raise exception 'QB_INVALID_ACTION'; end if;
    update public.school_directory set status = 'merged', merged_into = t.id, decided_by = auth.uid(), decided_at = now(), decision_note = v_note, updated_at = now() where id = s.id;
    update public.student_profiles set school_directory_id = t.id, school_name = t.name where school_directory_id = s.id; get diagnostics k = row_count; linked := linked + k;
    update public.teacher_profiles set school_directory_id = t.id, school_name = t.name where school_directory_id = s.id; get diagnostics k = row_count; linked := linked + k;
    update public.profiles p set school_name = t.name where p.id in (select user_id from public.student_profiles where school_directory_id = t.id union select user_id from public.teacher_profiles where school_directory_id = t.id);
  end if;
  return jsonb_build_object('id', s.id, 'decision', p_decision, 'people_updated', linked);
end $fn$;

-- Staff correct an approved school later (a spelling, a district, public / private, levels); everyone linked to it sees the corrected name.
create or replace function public.qb_school_admin_update(p_id uuid, p_fix jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare s public.school_directory;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  s := public.qb_school_apply_fix(p_id, p_fix);
  update public.student_profiles set school_name = s.name where school_directory_id = s.id;
  update public.teacher_profiles set school_name = s.name where school_directory_id = s.id;
  update public.profiles p set school_name = s.name where p.id in (select user_id from public.student_profiles where school_directory_id = s.id union select user_id from public.teacher_profiles where school_directory_id = s.id);
  return jsonb_build_object('id', s.id, 'name', s.name);
end $fn$;

-- CSV import, in chunks of up to 500 rows. Rows that match a live school (same region, district and name) fill its blanks; new rows become approved schools; bad rows are counted and the first few are described.
create or replace function public.qb_school_admin_import(p_rows jsonb, p_source text default 'import') returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare r jsonb; v_name text; v_region text; v_district text; v_owner text; v_levels text[]; v_town text; v_key text; v_dkey text; ex public.school_directory;
        added integer := 0; updated integer := 0; skipped integer := 0; problems jsonb := '[]'::jsonb; i integer := 0; v_src text := left(coalesce(nullif(btrim(p_source), ''), 'import'), 120);
        v_progs text[]; v_gender text; v_board text; v_cat text;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'QB_INVALID_ACTION'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'QB_TOO_MANY_ROWS'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_name := public.qb_school_clean_name(r ->> 'name');
      v_region := btrim(coalesce(r ->> 'region', ''));
      v_district := left(btrim(coalesce(r ->> 'district', '')), 100);
      v_owner := nullif(lower(btrim(coalesce(r ->> 'ownership', ''))), '');
      v_town := nullif(left(btrim(coalesce(r ->> 'town', '')), 100), '');
      select array(select distinct lower(btrim(x)) from unnest(case when jsonb_typeof(r -> 'levels') = 'array' then array(select jsonb_array_elements_text(r -> 'levels')) else string_to_array(coalesce(r ->> 'levels', ''), '|') end) x
                    where lower(btrim(x)) in ('primary', 'jhs', 'shs') order by 1) into v_levels;
      v_gender := nullif(lower(btrim(coalesce(r ->> 'gender', ''))), '');
      v_board := nullif(replace(replace(lower(btrim(coalesce(r ->> 'boarding', ''))), '/', '_'), ' ', '_'), '');
      v_cat := nullif(upper(btrim(coalesce(r ->> 'category', ''))), '');
      select array(select distinct btrim(x) from unnest(string_to_array(coalesce(r ->> 'programs', ''), '|')) x where btrim(x) <> '' order by 1) into v_progs;
      if length(v_name) < 3 or length(v_district) < 2 or not (v_region = any (public.qb_school_regions_gh())) or coalesce(cardinality(v_levels), 0) = 0
         or (v_owner is not null and v_owner not in ('public', 'private')) or (v_gender is not null and v_gender not in ('mixed', 'boys', 'girls'))
         or (v_board is not null and v_board not in ('day', 'boarding', 'day_boarding')) or (v_cat is not null and v_cat not in ('A', 'B', 'C', 'D')) then
        raise exception 'QB_SCHOOL_INVALID';
      end if;
      v_key := public.qb_school_key(v_name); v_dkey := public.qb_school_district_key(v_district);
      select * into ex from public.school_directory d where d.country_code = 'GH' and d.region = v_region and d.district_key = v_dkey and d.name_key = v_key and d.status in ('approved', 'pending') limit 1;
      if ex.id is not null then
        update public.school_directory set
          ownership = coalesce(ex.ownership, v_owner), town = coalesce(ex.town, v_town), gender = coalesce(ex.gender, v_gender), boarding = coalesce(ex.boarding, v_board), category = coalesce(ex.category, v_cat),
          school_code = coalesce(ex.school_code, nullif(left(btrim(coalesce(r ->> 'school_code', '')), 40), '')), curriculum = coalesce(ex.curriculum, nullif(left(btrim(coalesce(r ->> 'curriculum', '')), 120), '')),
          levels = array(select distinct x from unnest(ex.levels || v_levels) x order by 1), programs = array(select distinct x from unnest(ex.programs || coalesce(v_progs, '{}')) x order by 1),
          status = case when ex.status = 'pending' then 'approved' else ex.status end, updated_at = now()
         where id = ex.id;
        updated := updated + 1;
      else
        insert into public.school_directory(country_code, name, name_key, ownership, region, district, district_key, town, levels, gender, boarding, category, programs, school_code, curriculum, status, needs_review, source, source_ref)
        values ('GH', v_name, v_key, v_owner, v_region, v_district, v_dkey, v_town, v_levels, v_gender, v_board, v_cat, coalesce(v_progs, '{}'),
                nullif(left(btrim(coalesce(r ->> 'school_code', '')), 40), ''), nullif(left(btrim(coalesce(r ->> 'curriculum', '')), 120), ''), 'approved',
                coalesce((r ->> 'needs_review') in ('Y', 'y', 'true', '1'), false), v_src, nullif(left(btrim(coalesce(r ->> 'source_ref', '')), 300), ''));
        added := added + 1;
      end if;
    exception when others then
      skipped := skipped + 1;
      if jsonb_array_length(problems) < 10 then problems := problems || jsonb_build_object('row', i, 'name', left(coalesce(r ->> 'name', ''), 80), 'why', sqlerrm); end if;
    end;
  end loop;
  return jsonb_build_object('added', added, 'updated', updated, 'skipped', skipped, 'problems', problems);
end $fn$;

-- Who may run what. Every function checks its own rules; the browser is never trusted.
revoke all on function public.qb_school_regions(text, text, text) from public, anon, authenticated;
revoke all on function public.qb_school_districts(text, text, text, text) from public, anon, authenticated;
revoke all on function public.qb_school_search(text, text, text, text, text, integer, text) from public, anon, authenticated;
revoke all on function public.qb_school_submit(text, text, text, text, text[], text, text) from public, anon, authenticated;
revoke all on function public.qb_school_set_mine(uuid) from public, anon, authenticated;
revoke all on function public.qb_school_admin_list(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.qb_school_admin_decide(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.qb_school_admin_update(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.qb_school_admin_import(jsonb, text) from public, anon, authenticated;
grant execute on function public.qb_school_regions(text, text, text) to authenticated;
grant execute on function public.qb_school_districts(text, text, text, text) to authenticated;
grant execute on function public.qb_school_search(text, text, text, text, text, integer, text) to authenticated;
grant execute on function public.qb_school_submit(text, text, text, text, text[], text, text) to authenticated;
grant execute on function public.qb_school_set_mine(uuid) to authenticated;
grant execute on function public.qb_school_admin_list(text, text, integer, integer) to authenticated;
grant execute on function public.qb_school_admin_decide(uuid, text, text, uuid, jsonb) to authenticated;
grant execute on function public.qb_school_admin_update(uuid, jsonb) to authenticated;
grant execute on function public.qb_school_admin_import(jsonb, text) to authenticated;

commit;
