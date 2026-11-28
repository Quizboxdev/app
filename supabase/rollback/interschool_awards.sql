-- Rollback of 20261126140000_interschool_awards.sql. Competition data held in the tables dropped here is lost: export it first if it matters.
begin;
drop trigger if exists is_competition_cancelled on quizbox_interschool.competitions;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname || '.' || p.proname in (
      'public.interschool_issue_certificates',
      'public.interschool_revoke_certificate',
      'public.interschool_my_certificates',
      'public.interschool_verify_certificate',
      'quizbox_interschool.on_cancelled',
      'public.interschool_send_reminders',
      'public.interschool_admin_overview')
  loop execute format('drop function if exists %s cascade', f.sig); end loop;
end $$;
drop table if exists quizbox_interschool.certificates cascade;
delete from public.platform_settings where scope_type = 'global' and key = 'flags.interschool_certificates';
commit;
notify pgrst, 'reload schema';
