-- Rollback for 20261083100000_family_progress_admin.sql: removes the read-only functions. No data changes.
begin;
drop function if exists public.qb_admin_family_detail(uuid);
drop function if exists public.qb_admin_families();
drop function if exists public.qb_family_child_progress(uuid, integer);
drop function if exists public.qb_family_progress(integer);
commit;
