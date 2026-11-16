-- Rollback for 20261075100000_school_directory_analytics.sql: drops the stats function and restores the list function from 20261074100000 (no filters or sorting). No data changes.
begin;

drop function if exists public.qb_school_admin_stats(text);
drop function if exists public.qb_school_admin_list(text, text, integer, integer, text, text, text, text, text, text);

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

revoke all on function public.qb_school_admin_list(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.qb_school_admin_list(text, text, integer, integer) to authenticated;

commit;
