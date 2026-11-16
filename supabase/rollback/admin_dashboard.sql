-- Rollback for 20261077100000_admin_dashboard.sql: removes the dashboard function. No data changes.
begin;
drop function if exists public.qb_admin_dashboard(integer);
commit;
