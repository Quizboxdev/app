-- Rolls back 20261012160000_source_file_release.sql. Rows already released stay IMPORTED (their previous documents stay marked rejected).
begin;
drop function if exists public.qb_source_release_file(uuid, text);
commit;
