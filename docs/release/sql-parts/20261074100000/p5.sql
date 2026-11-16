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
