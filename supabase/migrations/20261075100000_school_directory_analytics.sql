-- School directory, analytics and filters for the staff screen. Builds on 20261074100000.
--   qb_school_admin_stats(region)   one call for the screen's figures and charts: totals, schools by region split Public / Private, schools by level, the last 12 weeks of schools added and decided, and (when a region is given) its districts
--   qb_school_admin_list(...)       replaces the earlier version with the same first four arguments plus filters (region, district, Public / Private, level) and a sort (name, region, district, people linked, newest)
-- The district filter and the district list go by the matching key, so "Kumasi Metro" and "Kumasi Metropolitan" are one district.
-- Super admin only, like the rest of the staff functions. Reads only; changes no data. Works whether or not flags.school_directory is on.
-- Additive apart from the list function, which is dropped and re-created with the extra optional arguments (a caller that passes the first four still works). Rollback: supabase/rollback/school_directory_analytics.sql (restores the earlier list function).
begin;

drop function if exists public.qb_school_admin_list(text, text, integer, integer);

create or replace function public.qb_school_admin_list(p_status text default 'pending', p_query text default null, p_limit integer default 50, p_offset integer default 0,
  p_region text default null, p_district text default null, p_ownership text default null, p_level text default null, p_sort text default 'recent', p_dir text default 'desc') returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare lim integer := least(greatest(coalesce(p_limit, 50), 1), 200); skip_n integer := greatest(coalesce(p_offset, 0), 0); total integer; result jsonb;
        q text := nullif(btrim(coalesce(p_query, '')), ''); pat text; srt text := coalesce(nullif(p_sort, ''), 'recent'); asc_ boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  if p_status not in ('pending', 'approved', 'rejected', 'merged') then raise exception 'QB_INVALID_ACTION'; end if;
  if srt not in ('recent', 'name', 'region', 'district', 'linked') then raise exception 'QB_INVALID_ACTION'; end if;
  if p_ownership is not null and p_ownership not in ('public', 'private', 'unset') then raise exception 'QB_INVALID_ACTION'; end if;
  if p_level is not null and p_level not in ('primary', 'jhs', 'shs') then raise exception 'QB_INVALID_ACTION'; end if;
  pat := case when q is null then null else '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  select count(*)::integer into total from public.school_directory d
   where d.status = p_status and (pat is null or d.name ilike pat or d.district ilike pat or d.town ilike pat)
     and (nullif(p_region, '') is null or d.region = p_region) and (nullif(p_district, '') is null or d.district_key = public.qb_school_district_key(p_district))
     and (p_ownership is null or (p_ownership = 'unset' and d.ownership is null) or d.ownership = p_ownership)
     and (p_level is null or d.levels @> array[p_level]::text[]);

  select coalesce(jsonb_agg(r.j order by r.rn), '[]'::jsonb) into result from (
    select row_number() over (order by
             case when srt = 'name' and asc_ then b.name end asc, case when srt = 'name' and not asc_ then b.name end desc,
             case when srt = 'region' and asc_ then b.region end asc, case when srt = 'region' and not asc_ then b.region end desc,
             case when srt = 'district' and asc_ then b.district end asc, case when srt = 'district' and not asc_ then b.district end desc,
             case when srt = 'linked' and asc_ then b.users_linked end asc, case when srt = 'linked' and not asc_ then b.users_linked end desc,
             case when srt = 'recent' and asc_ then b.sort_at end asc, case when srt = 'recent' and not asc_ then b.sort_at end desc, b.name) as rn,
           jsonb_build_object('id', b.id, 'name', b.name, 'ownership', b.ownership, 'region', b.region, 'district', b.district, 'town', b.town, 'levels', b.levels, 'status', b.status,
             'needs_review', b.needs_review, 'source', b.source, 'submitted_at', b.submitted_at, 'decided_at', b.decided_at, 'decision_note', b.decision_note, 'merged_into', b.merged_into,
             'submitter_name', b.submitter_name, 'submitter_email', b.submitter_email, 'users_linked', b.users_linked,
             'similar', case when b.status = 'pending' then coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'ownership', a.ownership, 'district', a.district, 'town', a.town) order by a.name)
                from (select x.* from public.school_directory x where x.status = 'approved' and x.country_code = b.country_code and x.region = b.region and x.id <> b.id
                         and (x.name_key = b.name_key or (x.district_key = b.district_key and (x.name_key like left(b.name_key, 8) || '%' or b.name_key like left(x.name_key, 8) || '%')))
                       order by (x.district_key = b.district_key) desc, x.name limit 6) a), '[]'::jsonb) else '[]'::jsonb end) as j
      from (select d.*, coalesce(d.submitted_at, d.created_at) as sort_at,
                   (select p.full_name from public.profiles p where p.id = d.submitted_by) as submitter_name,
                   (select p.email from public.profiles p where p.id = d.submitted_by) as submitter_email,
                   ((select count(*) from public.student_profiles sp where sp.school_directory_id = d.id) + (select count(*) from public.teacher_profiles tp where tp.school_directory_id = d.id))::integer as users_linked
              from public.school_directory d
             where d.status = p_status and (pat is null or d.name ilike pat or d.district ilike pat or d.town ilike pat)
               and (nullif(p_region, '') is null or d.region = p_region) and (nullif(p_district, '') is null or d.district_key = public.qb_school_district_key(p_district))
               and (p_ownership is null or (p_ownership = 'unset' and d.ownership is null) or d.ownership = p_ownership)
               and (p_level is null or d.levels @> array[p_level]::text[])) b
     order by rn limit lim offset skip_n) r;
  return jsonb_build_object('total', total, 'rows', result,
    'counts', (select coalesce(jsonb_object_agg(c.status, c.n), '{}'::jsonb) from (select status, count(*)::integer as n from public.school_directory group by status) c));
end $fn$;

create or replace function public.qb_school_admin_stats(p_region text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare this_week date := date_trunc('week', now())::date;
begin
  if auth.uid() is null or not quizbox_market.is_super() then raise exception 'SUPER_ADMIN_REQUIRED' using errcode = '42501'; end if;
  return jsonb_build_object(
    'totals', jsonb_build_object(
      'approved', (select count(*) from public.school_directory where status = 'approved'),
      'pending', (select count(*) from public.school_directory where status = 'pending'),
      'rejected', (select count(*) from public.school_directory where status = 'rejected'),
      'merged', (select count(*) from public.school_directory where status = 'merged'),
      'private', (select count(*) from public.school_directory where status = 'approved' and ownership = 'private'),
      'public', (select count(*) from public.school_directory where status = 'approved' and ownership = 'public'),
      'unset', (select count(*) from public.school_directory where status = 'approved' and ownership is null),
      'needs_review', (select count(*) from public.school_directory where status in ('approved', 'pending') and needs_review),
      'regions', (select count(distinct region) from public.school_directory where status = 'approved'),
      'districts', (select count(distinct (region, district_key)) from public.school_directory where status = 'approved'),
      'people_linked', (select count(*) from public.student_profiles where school_directory_id is not null) + (select count(*) from public.teacher_profiles where school_directory_id is not null)),
    'by_region', coalesce((select jsonb_agg(jsonb_build_object('region', s.region, 'private', s.pr, 'public', s.pu, 'unset', s.un, 'total', s.pr + s.pu + s.un) order by s.pr + s.pu + s.un desc, s.region)
        from (select region, count(*) filter (where ownership = 'private')::integer as pr, count(*) filter (where ownership = 'public')::integer as pu, count(*) filter (where ownership is null)::integer as un
                from public.school_directory where status = 'approved' group by region) s), '[]'::jsonb),
    'by_level', jsonb_build_object(
      'primary', (select count(*) from public.school_directory where status = 'approved' and levels @> array['primary']),
      'jhs', (select count(*) from public.school_directory where status = 'approved' and levels @> array['jhs']),
      'shs', (select count(*) from public.school_directory where status = 'approved' and levels @> array['shs'])),
    'weekly', coalesce((select jsonb_agg(jsonb_build_object('week', w.d, 'added', (select count(*) from public.school_directory x where x.source = 'user' and x.submitted_at >= w.d and x.submitted_at < w.d + 7),
                                                         'decided', (select count(*) from public.school_directory x where x.decided_at >= w.d and x.decided_at < w.d + 7)) order by w.d)
        from (select (this_week - 7 * g)::date as d from generate_series(0, 11) g) w), '[]'::jsonb),
    'districts', case when nullif(p_region, '') is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('district', s.district, 'schools', s.n) order by s.district)
        from (select min(district) as district, count(*)::integer as n from public.school_directory where status = 'approved' and region = p_region group by district_key) s), '[]'::jsonb) end);
end $fn$;

revoke all on function public.qb_school_admin_list(text, text, integer, integer, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.qb_school_admin_stats(text) from public, anon, authenticated;
grant execute on function public.qb_school_admin_list(text, text, integer, integer, text, text, text, text, text, text) to authenticated;
grant execute on function public.qb_school_admin_stats(text) to authenticated;

commit;
