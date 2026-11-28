-- Rollback of 20261126120000_interschool_play.sql. Run the rollbacks of the later inter-school migrations first (interschool_awards, interschool_billing). Competition data held in the tables dropped here is lost: export it first if it matters.
begin;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
      'quizbox_interschool.round_ctx',
      'quizbox_interschool.playing_schools',
      'quizbox_interschool.fixture_clash',
      'quizbox_interschool.make_fixture',
      'quizbox_interschool.knockout_pairs',
      'public.interschool_generate_fixtures',
      'public.interschool_add_fixture',
      'public.interschool_change_fixture',
      'quizbox_interschool.sit_state',
      'quizbox_interschool.sitting_view',
      'quizbox_interschool.merge_answers',
      'quizbox_interschool.close_sitting',
      'public.interschool_start',
      'public.interschool_save',
      'public.interschool_submit',
      'quizbox_interschool.settle_fixtures',
      'quizbox_interschool.apply_rules',
      'quizbox_interschool.compute_round',
      'quizbox_interschool.after_finalise',
      'public.interschool_finalise_round',
      'public.interschool_qualify',
      'public.interschool_announce_round',
      'public.interschool_raise_dispute',
      'public.interschool_resolve_dispute',
      'public.interschool_adjust_score',
      'public.interschool_disqualify',
      'quizbox_interschool.school_table',
      'public.interschool_mine',
      'public.interschool_results',
      'public.interschool_public_results',
      'public.interschool_operations')
  loop execute format('drop function if exists %s cascade', f.sig); end loop;
end $$;
drop table if exists quizbox_interschool.adjustments cascade;
drop table if exists quizbox_interschool.disputes cascade;
drop table if exists quizbox_interschool.school_results cascade;
drop table if exists quizbox_interschool.round_results cascade;
drop table if exists quizbox_interschool.sittings cascade;
drop table if exists quizbox_interschool.fixtures cascade;
commit;
notify pgrst, 'reload schema';
