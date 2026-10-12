-- Rolls back 20261012200000_quick_practice.sql (functions only). Practice sets already built stay as ordinary assessments.
begin;
drop function if exists public.qb_start_quick_practice(uuid[], integer);
drop function if exists public.qb_practice_menu();
commit;
