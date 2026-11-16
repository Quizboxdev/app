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
