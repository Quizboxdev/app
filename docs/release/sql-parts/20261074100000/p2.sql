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
