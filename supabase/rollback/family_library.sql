-- Rollback for 20261084100000_family_library.sql: removes the functions. The grants table stays, so nothing a family gave is lost.
begin;
drop function if exists public.qb_family_set_record(uuid, integer, integer);
drop function if exists public.qb_family_set_open(uuid);
drop function if exists public.qb_family_my_sets();
drop function if exists public.qb_family_revoke_grant(uuid, uuid);
drop function if exists public.qb_family_grant_set(uuid, uuid[]);
drop function if exists public.qb_family_library();
commit;
