-- Rollback for 20261067100000_repeat_assignments.sql: weekly repeating stops, the schedules and the reminder log are dropped, and the flag row is removed.
-- Assignments already published by a schedule stay as they are (they are ordinary assignments); notifications already sent are kept.
begin;
drop function if exists public.qb_schedules_run(integer);
drop function if exists public.qb_assignment_reminders_run();
drop function if exists public.qb_schedule_delete(uuid);
drop function if exists public.qb_schedule_set_active(uuid, boolean);
drop function if exists public.qb_schedule_list();
drop function if exists public.qb_schedule_create(uuid, text, text, jsonb, text, text, integer, integer, integer, text, integer);
drop function if exists quizbox_sched.remind_due();
drop function if exists quizbox_sched.run_due(integer);
drop function if exists quizbox_sched.tell(uuid, text, text);
drop function if exists quizbox_sched.next_run(integer, time, text, timestamptz);
drop table if exists public.assignment_reminders_sent;
drop table if exists public.assignment_schedules;
drop schema if exists quizbox_sched;
delete from public.platform_settings where key = 'flags.repeat_assignments' and scope_type = 'global';
commit;
notify pgrst, 'reload schema';
