-- Rollback of 20261125100000_admin_live_stats.sql. Removes the live figures; the dashboard then uses qb_admin_dashboard again. No business data is touched.
begin;
do $do$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then perform cron.unschedule('qb-admin-live-refresh'); end if;
exception when others then raise notice 'pg_cron unschedule skipped: %', sqlerrm;
end $do$;
drop function if exists public.qb_admin_live(text, integer, integer);
drop schema if exists quizbox_stats cascade;
drop index if exists public.questions_admin_counts_idx;
drop index if exists public.attempts_started_at_idx;
commit;
notify pgrst, 'reload schema';
