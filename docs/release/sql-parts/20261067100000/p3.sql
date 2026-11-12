grant execute on function public.qb_schedule_create(uuid, text, text, jsonb, text, text, integer, integer, integer, text, integer), public.qb_schedule_list(),
  public.qb_schedule_set_active(uuid, boolean), public.qb_schedule_delete(uuid) to authenticated;
revoke all on function public.qb_schedules_run(integer), public.qb_assignment_reminders_run() from authenticated;
grant execute on function public.qb_schedules_run(integer), public.qb_assignment_reminders_run() to service_role;


notify pgrst, 'reload schema';
