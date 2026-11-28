-- Rollback of 20261126100000_interschool_core.sql. Run the rollbacks of the later inter-school migrations first (interschool_awards, interschool_billing, interschool_play, interschool_registration). Competition data held in the tables dropped here is lost: export it first if it matters.
begin;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
      'quizbox_interschool.require_on',
      'quizbox_interschool.is_admin',
      'quizbox_interschool.staff_of',
      'quizbox_interschool.my_schools',
      'quizbox_interschool.approved_sponsor',
      'quizbox_interschool.can_manage',
      'quizbox_interschool.managed',
      'quizbox_interschool.audit',
      'quizbox_interschool.notify',
      'quizbox_interschool.pool',
      'quizbox_interschool.section_report',
      'quizbox_interschool.freeze_paper',
      'quizbox_interschool.slugify',
      'quizbox_interschool.apply_settings',
      'public.interschool_create',
      'public.interschool_update',
      'public.interschool_set_divisions',
      'public.interschool_set_rounds',
      'quizbox_interschool.problems',
      'public.interschool_check',
      'quizbox_interschool.needs_approval',
      'public.interschool_request_approval',
      'public.interschool_decide',
      'public.interschool_publish',
      'public.interschool_set_status',
      'public.interschool_duplicate',
      'public.interschool_manage_get',
      'public.interschool_manage_list',
      'public.interschool_subjects',
      'public.interschool_topics')
  loop execute format('drop function if exists %s cascade', f.sig); end loop;
end $$;
drop table if exists quizbox_interschool.paper_questions cascade;
drop table if exists quizbox_interschool.papers cascade;
drop table if exists quizbox_interschool.rounds cascade;
drop table if exists quizbox_interschool.divisions cascade;
drop table if exists quizbox_interschool.competitions cascade;
delete from public.platform_settings where scope_type = 'global' and key in ('flags.interschool', 'flags.interschool_public', 'flags.interschool_sponsorship', 'interschool.allow_managed_learners', 'interschool.rate_per_participant_minor', 'interschool.setup_fee_minor');
drop schema if exists quizbox_interschool;
-- institutions.verified_at is shared with 20261068100000 and is kept.
commit;
notify pgrst, 'reload schema';
