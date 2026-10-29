-- Removes two superseded function copies that make the practice builder fail. Production had both qb_practice_menu() and qb_practice_menu(p_grade text default null), and both
-- qb_start_quick_practice(uuid[], integer) and qb_start_quick_practice(uuid[], integer, text default null). Called without a grade, the database cannot choose between them
-- (PostgREST PGRST203), so learners and teachers saw "The operation could not be completed". The grade-aware versions handle every call, so the older copies are dropped.
-- Idempotent. Rollback: supabase/rollback/drop_stale_practice_overloads.sql.
begin;
drop function if exists public.qb_practice_menu();
drop function if exists public.qb_start_quick_practice(uuid[], integer);
commit;
notify pgrst, 'reload schema';
