-- Rollback for 20261057100000_mixed_practice.sql: removes qb_start_mixed_practice. Practice sets already built stay (they are ordinary assessments);
-- qb_start_quick_practice was never touched.
begin;
drop function if exists public.qb_start_mixed_practice(jsonb, text, text);
commit;
