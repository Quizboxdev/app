revoke all on function public.interschool_school_search(text, text), public.interschool_invite(uuid, uuid[]), public.interschool_school_respond(uuid, uuid, boolean, text), public.interschool_register(text, uuid, uuid, text),
  public.interschool_nominate(uuid, uuid, uuid, uuid[]), public.interschool_confirm_candidate(uuid, boolean, text), public.interschool_withdraw(uuid, text), public.interschool_replace(uuid, uuid, text),
  public.interschool_lock_roster(uuid, uuid), public.interschool_school_home(), public.interschool_school_roster(uuid, uuid), public.interschool_school_learners(uuid, uuid, uuid, text), public.interschool_registrations(uuid),
  public.interschool_public_get(text), public.interschool_public_list(integer), public.interschool_set_listed(uuid, boolean), public.interschool_track(text, text, text), public.interschool_join_options(text) from public, anon, authenticated;
grant execute on function public.interschool_school_search(text, text), public.interschool_invite(uuid, uuid[]), public.interschool_school_respond(uuid, uuid, boolean, text), public.interschool_register(text, uuid, uuid, text),
  public.interschool_nominate(uuid, uuid, uuid, uuid[]), public.interschool_confirm_candidate(uuid, boolean, text), public.interschool_withdraw(uuid, text), public.interschool_replace(uuid, uuid, text),
  public.interschool_lock_roster(uuid, uuid), public.interschool_school_home(), public.interschool_school_roster(uuid, uuid), public.interschool_school_learners(uuid, uuid, uuid, text), public.interschool_registrations(uuid),
  public.interschool_set_listed(uuid, boolean), public.interschool_join_options(text) to authenticated;
grant execute on function public.interschool_public_get(text), public.interschool_public_list(integer) to authenticated, service_role;
grant execute on function public.interschool_track(text, text, text) to service_role;


notify pgrst, 'reload schema';
