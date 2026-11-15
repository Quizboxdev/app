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
