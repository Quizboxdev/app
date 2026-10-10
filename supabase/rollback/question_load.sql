-- Rolls back 20261012120000_question_load.sql (function only). Questions already loaded stay: they are ordinary review-state questions.
begin;
drop function if exists public.qb_question_load(jsonb);
commit;
