-- Rollback of 20261126110000_interschool_registration.sql. Run the rollbacks of the later inter-school migrations first (interschool_awards, interschool_billing, interschool_play). Competition data held in the tables dropped here is lost: export it first if it matters.
begin;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
      'quizbox_interschool.source_of',
      'quizbox_interschool.level_of',
      'quizbox_interschool.learner_verified',
      'quizbox_interschool.school_learner',
      'quizbox_interschool.short_name',
      'quizbox_interschool.registration_state',
      'quizbox_interschool.roster_locked',
      'quizbox_interschool.notify_school',
      'quizbox_interschool.enter_school',
      'quizbox_interschool.limit_reached',
      'quizbox_interschool.add_candidate',
      'quizbox_interschool.promote_waiting',
      'quizbox_interschool.open_competition',
      'quizbox_interschool.require_registration_open',
      'public.interschool_school_search',
      'public.interschool_invite',
      'public.interschool_school_respond',
      'public.interschool_register',
      'public.interschool_nominate',
      'public.interschool_confirm_candidate',
      'public.interschool_withdraw',
      'public.interschool_replace',
      'public.interschool_lock_roster',
      'public.interschool_school_home',
      'public.interschool_school_roster',
      'public.interschool_school_learners',
      'public.interschool_registrations',
      'public.interschool_join_options',
      'public.interschool_public_get',
      'public.interschool_public_list',
      'public.interschool_set_listed',
      'public.interschool_track')
  loop execute format('drop function if exists %s cascade', f.sig); end loop;
end $$;
drop table if exists quizbox_interschool.events cascade;
drop table if exists quizbox_interschool.candidates cascade;
drop table if exists quizbox_interschool.school_entries cascade;
commit;
notify pgrst, 'reload schema';
