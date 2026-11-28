grant execute on function public.interschool_generate_fixtures(uuid, text, integer), public.interschool_add_fixture(uuid, uuid, uuid, timestamptz, timestamptz, jsonb, integer), public.interschool_change_fixture(uuid, timestamptz, timestamptz, boolean, text),
  public.interschool_start(uuid), public.interschool_save(uuid, jsonb), public.interschool_submit(uuid, jsonb), public.interschool_finalise_round(uuid, boolean), public.interschool_qualify(uuid, uuid[], boolean, text), public.interschool_announce_round(uuid),
  public.interschool_raise_dispute(uuid, text, uuid), public.interschool_resolve_dispute(uuid, boolean, text), public.interschool_adjust_score(uuid, uuid, numeric, text, uuid), public.interschool_disqualify(uuid, text),
  public.interschool_mine(), public.interschool_results(uuid), public.interschool_operations(uuid) to authenticated;
grant execute on function public.interschool_public_results(text) to authenticated, service_role;


notify pgrst, 'reload schema';
