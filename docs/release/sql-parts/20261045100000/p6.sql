-- The checked entry point. A preview (up to 100 rows) is not logged; a real export is.
create or replace function public.qb_export_run(p_dataset text, p_from timestamptz default null, p_to timestamptz default null, p_category text default null, p_limit integer default 50000) returns jsonb
language plpgsql security definer set search_path = '' as $fn$
declare d record; v_limit integer := least(greatest(coalesce(p_limit, 50000), 0), 100000); v_cat text := nullif(btrim(coalesce(p_category, '')), ''); r jsonb;
begin
  if auth.uid() is null then raise exception 'QB_AUTHENTICATION_REQUIRED' using errcode = '42501'; end if;
  select * into d from public.qb_export_defs() x where x.key = p_dataset;
  if d.key is null or not public.qb_export_can(d.need) or to_regclass(d.tbl) is null then raise exception 'QB_FORBIDDEN' using errcode = '42501'; end if;
  if p_from is not null and p_to is not null and p_to <= p_from then raise exception 'QB_INVALID_RANGE' using errcode = '22023'; end if;
  if v_cat is not null and d.categories is not null and not (v_cat = any (d.categories)) then raise exception 'QB_INVALID_CATEGORY' using errcode = '22023'; end if;
  r := public.qb_export_build(d.key, p_from, p_to, v_cat, v_limit);
  if v_limit > 100 then
    perform quizbox_core.audit('export.run', 'export', null, jsonb_build_object('dataset', d.key, 'from', p_from, 'to', p_to, 'category', v_cat, 'rows', jsonb_array_length(r -> 'rows'), 'total', r -> 'total'));
  end if;
  return r || jsonb_build_object('dataset', d.key, 'label', d.label);
end $fn$;

revoke all on function public.qb_export_ts(timestamptz), public.qb_export_is_admin(), public.qb_export_can(text), public.qb_export_defs(), public.qb_export_build(text, timestamptz, timestamptz, text, integer),
  public.qb_export_build_a(text, timestamptz, timestamptz, text, integer), public.qb_export_build_b(text, timestamptz, timestamptz, text, integer), public.qb_export_build_c(text, timestamptz, timestamptz, text, integer),
  public.qb_export_build_d(text, timestamptz, timestamptz, text, integer), public.qb_export_build_e(text, timestamptz, timestamptz, text, integer),
  public.qb_export_catalog(), public.qb_export_run(text, timestamptz, timestamptz, text, integer) from public, anon, authenticated;
grant execute on function public.qb_export_catalog(), public.qb_export_run(text, timestamptz, timestamptz, text, integer) to authenticated;


notify pgrst, 'reload schema';
