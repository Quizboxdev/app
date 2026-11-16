-- Rollback for 20261078100000_student_subjects.sql: removes the function. No data changes.
begin;
drop function if exists public.qb_student_set_subjects(text[]);
commit;
